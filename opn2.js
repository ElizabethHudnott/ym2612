
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
	const root = 2 ** (1 / 12);
	const frequencyData = [];
	for (let i = 0; i < 128; i++) {
		const frequency = (root ** (i - 69)) * 440;
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

class FMOperator {

	constructor(context, output, canFeedback) {
		const sine = new OscillatorNode(context);
		this.sine = sine;

		const delay = new DelayNode(context, {delayTime: 1 / 880});
		sine.connect(delay);
		this.delay = delay.delayTime;
		const delayAmp = new GainNode(context, {gain: 1 / 880});
		delayAmp.connect(delay.delayTime);
		this.delayAmp = delayAmp;

		const amMod = new GainNode(context);
		delay.connect(amMod);
		this.amMod = amMod;
		const amModAmp = new GainNode(context, {gain: 0});
		amModAmp.connect(amMod.gain);
		this.amModAmp = amModAmp;

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

	connectLFO(am, fm) {
		am.connect(this.amModAmp);
		fm.connect(this.sine.frequency);
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, frequencyMultiple = 1, method = 'setValueAtTime') {
		const frequency = (frequencyNumber << blockNumber) * FREQUENCY_STEP * frequencyMultiple;
		const delayTime = 1 / (frequency * 2);
		this.sine.frequency[method](frequency, time);
		this.delay[method](delayTime, time);
		this.delayAmp.gain[method](delayTime, time);
		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = NOTE_FREQUENCIES[noteNumber];
		this.setFrequency(block, frequencyNumber, time, 1, method);
	}

	/*
	 * @param {number} amount As a multiple of PI.
	 */
	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.feedback[method](amount, time);
	}

	setAM(amount, time = 0, method = 'setValueAtTime') {
		this.amModAmp[method](amount / 2, time);
		this.amMod[method](0.5 + 0.5 * (1 - amount), time);
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

class FMChannel {

	constructor(context, lfo, output) {
		const panner = new StereoPannerNode(context);
		panner.connect(output);
		this.panControl = panner.pan;
		const op1 = new FMOperator(context, panner, true);
		const op2 = new FMOperator(context, panner, false);
		const op3 = new FMOperator(context, panner, false);
		const op4 = new FMOperator(context, panner, false);
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

		const lfoAmp = new GainNode(context, {gain: 0});
		lfo.connect(lfoAmp);
		this.lfoAmp = lfoAmp;

		this.frequencyMultiples = [1, 1, 1, 1];
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
			this.operators[i].setFrequency(blockNumber, frequencyNumber, time, this.frequencyMultiples[i], method);
		}
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = NOTE_FREQUENCIES[noteNumber];
		this.setFrequency(block, frequencyNumber, time, method);
	}

	updateOperatorPitches(time = 0, method = 'setValueAtTime') {
		const op1 = this.operators[0];
		this.setFrequency(op1.freqBlockNumber, op1.frequencyNumber, time, method);
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.operators[0].setFeedback(amount, time, method);
	}

	setFeedbackNumber(n, time = 0) {
		let amount;
		if (n === 0) {
			amount = 0;
		} else {
			amount = 2 ** (n - 6);
		}
		this.setFeedback(amount, time);
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

export {FMSynth, NOTE_FREQUENCIES};
