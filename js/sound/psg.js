import {
	decibelReductionToAmplitude, amplitudeToDecibels,
	ClockRate, LFO_DIVISORS, VIBRATO_PRESETS,
} from './common.js';

const AMPLITUDES = new Array(31);
AMPLITUDES[0] = 0;
for (let i = 2; i <= 30; i += 2) {
	// 2dB per big step
	AMPLITUDES[i] = decibelReductionToAmplitude(30 - i);
}
/* Support 1/2 step volume levels, which are created by rapidly alternating values on the real
 * chip.
*/
for (let i = 1; i <= 29; i += 2) {
	AMPLITUDES[i] = (AMPLITUDES[i - 1] + AMPLITUDES[i + 1]) / 2;
}

const TREMOLO_PRESETS = [0, 1, 3, 6];

class NoiseChannel {
	constructor(synth, context, lfo, output) {
		this.synth = synth;
		this.sampleRate = context.sampleRate;
		this.waveform = 0;

		const noiseBuffer = new AudioBuffer({length: 57336, sampleRate: context.sampleRate});
		let sampleData = noiseBuffer.getChannelData(0);
		let lfsr = 1 << 15;
		for (let i = 0; i < 57336; i++) {
			const output = lfsr & 1;
			const tap = ((lfsr & 8) >> 3) ^ output;
			lfsr = (lfsr >>> 1) | (tap << 15);
			sampleData[i] = output === 1 ? -1 : 1;
		}

		const pulseBuffer = new AudioBuffer({length: 128, sampleRate: context.sampleRate});
		sampleData = pulseBuffer.getChannelData(0);
		sampleData.fill(-1, 0, 8);
		sampleData.fill(1, 8);

		this.buffers = [pulseBuffer, noiseBuffer];
		this.playbackRates = [128, 1];
		this.frequencyDividers = [16, 1];	// Pulse wave has 1/16 duty cycle
		const source = this.makeSource(context);
		this.source = source;
		this.rateMultiplier = this.playbackRates[this.waveform];
		this.setCountdownValue(16);

		const envelopeGain = new GainNode(context, {gain: 0});
		this.envelopeGain = envelopeGain;
		source.connect(envelopeGain);
		envelopeGain.connect(output);
	}

	makeSource(context) {
		return new AudioBufferSourceNode(context, {
			buffer: this.buffers[this.waveform],
			loop: true,
			loopEnd: Number.MAX_VALUE,
			playbackRate: 0,
		});
	}

	start(time = 0) {
		this.source.start(time);
	}

	stop(time = 0) {
		this.source.stop(time);
	}

	setFrequency(frequency, time = 0) {
		this.frequency = frequency;
		const rateMultiplier = this.rateMultiplier;
		// For the pulse wave each sample is duplicated 8 times: 128 / 16 = 8
		const maxRate = rateMultiplier / this.frequencyDividers[this.waveform];
		const rate = Math.min(rateMultiplier * 4 * this.frequency / this.sampleRate, maxRate);
		this.source.playbackRate.setValueAtTime(rate, time);
	}

	getFrequency() {
		return this.frequency;
	}

	/**When calling setCountdownValue() and setWave() together then setWave() must be called
	 * first. After calling setWave() it's always necessary to call setCountdownValue() again if
	 * you want to preserve the countdown value rather than preserving the frequency in Hertz.
	 */
	setCountdownValue(count, time = 0) {
		const divider = this.frequencyDividers[this.waveform];
		this.setFrequency(this.synth.frequencyNumberToHz(4 * count) / divider, time);
	}

	getCountdownValue() {
		return Math.round(this.synth.frequencyToFreqNumber(this.frequency) / 4);
	}

	/**
	 * @param {number} value 0 = pulse wave, 1 = noise
	 */
	setWave(context, value, time = 0) {
		this.waveform = value;										// Used by makeSource()
		const newSource = this.makeSource(context);
		newSource.connect(this.envelopeGain);
		newSource.start(time);
		this.source.stop(time);
		this.source = newSource;									// Used by setFrequency()
		this.rateMultiplier = this.playbackRates[value];	// Used by setFrequency()
		this.setFrequency(this.frequency, time);
	}

	getWave() {
		return this.waveform;
	}

}

const WaveSequence = Object.freeze({
	NONE: 0,
	ONE_SHOT: 1,
	PERIODIC: 2,
});

/**
 * Waveforms supported:
 * 	Pulse (default) (with optional PWM): setWave(1); setSequence(WaveSequence.NONE);
 * 	Sawtooth: setWave(0); setSequence(WaveSequence.NONE);
 * 	A mix of pulse and saw: e.g. setWave(0.5); setSequence(WaveSequence.NONE);
 * 	One basic waveform then the other:
 * 		setWave(0) (saw first) or setWave(1) (pulse first); setSequence(WaveSequence.ONE_SHOT);
 * 	Alternating:
 * 		setWave(0) (saw first) or setWave(1) (pulse first); setSequence(WaveSequence.PERIODIC);
 * 	Others (e.g. triangle) will be supported using a looping envelope and setFrequency(0);
 */
class ToneChannel {

	constructor(synth, context, lfo, pwmLFO, output, reciprocalTable, minusOne) {
		this.frequency = 0;
		this.lastFreqChange = 0;
		this.waveform = 1;		// Mix: 0 (sawtooth only) to 1 (pulse only)
		this.sequenceMode = WaveSequence.NONE;
		this.sequenceTime = 3 / synth.framesPerSecond;
		// Duty cycle: 0 (0%) to 4096 (100%) (stick to 0 to 2048 to avoid limiter glitches with PWM)
		this.dutyCycle = 2048;
		// PWM range: 0 to 4096, even numbers only. All sounds are possible using 0-2048 or even 0-1024.
		this.pwmDepth = 0;
		this.vibratoDepth = 0;	// in cents

		const initialDutyCycle = this.dutyCycle / 4096;

		this.synth = synth;
		const saw = new OscillatorNode(context, {frequency: this.frequency, type: 'sawtooth'});
		this.saw = saw;
		const frequency = new ConstantSourceNode(context, {offset: 0});
		this.frequencyNode = frequency;
		this.frequencyControl = frequency.offset;
		const vibratoAmp = new GainNode(context);
		frequency.connect(vibratoAmp);
		const vibratoDepth = new GainNode(context, {gain: (2 ** (this.vibratoDepth / 1200)) - 1});
		vibratoDepth.connect(vibratoAmp.gain);
		this.vibratoDepthParam = vibratoDepth.gain;
		lfo.connect(vibratoDepth);
		vibratoAmp.connect(saw.frequency);

		const dutyCycleNode = new ConstantSourceNode(context, {offset: initialDutyCycle});
		this.dutyCycleNode = dutyCycleNode;
		this.dutyCycleParam = dutyCycleNode.offset;
		const dutyCycleLimiter = new WaveShaperNode(context, {curve: [1, 0, 1]});
		dutyCycleNode.connect(dutyCycleLimiter);
		const pwm = new GainNode(context, {gain: this.pwmDepth / 8192});
		this.pwm = pwm.gain;
		pwmLFO.connect(pwm);
		pwm.connect(dutyCycleLimiter);

		const reciprocalInputScaler = new GainNode(context, {gain: 2 / synth.maxFrequency});
		vibratoAmp.connect(reciprocalInputScaler);
		const reciprocal = new WaveShaperNode(context, {curve: reciprocalTable});
		reciprocalInputScaler.connect(reciprocal);
		minusOne.connect(reciprocal);
		this.reciprocal = reciprocal;
		const dutyCycleMultiplier = new GainNode(context, {gain: 0});
		dutyCycleLimiter.connect(dutyCycleMultiplier.gain);
		reciprocal.connect(dutyCycleMultiplier);
		const delay = new DelayNode(context, {delayTime: 0, maxDelayTime: 0.5});
		saw.connect(delay);
		dutyCycleMultiplier.connect(delay.delayTime);
		const inverter = new GainNode(context, {gain: -this.waveform});
		delay.connect(inverter);
		this.waveParam = inverter.gain;
		const dcOffset = new ConstantSourceNode(context, {offset: 2 * initialDutyCycle - 1});
		dcOffset.connect(inverter);
		this.dcOffset = dcOffset;
		const times2 = new GainNode(context, {gain: 2});
		pwm.connect(times2);
		times2.connect(dcOffset.offset);

		this.waveLFOGain = new GainNode(context, {gain: -0.5});
		this.waveLFOGain.connect(inverter.gain);
		this.waveLFO = undefined;

		const waveGain = new GainNode(context, {gain: 0});
		saw.connect(waveGain);
		inverter.connect(waveGain);
		this.waveAmp = waveGain.gain;

		const constant = new ConstantSourceNode(context, {offset: 0.5});
		this.constant = constant.offset;
		this.constantNode = constant;

		const envelopeGain = new GainNode(context, {gain: 0});
		waveGain.connect(envelopeGain);
		constant.connect(envelopeGain);
		envelopeGain.connect(output);
		this.envelopeGain = envelopeGain;
	}

	start(time = 0) {
		this.saw.start(time);
		this.frequencyNode.start(time);
		this.dutyCycleNode.start(time);
		this.dcOffset.start(time);
		this.constantNode.start(time);
	}

	stop(time = 0) {
		this.saw.stop(time);
		this.frequencyNode.stop(time);
		this.dutyCycleNode.stop(time);
		this.dcOffset.stop(time);
		this.constantNode.stop(time);
		this.reciprocal.disconnect();
		if (this.waveLFO) {
			this.waveLFO.stop(time);
			this.waveLFO = undefined;
		}
	}

	setFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.frequencyControl[method](frequency, time);
		const limit = this.synth.maxFrequency;
		if (frequency > limit) {
			this.waveAmp[method](0, time);
			this.constant[method](0.5, time);
		} else {
			this.waveAmp[method](1, time);
			this.constant[method](0, time);
		}
		this.frequency = frequency;
		this.lastFreqChange = time;
	}

	getFrequency() {
		return this.frequency;
	}

	setFrequencyNumber(frequencyNumber, time = 0, method = 'setValueAtTime') {
		const frequency = this.synth.frequencyNumberToHz(frequencyNumber);
		this.setFrequency(frequency, time, method);
	}

	getFrequencyNumber() {
		const frequencyNumber = this.synth.frequencyToFreqNumber(this.frequency);
		return Math.round(100000 * frequencyNumber) / 100000;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		this.setFrequency(this.synth.noteFrequencies[noteNumber], time, method);
	}

	getMIDINote() {
		const a4Pitch = Math.round(this.noteFrequencies[69]);
		return Math.round(12 * Math.log2(this.frequency / a4Pitch) + 69);
	}

	setWave(value, time = 0, method = 'setValueAtTime') {
		if (this.sequenceMode === WaveSequence.PERIODIC) {
			this.waveLFOGain.gain[method](0.5 - value, time);
		} else {
			this.waveParam[method](-value, time);
		}
		this.waveform = value;
	}

	getWave() {
		return this.waveform;
	}

	setWaveSequence(mode, time = 0) {
		if (mode === WaveSequence.PERIODIC) {
			this.waveParam.setValueAtTime(-0.5, time);
			this.waveLFOGain.gain.setValueAtTime(this.waveform >= 0.5 ? -0.5 : 0.5, time);
		} else if (this.waveLFO) {
			this.waveLFO.stop(time);
			this.waveParam.setValueAtTime(-this.waveform, time);
			this.waveLFO = undefined;
		}
		this.sequenceMode = mode;
	}

	getWaveSequence() {
		return this.sequenceMode;
	}

	setWaveSequenceTime(frames) {
		this.sequenceTime = frames / this.synth.framesPerSecond;
	}

	getWaveSequenceTime() {
		return Math.round(this.sequenceTime * this.synth.framesPerSecond);
	}

	/**
	 * @param {number} value Between 0 and 4096, representing 0% and 100% respectively.
	 */
	setDutyCycle(value, time = 0, method = 'setValueAtTime') {
		const duty = value / 4096;
		this.dutyCycleParam[method](duty, time);
		this.dcOffset.offset[method](2 * duty - 1, time);
		this.dutyCycle = value;
	}

	getDutyCycle() {
		return this.dutyCycle;
	}

	/**
	 * @param {number} amount Amount of PWM travel. An even number between 0 and 4096, where 0
	 * represents 0% and 4096 represents 100%.
	 */
	setPWMDepth(amount, time = 0, method = 'setValueAtTime') {
		amount = (amount >> 1) << 1;
		this.pwm[method](amount / 8192, time);
		this.pwmDepth = amount;
	}

	getPWMDepth() {
		return this.pwmDepth;
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const depth = (2 ** (cents / 1200)) - 1;
		this.vibratoDepthParam[method](depth, time);
		this.vibratoDepth = cents;
	}

	getVibratoDepth() {
		return this.vibratoDepth;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		return VIBRATO_PRESETS.indexOf(this.vibratoDepth);
	}


	keyOn(context, velocity = 127, time = context.currentTime + PROCESSING_TIME) {
		switch (this.sequenceMode) {
		case WaveSequence.ONE_SHOT:
			this.waveParam.setValueAtTime(-this.waveform, time);
			this.waveParam.setValueAtTime(this.waveform - 1, time + this.sequenceTime);
			break;
		case WaveSequence.PERIODIC:
			if (this.waveLFO) {
				this.waveLFO.stop(time);
			}
			const waveLFO = new OscillatorNode(
				context, {type: 'square', frequency: 1 / (2 * this.sequenceTime)}
			);
			waveLFO.start(time);
			waveLFO.connect(this.waveLFOGain);
			this.waveLFO = waveLFO;
			break;
		}
		this.envelopeGain.gain.setValueAtTime(1, time);
	}

	keyOff(context, time = context.currentTime) {
		this.envelopeGain.gain.setValueAtTime(0, time);
	}

}

class PSG {

	constructor(
		context, numToneChannels = 3, output = context.destination, clockRate = ClockRate.NTSC,
		clockDivider = 15, fps = 60
	) {
		this.setClockRate(context, clockRate, clockDivider, fps);
		this.tuneEqualTemperament();

		let frequencyLimit = context.sampleRate / 2;
		while (frequencyLimit > 24000) {
			frequencyLimit /= 2;
		}
		const minFreqNumber = Math.ceil(this.frequencyToFreqNumber(frequencyLimit));
		let maxFrequency = this.frequencyNumberToHz(minFreqNumber);
		const step = 2;
		const numSteps = Math.ceil(maxFrequency / step);
		maxFrequency = numSteps * step;
		this.maxFrequency = maxFrequency;
		const reciprocalTable = new Float32Array(numSteps + 1);
		reciprocalTable[0] = (2 - 2 ** -23) * 2 ** 127;	// Max Float32 value
		for (let i = 1; i <= numSteps; i++) {
			reciprocalTable[i] = 1 / (i * step);
		}
		const minusOne = new ConstantSourceNode(context, {offset: -1});
		this.minusOne = minusOne;

		const lfo = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.lfo = lfo;
		const pwmLFO = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.pwmLFO = pwmLFO;

		const channelGain = new GainNode(context, {gain: 1 / (numToneChannels + 1)});
		channelGain.connect(output);
		const channels = [];
		for (let i = 0; i < numToneChannels; i++) {
			const channel = new ToneChannel(this, context, lfo, pwmLFO, channelGain, reciprocalTable, minusOne);
			channels[i] = channel;
		}
		const noiseChannel = new NoiseChannel(this, context, lfo, channelGain);
		channels[numToneChannels] = noiseChannel;
		this.noiseChannel = noiseChannel;
		this.channels = channels;
	}

	/**
	 * @param {number} [clockRate] Use 4,000,000 (with divider = 1) to emulate an AY-3-8910
	 * running at 2MHz.
	 */
	setClockRate(context, clockRate, divider = 15, fps) {
		this.clockRate = clockRate / divider;
		this.framesPerSecond = fps;
	}

	start(time) {
		this.minusOne.start(time);
		this.lfo.start(time);
		this.pwmLFO.start(time);
		for (let channel of this.channels) {
			channel.start(time);
		}
	}

	stop(time = 0) {
		this.lfo.stop(time);
		this.pwmLFO.stop(time);
		this.minusOne.stop(time);
		for (let channel of this.channels) {
			channel.stop(time);
		}
	}

	setLFORate(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo.frequency[method](frequency, time);
	}

	getLFORate() {
		return this.lfo.frequency.value;
	}

	setPWMFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.pwmLFO.frequency[method](frequency, time);
	}

	getPWMFrequency() {
		return this.pwmLFO.frequency.value;
	}

	frequencyNumberToHz(frequencyNumber) {
		if (frequencyNumber === 0) {
			frequencyNumber = 1;
		}
		return this.clockRate / (32 * frequencyNumber);
	}

	frequencyToFreqNumber(frequency) {
		return frequency === 0 ? 1 : this.clockRate / (32 * frequency);
	}

	tuneEqualTemperament(referencePitch = 440, referenceNote = 9, interval = 2, divisions = 12) {
		const clockRate = this.clockRate;
		const frequencies = new Array(128);
		const step = interval ** (1 / divisions);
		referenceNote += 60;
		let prevFreqNum, prevIdealFrequency;
		for (let i = 0; i < 128; i++) {
			const idealFrequency = referencePitch * interval ** ((i - referenceNote) / divisions);
			let freqNum = Math.round(this.frequencyToFreqNumber(idealFrequency));
			const approxFrequency = this.frequencyNumberToHz(freqNum);

			if (freqNum === prevFreqNum) {
				const error = Math.abs((approxFrequency - idealFrequency) / idealFrequency);
				const prevError = Math.abs((approxFrequency - prevIdealFrequency) / prevIdealFrequency);
				if (error > prevError && idealFrequency > approxFrequency) {
					// This note is further from nearest note on the chip's frequency scale.
					frequencies[i] = approxFrequency * step;
					freqNum = undefined;
				} else {
					// This note is closest.
					frequencies[i] = approxFrequency;
					frequencies[i - 1] = approxFrequency / step;
				}
			} else if (prevFreqNum === undefined && i > 0) {
				if (approxFrequency > frequencies[i - 1]) {
					frequencies[i] = approxFrequency;
				} else {
					frequencies[i] = frequencies[i - 1] * step;
					freqNum = undefined;
				}
			} else {
				frequencies[i] = approxFrequency;
			}

			prevFreqNum = freqNum;
			prevIdealFrequency = idealFrequency;
		}
		this.noteFrequencies = frequencies;
	}

}

export {
	PSG, NoiseChannel, ToneChannel, WaveSequence,
	TREMOLO_PRESETS
}
