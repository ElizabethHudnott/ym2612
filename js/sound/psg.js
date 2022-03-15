import {
	decibelReductionToAmplitude, amplitudeToDecibels, CLOCK_RATE as OPN_CLOCK_RATE,
	LFO_FREQUENCIES, VIBRATO_PRESETS
} from './common.js';

const AMPLITUDES = new Array(31);
for (let i = 0; i <= 28; i++) {
	// Support 1/2 step volume levels, mimicked through rapidly alternating values on the real chip.
	AMPLITUDES[i] = decibelReductionToAmplitude(i);
}
AMPLITUDES[29] = 0.5 * AMPLITUDES[28];
AMPLITUDES[30] = 0;

const CLOCK_RATE = {
	PAL: 	3546893,
	NTSC: 	3579545
}

const CLOCK_RATIO = OPN_CLOCK_RATE.NTSC / CLOCK_RATE.NTSC;

const TREMOLO_PRESETS = [0, 1, 3, 6];

let supportsCancelAndHold;

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

		const tremolo = new GainNode(context);
		source.connect(tremolo);
		this.tremolo = tremolo;
		const tremoloGain = new GainNode(context, {gain: 0});
		tremoloGain.connect(tremolo.gain);
		this.tremoloAmp = tremoloGain.gain;
		lfo.connect(tremoloGain);

		const envelopeGain = new GainNode(context, {gain: 0});
		tremolo.connect(envelopeGain);
		envelopeGain.connect(output);
		this.envelopeGain = envelopeGain;
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
		const newSource = this.makeSource(context, time);
		newSource.start(time);
		newSource.connect(this.tremolo);
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

	constructor(synth, context, lfo1, lfo2, output, reciprocalTable) {
		this.synth = synth;
		const saw = new OscillatorNode(context, {frequency: 0, type: 'sawtooth'});
		this.saw = saw;
		const frequency = new ConstantSourceNode(context, {offset: 0});
		this.frequencyNode = frequency;
		this.frequencyControl = frequency.offset;
		const fmMod = new GainNode(context);
		frequency.connect(fmMod);
		this.fmMod = fmMod.gain;
		const vibratoDepth = new GainNode(context, {gain: 0});
		vibratoDepth.connect(fmMod.gain);
		this.vibratoDepth = vibratoDepth.gain;
		lfo1.connect(vibratoDepth);
		fmMod.connect(saw.frequency);

		const reciprocalInputScaler = new GainNode(context, {gain: 2 / synth.maxFrequency});
		fmMod.connect(reciprocalInputScaler);
		const reciprocal = new WaveShaperNode(context, {curve: reciprocalTable});
		reciprocalInputScaler.connect(reciprocal);
		const reciprocalShift = new ConstantSourceNode(context, {offset: -1});
		this.reciprocalShift = reciprocalShift;
		reciprocalShift.connect(reciprocal);
		this.reciprocal = reciprocal;
		const dutyCycle = new GainNode(context, {gain: 0.5});
		reciprocal.connect(dutyCycle);
		this.dutyCycle = dutyCycle.gain;
		const delay = new DelayNode(context, {delayTime: 0, maxDelayTime: 0.5});
		saw.connect(delay);
		dutyCycle.connect(delay.delayTime);
		const inverter = new GainNode(context, {gain: -1});
		delay.connect(inverter);
		this.wave = inverter.gain;
		const dcOffset = new ConstantSourceNode(context, {offset: 0});
		dcOffset.connect(inverter);
		this.dcOffset = dcOffset;
		const waveGain = new GainNode(context, {gain: 0});
		saw.connect(waveGain);
		inverter.connect(waveGain);
		this.waveAmp = waveGain.gain;

		const constant = new ConstantSourceNode(context, {offset: 0.5});
		this.constant = constant.offset;
		this.constantNode = constant;

		const pwm = new GainNode(context, {gain: 0});
		lfo2.connect(pwm);
		pwm.connect(dutyCycle.gain);
		const times2 = new GainNode(context, {gain: 2});
		pwm.connect(times2);
		times2.connect(dcOffset.offset);
		this.pwm = pwm.gain;

		const tremolo = new GainNode(context);
		waveGain.connect(tremolo);
		constant.connect(tremolo);
		this.tremolo = tremolo.gain;
		const tremoloGain = new GainNode(context, {gain: 0});
		tremoloGain.connect(tremolo.gain);
		this.tremoloAmp = tremoloGain.gain;
		lfo1.connect(tremoloGain);

		const envelopeGain = new GainNode(context, {gain: 0});
		tremolo.connect(envelopeGain);
		envelopeGain.connect(output);
		this.envelopeGain = envelopeGain;

		this.frequency = 0;
		this.lastFreqChange = 0;
		this.keyCode = -Infinity;
	}

	start(time = 0) {
		this.saw.start(time);
		this.frequencyNode.start(time);
		this.reciprocalShift.start(time);
		this.dcOffset.start(time);
		this.constantNode.start(time);
	}

	stop(time = 0) {
		this.saw.stop(time);
		this.frequencyNode.stop(time);
		this.reciprocalShift.stop(time);
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
		this.keyCode = this.synth.calcKeyCode(frequency);
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
		this.wave[method](-value, time);
	}

	getWave() {
		return -this.wave.value;
	}

	setDutyCycle(value, time = 0, method = 'setValueAtTime') {
		this.dutyCycle[method](value, time);
		this.dcOffset.offset[method](2 * value - 1, time);
	}

	getDutyCycle() {
		return (this.dcOffset.offset.value + 1) / 2;
	}

	setPWMDepth(amount, time = 0, method = 'setValueAtTime') {
		this.pwm[method](amount, time);
	}

	getPWMDepth() {
		return this.pwm.value;
	}

	setTremoloDepth(depth, time = 0, method = 'setValueAtTime') {
		const linearAmount = 1 - decibelReductionToAmplitude(2 * depth);
		this.tremoloAmp[method](linearAmount, time);
		this.tremolo[method](1 - linearAmount, time);
	}

	getTremoloDepth() {
		return amplitudeToDecibels(this.tremoloAmp.value) / 2;
	}

	useTremoloPreset(presetNum, time = 0) {
		this.setTremoloDepth(TREMOLO_PRESETS[presetNum], time);
	}

	getTremoloPreset() {
		return TREMOLO_PRESETS.indexOf(Math.round(this.getTremoloDepth()));
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const depth = (2 ** (cents / 1200)) - 1;
		this.vibratoDepth[method](depth, time);
	}

	getVibratoDepth() {
		return this.vibratoDepth.value;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		return VIBRATO_PRESETS.indexOf(this.getVibratoDepth());
	}

}

class PSG {

	constructor(context, output = context.destination, numWaveChannels = 3, clockRate = CLOCK_RATE.PAL, callback = undefined) {
		this.setClockRate(context, clockRate);
		this.noteFrequencies = this.tunedMIDINotes(440);

		let frequencyLimit = context.sampleRate / 2;
		if (frequencyLimit > 24000) {
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

		const lfo1 = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.lfo1 = lfo1;
		supportsCancelAndHold = lfo1.frequency.cancelAndHoldAtTime !== undefined;
		const lfo2 = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.lfo2 = lfo2;

		const channelGain = new GainNode(context, {gain: 1 / (numWaveChannels + 1)});
		channelGain.connect(context.destination);
		const channels = [];
		for (let i = 0; i < numWaveChannels; i++) {
			const channel = new ToneChannel(this, context, lfo1, lfo2, channelGain, reciprocalTable);
			channels[i] = channel;
		}
		const noiseChannel = new NoiseChannel(context, lfo1, channelGain, clockRate);
		noiseChannel.connectIn(channels[2].frequencyNode);
		channels[numWaveChannels] = noiseChannel;
		this.noiseChannel = noiseChannel;
		this.channels = channels;
	}

	setClockRate(context, clockRate) {
		this.clockRate = clockRate;
		const opnClock = clockRate * CLOCK_RATIO;
		this.lfoRateMultiplier = opnClock / 8000000;
		const opnFrequencyStep = opnClock / (144 * 2 ** 20);
		// Incorporate the upper 4 bits of an OPN style frequency number into the key code
		// 2048 / 128 = 16 But there's a multiply/divide by 2 aspect as well.
		this.hertzToFBits = 64 * opnFrequencyStep;

		if (this.noiseChannel) {
			this.noiseChannel.setClockRate(context, clockRate);
		}
	}

	start(time) {
		this.lfo1.start(time);
		this.lfo2.start(time);
		for (let channel of this.channels) {
			channel.start(time);
		}
	}

	stop(time = 0) {
		this.lfo1.stop(time);
		this.lfo2.stop(time);
		for (let channel of this.channels) {
			channel.stop(time);
		}
	}

	setLFOFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo1.frequency[method](frequency, time);
	}

	getLFOFrequency() {
		return this.lfo1.frequency.value;
	}

	useLFOPreset(n, time = 0) {
		this.setLFOFrequency(LFO_FREQUENCIES[n] * this.lfoRateMultiplier, time);
	}

	getLFOPreset() {
		let frequency = this.getLFOFrequency() / this.lfoRateMultiplier;
		frequency = Math.round(frequency * 100) / 100;
		return LFO_FREQUENCIES.indexOf(frequency);
	}

	setPWMFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo2.frequency[method](frequency, time);
	}

	getPWMFrequency() {
		return this.lfo2.frequency.value;
	}

	frequencyNumberToHz(frequencyNumber) {
		if (frequencyNumber === 0) {
			frequencyNumber = 1;
		}
		return this.clockRate / (32 * frequencyNumber);
	}

	frequencyToFreqNumber(frequency) {
		return frequency === 0 ? 0 : this.clockRate / (32 * frequency);
	}

	tunedMIDINotes(a4Pitch) {
		const SEMITONE = 2 ** (1 / 12);
		const clockRate = this.clockRate;
		const frequencies = new Array(128);
		let prevFreqNum, prevIdealFrequency;
		for (let i = 0; i < 128; i++) {
			const idealFrequency = a4Pitch * 2 ** ((i - 69) / 12);
			let freqNum = Math.round(this.frequencyToFreqNumber(idealFrequency));
			const approxFrequency = this.frequencyNumberToHz(freqNum);

			if (freqNum === prevFreqNum) {
				const error = Math.abs((approxFrequency - idealFrequency) / idealFrequency);
				const prevError = Math.abs((approxFrequency - prevIdealFrequency) / prevIdealFrequency);
				if (error > prevError && idealFrequency > approxFrequency) {
					// This note is further from nearest note on the chip's frequency scale.
					frequencies[i] = approxFrequency * SEMITONE;
					freqNum = undefined;
				} else {
					// This note is closest.
					frequencies[i] = approxFrequency;
					frequencies[i - 1] = approxFrequency / SEMITONE;
				}
			} else if (prevFreqNum === undefined && i > 0) {
				if (approxFrequency > frequencies[i - 1]) {
					frequencies[i] = approxFrequency;
				} else {
					frequencies[i] = frequencies[i - 1] * SEMITONE;
					freqNum = undefined;
				}
			} else {
				frequencies[i] = approxFrequency;
			}

			prevFreqNum = freqNum;
			prevIdealFrequency = idealFrequency;
		}
		return frequencies;
	}

	getLFO(n) {
		return n === 1 ? this.lfo1 : this.lfo2;
	}

	/**Approximates calcKeyCode in opn2.js, but derives the key code from a frequency in
	 * Hertz rather than an OPN style frequency number.
	 */
	calcKeyCode(frequency) {
		// Multiply by 2 here because we multiply by 0.5 when going from a frequency number to Hertz.
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
	TREMOLO_PRESETS, CLOCK_RATE, CLOCK_RATIO
}
