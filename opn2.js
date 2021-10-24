
class Envelope {

	constructor(gainNode) {
		gainNode.gain.value = 0;
		this.gain = gainNode.gain;
	}

	keyOn(time) {
		this.gain.setValueAtTime(1, time);
	}

	soundOff(time = 0) {
		this.gain.cancelAndHoldAtTime(time);
		this.gain.setValueAtTime(0, time);
	}

}

const FREQUENCY_STEP = 0.025157;

const NOTE_FREQUENCIES = function () {
	const frequencyData = [];
	for (let i = 0; i < 128; i++) {
		const frequency = 440 * (2 ** ((i - 69) / 12));
		let freqNum = frequency / FREQUENCY_STEP;
		let block = 0;
		while (freqNum >= 2047.5) {
			freqNum /= 2;
			block++;
		}
		frequencyData[i] = [block, Math.round(freqNum)];
	}
	return frequencyData;
}();

const DETUNE_AMOUNTS = [
/* Preset 0 */
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
/* Preset +-1 */
	0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
	2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8,
/* Preset +-2 */
	1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5,
	5, 6, 6, 7, 8, 8, 9,10,11,12,13,14,16,16,16,16,
/* Preset +-3 */
	2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7,
	8 , 8, 9,10,11,12,13,14,16,17,19,20,22,22,22,22
].map(x => x * 1.164 / 22);

class FMOperator {

	constructor(context, amModulator, fmLFModulator, output, canFeedback) {
		const sine = new OscillatorNode(context);
		this.sine = sine;

		const delay = new DelayNode(context, {delayTime: 1 / 440});
		sine.connect(delay);
		this.delay = delay.delayTime;
		const delayAmp = new GainNode(context, {gain: 1 / 220});
		delayAmp.connect(delay.delayTime);
		this.delayAmp = delayAmp;
		fmLFModulator.connect(delayAmp);

		const amMod = new GainNode(context);
		delay.connect(amMod);
		this.amMod = amMod.gain;
		const amModGain = new GainNode(context, {gain: 0});
		amModGain.connect(amMod.gain);
		this.amModAmp = amModGain.gain;
		amModulator.connect(amModGain);

		const envelopeGain = new GainNode(context);
		amMod.connect(envelopeGain);
		this.envelope = new Envelope(envelopeGain);
		this.envelopeGain = envelopeGain;

		const mixer = new GainNode(context, {gain: 0.25});
		envelopeGain.connect(mixer);
		mixer.connect(output);
		this.mixer = mixer.gain;

		if (canFeedback) {
			const feedback = new GainNode(context, {gain: 0});
			envelopeGain.connect(feedback);
			feedback.connect(delayAmp);
			this.feedback = feedback.gain;
		}

		this.freqBlockNumber = 4;
		this.frequencyNumber = 1093;
		this.keyCode = 18;
		this.detune = 0;
	}

	start(time) {
		this.sine.start(time);
	}

	connectIn(source) {
		source.connect(this.delayAmp);
	}

	connectOut(destination) {
		this.envelopeGain.connect(destination);
	}

	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		const keyCode = (blockNumber << 2) + (frequencyNumber >> 9);
		const detuneSetting = this.detune;
		const detuneTableOffset = (detuneSetting & 3) << 5;
		const detuneSign = (-1) ** (detuneSetting >> 2);
		const detuneMultiple = 1 + detuneSign * DETUNE_AMOUNTS[detuneTableOffset + keyCode];

		const frequency = (frequencyNumber << blockNumber) * FREQUENCY_STEP * frequencyMultiple * detuneMultiple;
		const period = 1 / frequency;
		this.sine.frequency[method](frequency, time);
		this.delay[method](period, time);
		this.delayAmp.gain[method](0.5 * period, time);
		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
		this.keyCode = keyCode;
	}

	setMIDINote(noteNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = NOTE_FREQUENCIES[noteNumber];
		this.setFrequency(block, frequencyNumber, frequencyMultiple, time, method);
	}

	/*
	 * @param {number} amount As a multiple of PI.
	 */
	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.feedback[method](amount, time);
	}

	setAM(linearAmount, time = 0, method = 'setValueAtTime') {
		const amplitude = linearAmount / 2;
		this.amModAmp[method](amplitude, time);
		this.amMod[method](1 - amplitude, time);
	}

	setVolume(level, time = 0, method = 'setValueAtTime') {
		this.mixer[method](level, time);
	}

	keyOn(time) {
		this.envelope.keyOn(time);
	}

	soundOff(time = 0) {
		this.envelope.soundOff(time);
	}

}

const ALGORITHMS = [
	// 1 -> 2 -> 3 -> 4
	[[1, 0, 0, 1, 0, 1], [0, 0, 0, 1]],

	// 1 \
	//    |--> 3 -> 4
	// 2 /
	[[0, 1, 0, 1, 0, 1], [0, 0, 0, 1]],

	// 1 -----\
	//         |--> 4
	// 2 -> 3 /
	[[0, 0, 1, 1, 0, 1], [0, 0, 0, 1]],


	// 1 -> 2 \
	//        |--> 4
	// 3 -----/
	[[1, 0, 0, 0, 1, 1], [0, 0, 0, 1]],

	// 1 -> 2
	// 3 -> 4
	[[1, 0, 0, 0, 0, 1], [0, 0.5, 0, 0.5]],

	//   /--> 2 
	// 1 |--> 3
	//   \--> 4
	[[1, 1, 1, 0, 0, 0], [0, 1/3, 1/3, 1/3]],

	// 1 -> 2
	//      3
	//      4
	[[1, 0, 0, 0, 0, 0], [0, 1/3, 1/3, 1/3]],

	// No modulation
	[[0, 0, 0, 0, 0, 0], [0.25, 0.25, 0.25, 0.25]],
];

function decibelsToAmplitude(decibels) {
	return 1 - 10 ** (-decibels / 20);
}

const AM_PRESETS = [0, 1.4, 5.9, 11.8].map(decibelsToAmplitude);

const LF_PM_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80].map(x => (2 ** (x / 1200)) - 1);

class FMChannel {

	constructor(context, lfo, output) {
		const panner = new StereoPannerNode(context);
		panner.connect(output);
		this.panControl = panner.pan;

		//LFO affecting FM
		const lfoGain = new GainNode(context, {gain: 0});
		lfo.connect(lfoGain);
		this.lfoAmp = lfoGain.gain;

		const op1 = new FMOperator(context, lfo, lfoGain, panner, true);
		const op2 = new FMOperator(context, lfo, lfoGain, panner, false);
		const op3 = new FMOperator(context, lfo, lfoGain, panner, false);
		const op4 = new FMOperator(context, lfo, lfoGain, panner, false);
		this.operators = [op1, op2, op3, op4];

		const op1To1 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To1);
		op1.connectIn(op1To1);
		const op1To2 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To2);
		op2.connectIn(op1To2);
		const op1To3 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To3);
		op3.connectIn(op1To3);
		const op1To4 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To4);
		op4.connectIn(op1To4);

		const op2To3 = new GainNode(context, {gain: 0});
		op2.connectOut(op2To3);
		op3.connectIn(op2To3);
		const op2To4 = new GainNode(context, {gain: 0});
		op2.connectOut(op2To4);
		op4.connectIn(op2To4);

		const op3To4 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To4);
		op4.connectIn(op3To4);

		this.gains = [
			op1To1.gain, op1To2.gain, op1To3.gain, op1To4.gain,
			op2To3.gain, op2To4.gain,
			op3To4.gain
		];

		this.frequencyMultiples = [1, 1, 1, 1];

		this.amAmount = 0;
		this.amEnabled = [false, false, false, false];

		this.setAlgorithmNumber(7);
	}

	start(time) {
		for (let operator of this.operators) {
			operator.start(time);
		}
	}

	setAlgorithm(modulations, outputLevels, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 6; i++) {
			this.gains[i + 1][method](modulations[i], time);
		}
		for (let i = 0; i < 4; i++) {
			this.operators[i].setVolume(outputLevels[i], time, method);
		}
	}

	setAlgorithmNumber(algorithmNum, time = 0) {
		const algorithm = ALGORITHMS[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time);
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 4; i++) {
			this.operators[i].setFrequency(blockNumber, frequencyNumber, this.frequencyMultiples[i], time, method);
		}
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = NOTE_FREQUENCIES[noteNumber];
		this.setFrequency(block, frequencyNumber, time, method);
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.operators[0].setFeedback(amount, time, method);
	}

	setFeedbackNumber(n, time = 0) {
		this.setFeedback(n / 14, time);
	}

	setAMAmount(amount, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 4; i++) {
			if (this.amEnabled[i]) {
				this.operators[i].setAM(amount, time, method);
			}
		}
		this.amAmount = amount;
	}

	useAMPreset(presetNum, time = 0) {
		this.setAMAmount(AM_PRESETS[presetNum], time);
	}

	enableAM(operatorNum, enabled, time = 0, method = 'setValueAtTime') {
		if (enabled) {
			this.operators[operatorNum].setAM(this.amAmount, time, method);
			this.amEnabled[operatorNum] = true;
		} else {
			this.operators[operatorNum].setAM(0, time, method);
			this.amEnabled[operatorNum] = false;
		}
	}

	setLFPMAmount(amount, time = 0, method = 'setValueAtTime') {
		this.lfoAmp[method](amount, time);
	}

	useLFPMPresent(presetNum, time = 0) {
		this.setLFPMAmount(LF_PM_PRESETS[presetNum], time);
	}

	keyOn(time, op1 = true, op2 = true, op3 = true, op4 = true) {
		const operators = this.operators
		if (op1) {
			operators[0].keyOn(time);
		}
		if (op2) {
			operators[1].keyOn(time);
		}
		if (op3) {
			operators[2].keyOn(time);
		}
		if (op4) {
			operators[3].keyOn(time);
		}
	}

	soundOff(time = 0) {
		for (let operator of this.operators) {
			operator.soundOff(time);
		}
	}

	/**
	 * @param {number} panning -1 = left channel only 1 = right channel only
	 */
	pan(panning, time = 0, method = 'setValueAtTime') {
		this.panControl[method](panning, time);
	}

}

const LFO_FREQUENCIES = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2];

class FMSynth {
	constructor(context, numChannels = 6, pal = false) {
		const lfo = new OscillatorNode(context, {frequency: 0});
		this.lfo = lfo;

		const channelGain = new GainNode(context, {gain : 1 / numChannels});
		channelGain.connect(context.destination);

		const channels = [];
		for (let i = 0; i < numChannels; i++) {
			const channel = new FMChannel(context, this.lfo, channelGain);
			channels[i] = channel;
		}
		this.channels = channels;

		this.clockMultiplier = (pal ? 7.61 : 7.67) / 8;
	}

	start(time) {
		this.lfo.start(time);
		for (let channel of this.channels) {
			channel.start(time);
		}
	}

	soundOff(time = 0) {
		for (let channel of this.channels) {
			channel.soundOff(time);
		}
	}

	setLFOFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo.frequency[method](frequency, time);
	}

	setLFOFrequencyNumber(n, time = 0) {
		if (n >= 8) {
			this.setLFOFrequency(0, time);
		} else {
			this.setLFOFrequency(LFO_FREQUENCIES[n] / this.clockMultiplier, time);
		}
	}

}

export {FMSynth, NOTE_FREQUENCIES, decibelsToAmplitude};
