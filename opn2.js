
/**
 * @param {number} n A number between 0 and 1
 * @return {number} A number between 0 and 1.
 */
function logToLinear(n) {
	return (2 ** n) - 1;
}

let supportsCancelAndHold;

function cancelAndHoldAtTime(param, holdValue, time) {
	if (supportsCancelAndHold) {
		param.cancelAndHoldAtTime(time);
	} else {
		param.cancelScheduledValues(time);
	}
	param.setValueAtTime(holdValue, time);
}

function calcKeyCode(blockNumber, frequencyNumber) {
	const f11 = frequencyNumber >= 1024;
	const lsb = frequencyNumber >= 1152 || (!f11 && frequencyNumber >= 896);
	return (blockNumber << 2) + (f11 << 1) + lsb;
}

// For decay, sustain and release
const ENV_INCREMENT = new Array(64);
{
	const increments = [0, 0, 4, 4, 4, 4, 6, 6];
	for (let i = 0; i < 60; i++) {
		const power = Math.trunc(i / 4) - 14;
		const multiple = i < 8 ? increments[i] : ((i % 4) + 4);
		ENV_INCREMENT[i] =  multiple * (2 ** power);
	}
	ENV_INCREMENT.fill(8, 60);
}

class Envelope {

	/**Creates an envelope.
	 * @param {GainNode} gainNode The GainNode to be controlled by the envelope.
	 */
	constructor(gainNode, tickRate) {
		gainNode.gain.value = 1;
		this.gain = gainNode.gain;
		this.tickRate = tickRate;
		this.attackRate = 16;
		this.rateScaling = 0;
		this.decayRate = 16;
		this.sustainRate = 0;
		this.releaseRate = 16;
		// These have been pre-scaled 0..127 -> 0..1023
		this.totalLevel = 1023;
		this.sustain = 400;

		// Values stored during key on.
		this.linearPeak = 0;
		this.endAttack = 0;
		this.linearSustain = 0;
		this.endDecay = 0;
		this.endSustain = 0;
		this.keyIsOn = false;
	}

	/**
	 * Don't call with rate = 0, because that means infinite time.
	 */
	decayTime(from, to, rate, rateAdjust) {
		const gradient = ENV_INCREMENT[Math.min(2 * rate + rateAdjust, 63)];
		return this.tickRate * (from - to) / gradient;
	}

	/**Opens the envelope at a specified time.
	 */
	keyOn(velocityProportion, keyCode, time) {
		if (this.keyIsOn) {
			return;
		}

		const rateAdjust = Math.trunc(keyCode >> (3 - this.rateScaling));
		const gain = this.gain;

		const linearPeak = this.totalLevel * velocityProportion;
		const expPeak = 1 + logToLinear(linearPeak / 1023);

		const endAttack = time;
		gain.setValueAtTime(expPeak, time);

		this.keyIsOn = true;
		this.linearPeak = linearPeak;
		this.endAttack = endAttack;

		if (this.decayRate === 0) {
			this.endDecay = Infinity;
			this.endSustain = Infinity;
			return;
		}

		const linearSustain = this.sustain * velocityProportion;
		const expSustain = 1 + logToLinear(linearSustain / 1023);
		const decay = this.decayTime(linearPeak, linearSustain, this.decayRate, rateAdjust);
		const endDecay = endAttack + decay;
		gain.exponentialRampToValueAtTime(expSustain, endDecay);
		this.linearSustain = linearSustain;
		this.endDecay = endDecay;
		if (linearSustain === 0) {
			this.endSustain = endDecay;
			return;
		} else if (this.sustainRate === 0) {
			this.endSustain = Infinity;
			return;
		}

		const sustainTime = this.decayTime(linearSustain, 0, this.sustainRate, rateAdjust);
		const endSustain = endDecay + sustainTime;
		gain.exponentialRampToValueAtTime(1, endSustain);
	}

	linearValueAtTime(time) {
		const linearPeak = this.linearPeak;
		const endAttack = this.endAttack;
		const endDecay = this.endDecay;
		const linearSustain = this.linearSustain;
		const endSustain = this.endSustain;
		let linearValue;

		if (time >= endSustain) {
			return 0;
		}

		if (time >= endDecay) {
			// In the sustain phase
			if (endSustain === Infinity) {
				linearValue = linearSustain;
			} else {
				const timeProportion = (time - endDecay) / (endSustain - endDecay);
				linearValue = linearSustain * timeProportion;
			}
		} else if (time >= endAttack) {
			// In the decay phase
			if (endDecay === Infinity) {
				linearValue = linearPeak;
			} else {
				const timeProportion = (time - endAttack) / (endDecay - endAttack);
				linearValue = linearPeak -  (linearPeak - linearSustain) * timeProportion;
			}
		}
		return linearValue;
	}

	/**Closes the envelope at a specified time.
	 */
	keyOff(keyCode, time) {
		if (!this.keyIsOn) {
			return;
		}
		const linearValue = this.linearValueAtTime(time);
		const rateAdjust = Math.trunc(keyCode >> (3 - this.rateScaling));;
		const releaseTime = this.decayTime(linearValue, 0, this.releaseRate, rateAdjust);
		const currentValue = 1 + logToLinear(linearValue / 1023);
		const gain = this.gain;
		cancelAndHoldAtTime(gain, currentValue, time);
		gain.exponentialRampToValueAtTime(1, time + releaseTime);
		this.keyIsOn = false;
	}

	/**Cuts audio output without going through the envelope's release phase.
	 * @param {number} time When to stop outputting audio. Defaults to ceasing sound production immediately.
	 */
	soundOff(time = 0) {
		cancelAndHoldAtTime(this.gain, 1, time);
	}

}


/**The amount to detune each note by when the various detuning settings are applied. The
 * array is organized into four sequential blocks of 32 values each. The first block
 * represents the changes in frequency from the basic scale when an operator's detuning
 * parameter is set to 0 (should be 32 zeros!). The second block represents the increases
 * in frequency when the detuning parameter is set to 1 and the decreases in frequency
 * when the detuning parameter is set to 5, and so on. Each block of 32 values contains a
 * single entry for each of the YM2612's "key codes". The find a note's key code you
 * multiply its block number by 4 and place the two most significant bits of its frequency
 * number into the two least significant bits of the key code. Each value in the array
 * (per detuning value, per key code) is a multiplier that's applied as a deviation from
 * the note's normal frequency. For example, a value of 0.05 represents a 5% increase or
 * decrease applied to the note's frequency in Hertz.
 * @type {Array<number}
 */
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

/**Represents a single operator in the FM synthesizer. The synthesizer alters frequency
 * using phase modulation (PM). There are 4 operators per sound channel and 6 independent
 * channels by default.
 */
class PMOperator {

	/**Constructs an instance of an operator. Operators are normally created by
	 * invoking the {@link PMSynth} constructor.
	 * @param {AudioContext} context The Web Audio context.
	 * @param {AudioNode} lfModulator The signal used as an LFO to control the operator's phase.
	 * @param {AudioNode} amModulator The signal used to apply amplitude modulation to the oscillator's output.
	 * @param {AudioNode} output The destination to route the operator's audio output to
	 * or undefined if the operator will always be used as a modulator.
	 *
	 */
	constructor(synth, context, lfModulator, amModulator, minusOne, output, envelopeTick) {
		const sine = new OscillatorNode(context);
		this.sine = sine;

		const delay = new DelayNode(context, {delayTime: 1 / 220});
		sine.connect(delay);
		this.delay = delay.delayTime;
		const delayAmp = new GainNode(context, {gain: 1 / 440});
		delayAmp.connect(delay.delayTime);
		this.delayAmp = delayAmp;
		lfModulator.connect(delayAmp);

		const amMod = new GainNode(context);
		delay.connect(amMod);
		this.amMod = amMod.gain;
		const amModGain = new GainNode(context, {gain: 0});
		amModGain.connect(amMod.gain);
		this.amModAmp = amModGain.gain;
		amModulator.connect(amModGain);

		const envelopeGain = new GainNode(context);
		amMod.connect(envelopeGain);
		minusOne.connect(envelopeGain.gain);
		this.envelope = new Envelope(envelopeGain, envelopeTick);
		this.envelopeGain = envelopeGain;

		if (output !== undefined) {
			const mixer = new GainNode(context, {gain: 0.25});
			envelopeGain.connect(mixer);
			mixer.connect(output);
			this.mixer = mixer.gain;
		}

		this.synth = synth;
		this.freqBlockNumber = 4;
		this.frequencyNumber = 1093;
		this.keyCode = calcKeyCode(4, 1093);
		this.frequencyMultiple = 1;

		// Public fields
		this.detune = 0;
	}

	/**Starts the operator's oscillator.
	 * Operators are normally started by calling start() on an instance of {@link PMSynth}.
	 */
	start(time) {
		this.sine.start(time);
	}

	/**Stops the operator's oscillator so that the operator's system resources can be released.
	 * Operators are normally stopped by calling stop() on an instance of {@link PMSynth}.
	 */
	stop(time = 0) {
		this.sine.stop(time);
	}

	/**Configures this operator to have its phase modulated from an external source (usually another operator).
	 * This method is usually called by the {@link PMChannel} constructor.
	 * @param {AudioNode} source The source to use to modulate this operator's oscillator.
	 */
	connectIn(source) {
		source.connect(this.delayAmp);
	}

	/**Configures this operator to modulate an external source (usually another operator).
	 * This method is usually called by the {@link PMChannel} constructor.
	 * @param {AudioNode} destination The signal to modulate.
	 */
	connectOut(destination) {
		this.envelopeGain.connect(destination);
	}

	/**Changes the operator's frequency. This method is usually invoked by an instance of
	 * {@link PMChannel} (e.g. by its setFrequency() method) but it can also be useful to
	 * invoke this method directly for individual operators to create dissonant sounds.
	 * @param {number} blockNumber A kind of octave measurement. See {@link PMSynth.noteFrequencies}.
	 * @param {number} frequencyNumber A linear frequency measurement. See {@link PMSynth.noteFrequencies}.
	 * @param {number} [frequencyMultiple] After the basic frequency in Hertz is calculated
	 * from the block number and frequency number the result is then multiplied by this
	 * number. Defaults to 1.
	 * @param {number} [time] When to change frequency. Defaults to immediately.
	 * @param {string} [method] How to change from one frequency to another. One of
	 * 'setValueAtTime', 'linearRampToValueAtTime' or 'exponentialRampToValueAtTime'.
	 * Defaults to 'setValueAtTime'.
	 */
	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		const keyCode = calcKeyCode(blockNumber, frequencyNumber);
		const detuneSetting = this.detune;
		const detuneTableOffset = (detuneSetting & 3) << 5;
		const detuneSign = (-1) ** (detuneSetting >> 2);
		const detuneMultiple = 1 + detuneSign * DETUNE_AMOUNTS[detuneTableOffset + keyCode];

		let frequency = (frequencyNumber << blockNumber) * this.synth.frequencyStep;
		frequency *= frequencyMultiple * detuneMultiple;
		const period = 1 / frequency;
		this.sine.frequency[method](frequency, time);
		this.delay[method](period, time);
		this.delayAmp.gain[method](0.5 * period, time);
		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
		this.keyCode = keyCode;
		this.frequencyMultiple = frequencyMultiple;
	}

	/**Returns the block number associated with the operator's current frequency.
	 * See {@link PMSynth.noteFrequencies}.
	 */
	getFrequencyBlock() {
		return this.freqBlockNumber;
	}

	/**Returns the frequency number associated with the operator's current frequency.
	 * See {@link PMSynth.noteFrequencies}.
	 */
	getFrequencyNumber() {
		return this.frequencyNumber;
	}

	/** Configures the amount of detuning.
	 * @param {number} extent The amount of detuning. Zero means no detuning, 1 raises the
	 * pitch a little, 2 raises the pitch moderately, 3 raises the pitch a lot. 5 lowers
	 * the pitch a little, 6 lowers it moderately, 7 lowers it a lot.
	 * @param {number} [time] When to alter the detuning. Defaults to whenever
	 * setFrequency() or setMIDINote() is next called.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setDetune(extent, time = undefined, method = 'setValueAtTime') {
		this.detune = extent;
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time, method);
		}
	}

	/**Returns the most recently used detuning value. */
	getDetune() {
		return this.detune;
	}

	/**Sets the operator's frequency using a more convenient method than the YM2612's
	 * block and frequency number notation.
	 * @param {number} noteNumber The MIDI note number in semitones. 60 = Middle C
	 * @param {number} [frequencyMultiple] The frequency is derived by multiplying the
	 * note's normal fundamental frequency by this number. Can be used to create chorus
	 * effects or dissonant tones. Defaults to 1.
	 * @param {number} [time
	 * @param {number} [time] When to change frequency. Defaults to immediately.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setMIDINote(noteNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = this.synth.noteFrequencies[noteNumber];
		this.setFrequency(block, frequencyNumber, frequencyMultiple, time, method);
	}

	/**Gets the MIDI note number of the note whose frequency is closest to the operator's
	 * current frequency.
	 */
	getMIDINote() {
		return this.synth.frequencyToNote(this.freqBlockNumber, this.frequencyNumber);
	}

	/** Specifies the degree to which this operator's output undergoes amplitude
	 * modulation from the synthesizer's LFO. This method is usually invoked by an instance
	 * of {@link PMChannel}. Use its enableAM(), useAMPreset() and setAMDepth() methods to
	 * configure amplitude modulation for the operators. However, if you wish then you can
	 * instead manually initiate amplitude modulation by invoking this method directly. This
	 * allows different operators to have differing levels of amplitude modulation.
	 * @param {number} linearAmount The amount of amplitude modulation to apply between 0
	 * and 1. Unlike the {@link PMChannel} methods this method uses a linear scale. You'll
	 * probably first want to convert from an exponential (decibels) scale to a linear scale
	 * using the decibelsToAmplitude() function in order to match human perception of
	 * loudness.
	 * @param {number} [time] When to change the amplitude modulation depth. Defaults to immediately.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setAMDepth(linearAmount, time = 0, method = 'setValueAtTime') {
		const amplitude = linearAmount / 2;
		this.amModAmp[method](amplitude, time);
		this.amMod[method](1 - amplitude, time);
	}

	/**Gets the amount of amplitude modulation being applied to the operator on a 0..1 linear scale. */
	getAMDepth() {
		return this.amModAmp.value * 2;
	}

	setVolume(level, time = 0, method = 'setValueAtTime') {
		this.mixer[method](level, time);
	}

	getVolume() {
		return this.mixer.value;
	}

	keyOn(amount, time) {
		this.envelope.keyOn(amount, this.keyCode, time);
	}

	keyOff(time) {
		this.envelope.keyOff(this.keyCode, time);
	}

	soundOff(time = 0) {
		this.envelope.soundOff(time);
	}

}

const ALGORITHMS = [
	/*	[
			[op1To2Gain, op1To3Gain, op1To4Gain, op2To3Gain, op2To4Gain, op3To4Gain],
			[op1OutputGain, op2OutputGain, op3OutputGain, op4OutputGain]
		]
	 */

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

function amplitudeToDecibels(amplitude) {
	return -20 * Math.log10(1 - amplitude);
}

const AM_PRESETS = [0, 1.4, 5.9, 11.8].map(decibelsToAmplitude);

const LF_PM_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80].map(x => (2 ** (x / 1200)) - 1);

class PMChannel {

	constructor(synth, context, lfo, minusOne, output, envelopeTick) {
		this.synth = synth;
		const panner = new StereoPannerNode(context);
		panner.connect(output);
		this.panControl = panner.pan;

		//LFO modulating phase
		const lfoGain = new GainNode(context, {gain: 0});
		lfo.connect(lfoGain);
		this.lfoAmp = lfoGain.gain;

		const op1 = new PMOperator(synth, context, lfoGain, lfo, minusOne, panner, envelopeTick);
		const op2 = new PMOperator(synth, context, lfoGain, lfo, minusOne, panner, envelopeTick);
		const op3 = new PMOperator(synth, context, lfoGain, lfo, minusOne, panner, envelopeTick);
		const op4 = new PMOperator(synth, context, lfoGain, lfo, minusOne, panner, envelopeTick);
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

		this.amDepth = 0;
		this.amEnabled = [false, false, false, false];
		this.transpose = 0;

		this.setAlgorithmNumber(7);
	}

	start(time) {
		for (let operator of this.operators) {
			operator.start(time);
		}
	}

	stop(time = 0) {
		for (let operator of this.operators) {
			operator.stop(time);
		}
	}

	getOperator(operatorNum) {
		return this.operators[operatorNum - 1];
	}

	setAlgorithm(modulations, outputLevels, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 6; i++) {
			this.gains[i + 1][method](modulations[i], time);
		}
		for (let i = 0; i < 4; i++) {
			this.operators[i].setVolume(outputLevels[i], time, method);
		}
		this.outputLevels = outputLevels.slice();
	}

	getModulationDepth(modulatorOpNum, carrierOpNum) {
		if (modulatorOpNum === 1 && carrierOpNum === 1) {
			return this.gains[0].value * 2;
		} else if (modulatorOpNum >= 4 || modulatorOpNum >= carrierOpNum) {
			return 0;
		} else {
			let index = 1;
			for (let i = modulatorOpNum - 1; i > 0; i--) {
				index += 4 - i;
			}
			index += carrierOpNum - modulatorOpNum - 1;
			return this.gains[index].value;
		}
	}

	setAlgorithmNumber(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = ALGORITHMS[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
	}

	getAlgorithmNumber() {
		algorithm: for (let i = 0; i < ALGORITHMS.length; i++) {
			const modulations = ALGORITHMS[i][0];
			for (let j = 0; j < 6; j++) {
				if (modulations[j] !== this.gains[j + 1].value) {
					continue algorithm;
				}
			}
			return i;
		}
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 4; i++) {
			this.operators[i].setFrequency(blockNumber, frequencyNumber, this.frequencyMultiples[i], time, method);
		}
	}

	getFrequencyBlock() {
		return this.operators[0].getFrequencyBlock();
	}

	getFrequencyNumber() {
		return this.operators[0].getFrequencyNumber();
	}

	setFrequencyMultiple(operatorNum, multiple, time = undefined, method = 'setValueAtTime') {
		this.frequencyMultiples[operatorNum] = multiple;
		if (time !== undefined) {
			const op1 = this.operators[0];
			const block = op1.getFrequencyBlock();
			const freqNum = op1.getFrequencyNumber();
			const operator = this.operators[operatorNum - 1];
			operator.setFrequency(block, freqNum, multiple, time, method);
		}
	}

	setFrequencyMultiples(op1, op2, op3, op4, time = undefined, method = 'setValueAtTime') {
		const multiples = [op1, op2, op3, op4];
		this.frequencyMultiples = multiples;
		if (time !== undefined) {
			const op1 = this.operators[0];
			const block = op1.getFrequencyBlock();
			const freqNum = op1.getFrequencyNumber();
			for (let i = 0; i < 4; i++) {
				this.operators[i].setFrequency(block, freqNum, multiples[i], time, method);
			}
		}
	}

	getFrequencyMultiple(operatorNum) {
		return this.frequencyMultiples[operatorNum];
	}

	setTranspose(transpose) {
		this.transpose = transpose;
	}

	getTranspose() {
		return this.transpose;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const realNote = noteNumber + this.transpose;
		const [block, frequencyNumber] = this.synth.noteFrequencies[realNote];
		this.setFrequency(block, frequencyNumber, time, method);
	}

	getMIDINote() {
		return this.operators[0].getMIDINote() - this.transpose;
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.gains[0][method](0.5 * amount, time);
	}

	getFeedback() {
		return this.gains[0].value * 2;
	}

	setFeedbackNumber(n, time = 0) {
		this.setFeedback(n / 14, time);
	}

	getFeedbackNumber() {
		return Math.round(this.getFeedback() * 14);
	}

	setAMDepth(decibels, time = 0, method = 'setValueAtTime') {
		const linearAmount = decibelsToAmplitude(decibels);
		for (let i = 0; i < 4; i++) {
			if (this.amEnabled[i]) {
				this.operators[i].setAMDepth(linearAmount, time, method);
			}
		}
		this.amDepth = linearAmount;
	}

	getAMDepth() {
		return amplitudeToDecibels(this.amDepth);
	}

	useAMPreset(presetNum, time = 0) {
		this.setAMDepth(AM_PRESETS[presetNum], time);
	}

	getAMPresetNumber() {
		return AM_PRESETS.indexOf(this.amDepth);
	}

	enableAM(operatorNum, enabled, time = 0, method = 'setValueAtTime') {
		if (enabled) {
			this.operators[operatorNum - 1].setAMDepth(this.amDepth, time, method);
			this.amEnabled[operatorNum - 1] = true;
		} else {
			this.operators[operatorNum - 1].setAMDepth(0, time, method);
			this.amEnabled[operatorNum - 1] = false;
		}
	}

	isAMEnabled(operatorNum) {
		return this.amEnabled[operatorNum];
	}

	setLFPMAmount(amount, time = 0, method = 'setValueAtTime') {
		this.lfoAmp[method](amount, time);
	}

	getLFPMAmount() {
		return this.lfoAmp.value;
	}

	useLFPMPreset(presetNum, time = 0) {
		this.setLFPMAmount(LF_PM_PRESETS[presetNum], time);
	}

	getLFPMPresetNumber() {
		return LF_PM_PRESETS.indexOf(this.getLFPMAmount());
	}

	keyOnOff(op1, time, velocity = 127, op2 = op1, op3 = op1, op4 = op1) {
		const amount = velocity / 127;
		const operators = this.operators;
		const levels = this.outputLevels;
		if (op1) {
			operators[0].keyOn(levels[0] === 0 ? 1 : amount, time);
		} else {
			operators[0].keyOff(time);
		}
		if (op2) {
			operators[1].keyOn(levels[1] === 0 ? 1 : amount, time);
		} else {
			operators[1].keyOff(time);
		}
		if (op3) {
			operators[2].keyOn(levels[2] === 0 ? 1 : amount, time);
		} else {
			operators[2].keyOff(time);
		}
		if (op4) {
			operators[3].keyOn(levels[3] === 0 ? 1 : amount, time);
		} else {
			operators[3].keyOff(time);
		}
	}

	keyOn(time, velocity = 127) {
		this.keyOnOff(true, time, velocity);
	}

	keyOff(time) {
		this.keyOnOff(false, time);
	}

	soundOff(time = 0) {
		for (let operator of this.operators) {
			operator.soundOff(time);
		}
	}

	/**
	 * @param {number} panning -1 = left channel only, 0 = centre, 1 = right channel only
	 */
	setPan(panning, time = 0, method = 'setValueAtTime') {
		this.panControl[method](panning, time);
	}

	getPan() {
		return this.panControl.value;
	}

	mute(muted, time = 0, method = 'setValueAtTime') {
		if (muted) {
			for (let i = 0; i < 4; i++) {
				this.operators[i].setVolume(0, time, method);
			}
		} else {
			for (let i = 0; i < 4; i++) {
				this.operators[i].setVolume(this.outputLevels[i], time, method);
			}
		}
	}

	isMuted() {
		for (let i = 0; i < 4; i++) {
			const expectedLevel = this.outputLevels[i];
			if (expectedLevel === 0) {
				continue;
			}
			if (this.operators[i].getVolume() === 0) {
				return true;
			}

		}
		return false;
	}

}

const LFO_FREQUENCIES = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2, 0, 0, 0, 0, 0, 0, 0, 0];

const CLOCK_RATE = {
	PAL: 	7600489,
	NTSC: 	7670454
}

class PMSynth {
	constructor(context, output = context.destination, numChannels = 6, clockRate = CLOCK_RATE.PAL) {
		const minusOne = new ConstantSourceNode(context, {offset: -1});
		minusOne.start();

		const lfo = new OscillatorNode(context, {frequency: 0});
		this.lfo = lfo;

		const channelGain = new GainNode(context, {gain : 1 / numChannels});
		channelGain.connect(output);
		supportsCancelAndHold = channelGain.gain.cancelAndHoldAtTime !== undefined;

		const envelopeTick = 351 / clockRate;
		const frequencyStep = clockRate / (288 * 2 ** 20);
		this.frequencyStep = frequencyStep;
		this.lfoRateMultiplier = clockRate / 8000000;

		const channels = [];
		for (let i = 0; i < numChannels; i++) {
			const channel = new PMChannel(this, context, lfo, minusOne, channelGain, envelopeTick);
			channels[i] = channel;
		}
		this.channels = channels;

		/**Provides frequency information for each MIDI note in terms of the YM2612's block and
		 * frequency number notation. The block number is stored in the first element of each
		 * entry and the frequency number is stored in the nested array's second element. When the
		 * block number is zero then increasing the frequency number by one raises the note's
		 * frequency by 0.025157Hz. Increasing the block number by one multiplies the frequency in
		 * Hertz by two. You can edit this table if you want to tune to something other than A440
		 * pitch (see {@link tunedMIDINotes}). The only constraint is that the table is sorted
		 * first by block number and then by frequency number.
		 * @type {Array<Array<number>>}
		 */
		this.noteFrequencies = this.tunedMIDINotes(440);

		this.ch3FreqBlocks = [4, 4, 4, 4];
		this.ch3FreqNums = [1093, 1093, 1093, 1093];
		this.ch3Mode = 0;	// Normal mode
	}

	start(time) {
		this.lfo.start(time);
		for (let channel of this.channels) {
			channel.start(time);
		}
	}

	stop(time = 0) {
		this.lfo.stop(time);
		for (let channel of this.channels) {
			channel.stop(time);
		}
	}

	soundOff(time = 0) {
		for (let channel of this.channels) {
			channel.soundOff(time);
		}
	}

	getChannel(channelNum) {
		return this.channels[channelNum - 1];
	}

	setLFOFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo.frequency[method](frequency, time);
	}

	getLFOFrequency() {
		return this.lfo.frequency.value;
	}

	setLFOFrequencyNumber(n, time = 0) {
		this.setLFOFrequency(LFO_FREQUENCIES[n] / this.lfoRateMultiplier, time);
	}

	getLFOFrequencyNumber() {
		let frequency = this.getLFOFrequency() * this.lfoRateMultiplier;
		frequency = Math.round(frequency * 100) / 100;
		return LFO_FREQUENCIES.indexOf(frequency);
	}

	setChannel3Mode(mode, time = 0) {
		const channel = this.channels[2];
		switch (mode) {
		case 0:
			// Normal mode
			const block = channel.getFrequencyBlock();
			const freqNum = channel.getFrequencyNumber();
			channel.setFrequency(block, freqNum, time);
			break;

		case 1:
			// Separate frequencies mode
			for (let i = 1; i <= 3; i++) {
				const operator = channel.getOperator(i);
				const block = this.ch3FreqBlocks[i - 1];
				const freqNum = this.ch3FreqNums[i - 1];
				operator.setFrequency(block, freqNum, 1, time);
			}
			break;
		}
		this.ch3Mode = mode;
	}

	getChannel3Mode() {
		return this.ch3Mode;
	}

	setChannel3Frequency(operatorNum, blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		const channel = this.channels[2];
		if (this.ch3Mode === 1) {
			const operator = channel.getOperator(operatorNum);
			operator.setFrequency(blockNumber, frequencyNumber, 1, time);
		} else if (operatorNum === 4) {
			channel.setFrequency(blockNumber, frequencyNumber, time, method);
		}
		this.ch3FreqBlocks[operatorNum - 1] = blockNumber;
		this.ch3FreqNums[operatorNum - 1] = frequencyNumber;
	}

	getChannel3FrequencyBlock(operatorNum) {
		return this.ch3FreqBlocks[operatorNum - 1];
	}

	getChannel3FrequencyNumber(operatorNum) {
		return this.ch3FreqNums[operatorNum - 1];
	}

	setChannel3MIDINote(operatorNum, noteNumber, time = 0, method = 'setValueAtTime') {
		const [block, frequencyNumber] = this.noteFrequencies[noteNumber];
		this.setChannel3Frequency(operatorNum, block, frequencyNumber, time, method);
	}

	/**Calculates frequency data for a scale of 128 MIDI notes. The results are expressed in
	 * terms of the YM2612's block and frequency number notation.
	 * @param {number} a4Pitch The pitch to tune A4 to, in Hertz.
	 */
	tunedMIDINotes(a4Pitch) {
		const frequencyData = [];
		for (let i = 0; i < 128; i++) {
			const frequency = a4Pitch * (2 ** ((i - 69) / 12));
			let freqNum = frequency / this.frequencyStep;
			let block = 0;
			while (freqNum >= 2047.5) {
				freqNum /= 2;
				block++;
			}
			frequencyData[i] = [block, Math.round(freqNum)];
		}
		return frequencyData;
	}

	frequencyToNote(block, frequencyNum) {
			let lb = 0;
			let ub = 127;
			while (lb < ub) {
				let mid = Math.trunc((lb + ub) / 2);
				const [noteBlock, noteFreqNum] = this.noteFrequencies[mid];
				if (block < noteBlock) {
					ub = mid - 1;
				} else if (block > noteBlock) {
					lb = mid + 1;
				} else if (frequencyNum < noteFreqNum) {
					ub = mid - 1;
				} else if (frequencyNum > noteFreqNum) {
					lb = mid + 1;
				} else {
					return mid;
				}
			}
			return lb;
	}

}

export {
	PMOperator, PMChannel, PMSynth,
	decibelsToAmplitude, amplitudeToDecibels,
	DETUNE_AMOUNTS, CLOCK_RATE
};
