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
	constructor(context, lfo, output, clockRate) {
		const noiseBuffer = new AudioBuffer({length: 57336, sampleRate: context.sampleRate});
		let sampleData = noiseBuffer.getChannelData(0);
		let lfsr = 1 << 15;
		for (let i = 0; i < 57336; i++) {
			const output = lfsr & 1;
			const tap = ((lfsr & 8) >> 3) ^ output;
			lfsr = (lfsr >>> 1) | (tap << 15);
			sampleData[i] = output === 1 ? -1 : 1;
		}
		this.noiseBuffer = noiseBuffer;

		const pulseBuffer = new AudioBuffer({length: 128, sampleRate: context.sampleRate});
		sampleData = pulseBuffer.getChannelData(0);
		sampleData.fill(-1, 0, 8);
		sampleData.fill(1, 8);
		this.pulseBuffer = pulseBuffer;
		this.pulsing = true;

		const toneInputGain = new GainNode(context, {gain: 0});
		this.toneInputGain = toneInputGain;
		this.countdownValue = 16;
		/* "When its input changes from 0 to 1 (ie. only once for every two times the related
		 *counter reaches zero..." Equivalent to using 32 here instead of 16.
		 * https://www.smspower.org/Development/SN76489
		 */
		this.transitionsPerSample = clockRate / (32 * context.sampleRate);
		const source = this.makeSource(context);
		toneInputGain.connect(source.playbackRate);
		this.source = source;

		const envelopeGain = new GainNode(context, {gain: 0});
		this.envelopeGain = envelopeGain;
		source.connect(envelopeGain);
		envelopeGain.connect(output);
	}

	makeSource(context) {
		let playbackRate;
		if (this.countdownValue) {
			playbackRate = this.transitionsPerSample / this.countdownValue;
		} else {
			playbackRate = 0;
		}

		let buffer;

		if (this.pulsing) {
			buffer = this.pulseBuffer;
			playbackRate *= 8;
		} else {
			buffer = this.noiseBuffer;
		}

		return new AudioBufferSourceNode(context, {
			buffer: buffer,
			loop: true,
			loopEnd: buffer.length,
			playbackRate: playbackRate,
		});
	}

	start(time = 0) {
		this.source.start(time);
	}

	stop(time = 0) {
		this.source.stop(time);
	}

	connectIn(toneFrequency) {
		toneFrequency.connect(this.toneInputGain);
	}

	loadRegister(context, time = 0) {
		const newSource = this.makeSource(context);
		newSource.start(time);
		newSource.connect(this.envelopeGain);
		this.source.stop(time);
		if (this.countdownValue === undefined) {
			this.toneInputGain.gain.setValueAtTime((this.pulsing ? 8 : 1) / context.sampleRate, time);
		}
		this.toneInputGain.connect(newSource.playbackRate);
		this.source = newSource;
	}

	setClockRate(context, clockRate, time = 0) {
		this.transitionsPerSample = clockRate / (32 * context.sampleRate);
		this.loadRegister(context, time);
	}

	useToneFrequency(context, time = 0) {
		this.source.playbackRate.setValueAtTime(0, time);
		this.toneInputGain.gain.setValueAtTime((this.pulsing ? 8 : 1) / context.sampleRate, time);
		this.countdownValue = undefined;
	}

	setCountdownValue(count, time = 0) {
		this.toneInputGain.gain.setValueAtTime(0, time);
		this.countdownValue = Math.max(count, 1);
	}

	getCountdownValue() {
		return this.countdownValue;
	}

	setPulsing(enabled) {
		this.pulsing = enabled;
	}

	isPulsing() {
		return this.pulsing;
	}

}

class ToneChannel {

	constructor(synth, context, lfo, pwmLFO, output, reciprocalTable, minusOne) {
		this.frequency = 0;
		this.lastFreqChange = 0;
		this.keyCode = 0;
		this.waveform = 1;		// Mix: 0 (sawtooth only) to 1 (pulse only)
		this.dutyCycle = 2048;	// 0 (0%) to 4096 (100%)
		this.pwmDepth = 0;		// 0 to 4096
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
		const pwm = new GainNode(context, {gain: this.pwmDepth / 4096});
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
		this.keyCode = this.synth.keyCode(frequency);
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
		this.waveParam[method](-value, time);
		this.waveform = value;
	}

	getWave() {
		return this.waveform;
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
	 * @param {number} amount Between 0 and 4096, representing 0% and 100% respectively.
	 */
	setPWMDepth(amount, time = 0, method = 'setValueAtTime') {
		this.pwm[method](amount / 4096, time);
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

}

class PSG {

	constructor(context, numToneChannels = 3, output = context.destination, clockRate = ClockRate.PAL / 15) {
		this.setClockRate(context, clockRate, 1);
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
		const noiseChannel = new NoiseChannel(context, lfo, channelGain, clockRate);
		noiseChannel.connectIn(channels[2].frequencyNode);
		channels[numToneChannels] = noiseChannel;
		this.noiseChannel = noiseChannel;
		this.channels = channels;
	}

	setClockRate(context, clockRate, divider = 15, opnClock = clockRate / 7) {
		clockRate /= divider
		this.clockRate = clockRate;
		this.lfoRateDividend = opnClock / (144 * 128);
		const opnFrequencyStep = opnClock / (144 * 2 ** 20);
		/* Incorporate the upper 4 bits of an OPN style frequency number into the key code
		 * 2048 / 128 = 16 (= 4 bits) But additionally there's the multiply by 0.5 aspect when
		 * converting from a frequency number into Hertz.*/
		this.hertzToFBits = 32 * opnFrequencyStep;

		if (this.noiseChannel) {
			this.noiseChannel.setClockRate(context, clockRate);
		}
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

	useLFOPreset(presetNum, time = 0, method = 'setValueAtTime') {
		let rate;
		if (presetNum === 0) {
			rate = 0;
		} else {
			rate = this.synth.lfoRateDividend / LFO_DIVISORS[presetNum - 1];
		}
		this.setLFORate(rate, time, method);
	}

	getLFOPreset() {
		const rate = this.getLFORate();
		if (rate === 0) {
			return 0;
		}
		const divisor = Math.round(this.synth.lfoRateDividend / rate);
		const index = LFO_DIVISORS.indexOf(divisor);
		return index === -1 ? -1 : index + 1;
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

	/**Approximates keyCode in the FM synth but derives the key code from a frequency in Hertz
	 * rather than a Yamaha frequency number.
	 */
	keyCode(frequency) {
		const multiple = frequency / this.hertzToFBits;
		const block = Math.max(Math.ceil(Math.log2(multiple / 16)), 0);
		const remainder = Math.trunc(multiple / (2 ** block));
		const f11 = remainder >= 8;
		const lsb = remainder > 8 || remainder === 7;
		return (block << 2) + (f11 << 1) + lsb;
	}

}

export {
	PSG, NoiseChannel, ToneChannel,
	TREMOLO_PRESETS
}
