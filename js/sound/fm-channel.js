/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
import {
	nextQuantum, modulationIndex, outputLevelToGain, cancelAndHoldAtTime, panningMap,
	MAX_FLOAT, NEVER, VIBRATO_PRESETS
} from './common.js';
import Operator from './operator.js';

const KeySync = Object.freeze({
	OFF: 0,
	ON: 1,
	FIRST_ON: 2,
});

const Direction = Object.freeze({
	INCREASING: 1,
	DECREASING: -1,
});

const FadeParameter = Object.freeze({
	DEPTH: 0,
	RATE: 1,
});

const Pan = Object.freeze({
	FIXED: 0,
	NOTE: 1,
	VELOCITY: 2,
	LFO: 3,
});

class AbstractChannel {

	static glideRates = [0].concat([
		     254, 243, 232, 211, 202, 193, 185, 178, 171,
		165, 159, 153, 147, 141, 135, 130, 125, 120, 115,
		110, 106, 102,  98,  94,  91,  88,  85,  82,  79,
		 76,  74,  72,  70,  68,  66,  64,  62,  60,  58,
		 56,  54,  53,  51,  49,  47,  46,  44,  42,  41,
		 39,  38,  37,  36,  34,  33,  31,  30,  28,  27,
		 26,  25,  24,  23,  22,  21,  20,  19,  18,  17.5,
		 17,  16, 15.5, 15,  14, 13.5, 13, 12.5, 12,  11.5,
		 11, 10.5, 10, 9.5,   9,  8.5,  8,  7.5,  7,   6.5,
		  6,  5.5,  5, 4.5,   4,  3.5,  3,  2.5,  2,   1
	].map(x => 10 / x));

	// 0db, 1.4db, 5.9db, 11.8db
	static tremoloPresets = [0, 15, 63, 126].map(x => x / 2046);

	static filterSteps = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30].map(
		x => 1 + (x - 16) / 16
	);

	static filterStepNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F𝄲', 'F#', 'G', 'G#', 'A𝄳', 'A', 'A#', 'B'];

	static decomposeFilterSteps(cutoffValue) {
		// The filter uses a 14 note scale
		const octave = Math.floor(cutoffValue / 14);
		let note = cutoffValue % 14;
		if (note < 0) {
			note = 14 + note;
		}
		return [octave, note];
	}

	constructor(tuning) {
		this.tuningRatio = tuning.ratio;
		this.octaveThreshold = tuning.octaveThreshold;
		this.noteFreqBlockNumbers = tuning.freqBlockNumbers;
		this.noteFrequencyNumbers = tuning.frequencyNumbers;
	}

	/**Calculates frequency data for a scale of 128 MIDI notes (plus 10 extra ones for the filter).
	 * @param {number} detune The amount of detuning to apply, in 1/100ths of a half step
	 * @param {number} precision In frequency number units.
	 * @param {number} interval The default value of 2 separates consecutive copies of the root
	 * note using a 2:1 frequency ratio (1 octave). Different values can produce stretched
	 * octaves, which can help mimic instruments such as the piano. More dramatic variations can
	 * produce unusual scales, such as Wendy Carlos' alpha, beta and gamma scales.
	 * @param {number} divisions How many notes the chromatic scale should have.
	 * @param {number[]} steps A pattern of scale increments used to move from one keyboard key
	 * to the next. The pattern will be repeated up and down the keyboard from middle C.
	 *
	 * Examples:
	 * [1] A regular equal tempered scale.
	 * [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1] Equal tempered notes on the white keys only. Black
	 * keys have the same pitch as one of their adjacent white keys. Useful for creating a 7 EDO
	 * scale.
	 * [1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0] Equal tempered notes on the black keys only. White
	 * keys have the same pitch as one of their adjacent black keys. Useful for creating a 5 EDO
	 * scale.
	 *
	 * @param {number} startIndex The point to begin from within the sequence of intervals or
	 * equivalently, which note to centre the scale on.
	 */
	tuneEqualTemperament(
		detune = 0, precision = 1, interval = 2, divisions = 12, steps = [1], startIndex = 0
	) {
		const tuning = this.synth.equalTemperament(detune, precision, interval, divisions, steps, startIndex);
		this.tuningRatio = tuning.ratio;
		this.octaveThreshold = tuning.octaveThreshold;
		this.noteFreqBlockNumbers = tuning.freqBlockNumbers;
		this.noteFrequencyNumbers = tuning.frequencyNumbers;
	}

	/**
	 * @param {number} detune In cents of a 12 tone equal temperament scale.
	 * @param {number[]} ratios
	 * E.g. 5-limit: [1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 16/9, 15/8, 2]
	 * E.g. Harmonic scale: [1, 17/16, 18/16, 19/16, 20/16, 21/16, 22/16, 24/16, 26/16, 27/16, 28/16, 30/16, 2]
	 * @param {number} startNote 0 = C, 1 = C# ... 11 = B
	 * @param {number} precision In frequency number units.
	 */
	tuneRatios(detune, ratios, startNote = 0, precision = 1) {
		const tuning = this.synth.ratioTuning(detune, ratios, startNote, precision);
		this.tuningRatio = tuning.ratio;
		this.octaveThreshold = tuning.octaveThreshold;
		this.noteFreqBlockNumbers = tuning.freqBlockNumbers;
		this.noteFrequencyNumbers = tuning.frequencyNumbers;
	}

	frequencyToNote(block, frequencyNum) {
		let lb = 0;
		let ub = 127;
		while (lb < ub) {
			const mid = Math.trunc((lb + ub) / 2);
			const noteBlock = this.noteFreqBlockNumbers[mid];
			const noteFreqNum = this.noteFrequencyNumbers[mid];
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

	componentsToFullFreq(blockNumber, frequencyNumber) {
		return Math.trunc(frequencyNumber * 2 ** (blockNumber - 1));
	}

	fullFreqToComponents(fullFrequencyNumber) {
		let block = 1, freqNum = fullFrequencyNumber;
		if (freqNum < 1023.5) {
			block = 0;
			freqNum = Math.round(freqNum) * 2;
		}
		while (freqNum >= 2047.5 || (block < 7 && freqNum >= this.octaveThreshold)) {
			freqNum /= 2;
			block++;
		}
		return [block, Math.round(freqNum)];
	}

	multiplyFreqComponents(block, frequencyNumber, multiple) {
		const fullFreqNumber = this.componentsToFullFreq(block, frequencyNumber) * multiple;
		return this.fullFreqToComponents(fullFreqNumber);
	}

}

class Channel extends AbstractChannel {

	static algorithms = [
		/*	[
				[op1To2Level, op1To3Level, op1To4Level, op2To3Level, op2To4Level, op3To4Level],
				[op1OutputLevel, op2OutputLevel, op3OutputLevel, op4OutputLevel]
			]
		 */

		// 1 -> 2 -> 3 -> 4
		[[99, 0, 0, 99, 0, 99], [0, 0, 0, 99]],

		// 1 \
		//    |--> 3 -> 4
		// 2 /
		[[0, 99, 0, 99, 0, 99], [0, 0, 0, 99]],

		// 1 -----\
		//         |--> 4
		// 2 -> 3 /
		[[0, 0, 99, 99, 0, 99], [0, 0, 0, 99]],


		// 1 -> 2 \
		//        |--> 4
		// 3 -----/
		[[99, 0, 0, 0, 99, 99], [0, 0, 0, 99]],

		// 1 -> 2
		// 3 -> 4
		[[99, 0, 0, 0, 0, 99], [0, 99, 0, 99]],

		//   /--> 2
		// 1 |--> 3
		//   \--> 4
		[[99, 99, 99, 0, 0, 0], [0, 99, 99, 99]],

		// 1 -> 2
		//      3
		//      4
		[[99, 0, 0, 0, 0, 0], [0, 99, 99, 99]],

		// No modulation
		[[0, 0, 0, 0, 0, 0], [99, 99, 99, 99]],

		//           1
		// 2 -> 3 -> 4
		[[0, 0, 0, 99, 0, 99], [99, 0, 0, 99]],
	];

	constructor(synth, context, output, dbCurve, tuning, id) {
		super(tuning);
		this.synth = synth;
		this.id = id;	// IDs are powers of 2

		const shaper = new WaveShaperNode(context, {curve: [-1, 0, 1]});
		this.maxLevel = 1;
		this.add = 0;
		const adder = new ConstantSourceNode(context, {offset: 0});
		adder.connect(shaper);
		this.adder = adder;

		this.cutoffValue = 68;
		this.cutoffKeyTracking = 0;
		this.filterTrackBreakpoint = 48;
		this.resonance = 0;

		const filter = new BiquadFilterNode(
			context, {frequency: 0, Q: this.resonance}
		);
		this.filter = filter;
		shaper.connect(filter);
		const cutoffNode = new ConstantSourceNode(context);
		this.cutoffNode = cutoffNode;
		this.cutoff = cutoffNode.offset;
		const cutoffKeyTracker = new GainNode(context);
		this.cutoffKeyTracker = cutoffKeyTracker.gain;
		cutoffNode.connect(cutoffKeyTracker);
		cutoffKeyTracker.connect(filter.frequency);
		this.setFilterCutoff(this.cutoffValue);

		const gain = new GainNode(context);
		this.gainControl = gain.gain;
		this.filter.connect(gain);

		const panner = new StereoPannerNode(context);
		this.pan = 0;
		// The range is plus or minus this value, so it represents half of the total range.
		this.panRange = 1;
		this.panDirection = 1; // 1 or -1
		this.panInputCentre = 64;
		this.panInputRange = 63; // +- this value. Half the total range.
		this.panMode = Pan.FIXED;

		gain.connect(panner);
		this.panner = panner;
		const mute = new GainNode(context);
		panner.connect(mute);
		mute.connect(output);
		this.muteControl = mute.gain;

		this.lfoRateNode = new ConstantSourceNode(context, {offset: 0});
		this.lfoRate = 0;
		this.lfoShape = 'triangle';
		this.lfoKeySync = KeySync.OFF;
		this.lfo = undefined;
		const lfoEnvelope = new GainNode(context);
		this.lfoEnvelope = lfoEnvelope;
		this.lfoDelay = 0;
		this.lfoFadeTime = 0;
		this.lfoFadeDirection = Direction.INCREASING;
		this.fadeLFORate = false;	// false = fade LFO depth, true = fade LFO rate

		const autoPan = new GainNode(context, {gain: 0});
		this.autoPan = autoPan.gain;
		lfoEnvelope.connect(autoPan);
		autoPan.connect(panner.pan);

		const op1 = new Operator(this, context, lfoEnvelope, shaper, dbCurve);
		const op2 = new Operator(this, context, lfoEnvelope, shaper, dbCurve);
		const op3 = new Operator(this, context, lfoEnvelope, shaper, dbCurve);
		const op4 = new Operator(this, context, lfoEnvelope, shaper, dbCurve);
		this.operators = [op1, op2, op3, op4];

		const minDelay = 128 / context.sampleRate;
		const op1To1 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To1);
		const feedbackFilter1 = new BiquadFilterNode(context, {type: 'highpass', frequency: 0, Q: 0});
		op1.connectFrequency(feedbackFilter1.frequency);
		op1To1.connect(feedbackFilter1);
		const delay1To1 = new DelayNode(context, {delayTime: minDelay, maxDelayTime: minDelay});
		feedbackFilter1.connect(delay1To1);
		op1.connectIn(delay1To1);

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

		const op3To3 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To3);
		const feedbackFilter3 = new BiquadFilterNode(context, {type: 'highpass', frequency: 0, Q: 0});
		op3.connectFrequency(feedbackFilter3.frequency);
		op3To3.connect(feedbackFilter3);
		const delay3To3 = new DelayNode(context, {delayTime: minDelay, maxDelayTime: minDelay});
		feedbackFilter3.connect(delay3To3);
		op3.connectIn(delay3To3);

		const op3To4 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To4);
		op4.connectIn(op3To4);

		this.gains = [
			op1To1.gain, op3To3.gain,
			op1To2.gain, op1To3.gain, op1To4.gain,
			op2To3.gain, op2To4.gain,
			op3To4.gain
		];
		this.modulationDepths = new Array(this.gains.length);
		// Initialize feedback registers
		this.modulationDepths[0] = 0;
		this.modulationDepths[1] = 0;

		this.freqBlockNumbers = [3, 3, 3, 3];
		this.frequencyNumbers = [1093, 1093, 1093, 1093];
		this.frequencyMultiples = [1, 1, 1, 1];
		this.fixedFrequency = [false, false, false, false];
		this.glideRate = 0;

		this.outputLevel = 99;
		this.tremoloDepth = 0;	// linear scale
		this.vibratoDepth = 0;
		this.tremoloEnabled = [false, false, false, false];
		this.vibratoEnabled = [true, true, true, true];
		this.operatorDelay = [0, 0, 0, 0];
		this.muted = false;

		this.stopTime = 0;
		this.oldStopTime = 0;	// Value before the key-on/off currently being processed.

		this.useAlgorithm(0);
	}

	copyOperator(from, to) {
		const fromOperator = this.operators[from - 1];
		const toOperator = this.operators[to - 1];
		fromOperator.copyTo(toOperator);

		let block = this.freqBlockNumbers[from - 1];
		let freqNum = this.frequencyNumbers[from - 1];
		const multiple = this.frequencyMultiples[from - 1];
		const fixedFrequency = this.fixedFrequency[from - 1];

		if (to !== 4 || fixedFrequency) {
			this.freqBlockNumbers[to - 1] = block;
			this.frequencyNumbers[to - 1] = freqNum;
		}
		this.frequencyMultiples[to - 1] = multiple;
		this.fixedFrequency[to - 1] = fixedFrequency;

		if (fixedFrequency) {
			toOperator.setFrequency(block, freqNum, 1);
		} else {
			this.setFrequency(this.freqBlockNumbers[3], this.frequencyNumbers[3]);
		}
		this.tremoloEnabled[to - 1] = this.tremoloEnabled[from - 1];
		this.vibratoEnabled[to - 1] = this.vibratoEnabled[from - 1];
		this.operatorDelay[to - 1] = this.operatorDelay[from - 1];
	}

	copyEnvelope(from, to) {
		const fromOperator = this.operators[from - 1];
		const toOperator = this.operators[to - 1];
		fromOperator.copyEnvelopeTo(toOperator);
	}

	start(time) {
		for (let operator of this.operators) {
			operator.start(time);
		}
		this.lfoRateNode.start(time);
		this.adder.start(time);
		this.cutoffNode.start(time);
	}

	stop(time = 0) {
		for (let operator of this.operators) {
			operator.stop(time);
		}
		this.lfoRateNode.stop(time);
		this.lfoRateNode = undefined;
		if (this.lfo) {
			this.lfo.stop(time);
			this.lfo = undefined;
		}
		this.adder.stop(time);
		this.cutoffNode.stop(time);
		this.adder = undefined;
		this.cutoffNode = undefined;
		this.cutoff = undefined;
	}

	getOperator(operatorNum) {
		return this.operators[operatorNum - 1];
	}

	splitChannel(context, split, time = nextQuantum(context)) {
		if (split) {
			if (this.lfoKeySync === KeySync.ON) {
				this.setLFOKeySync(context, KeySync.OFF, time);
			}
			this.applyLFO(time);
			this.#trackFilter(this.cutoffKeyTracking < 0 ? 21 : 108, time);
		} else {
			this.setLFOKeySync(context, this.lfoKeySync, time);
		}
	}

	setAlgorithm(modulations, outputLevels, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 6; i++) {
			const depth = modulations[i] || 0;
			this.gains[i + 2][method](modulationIndex(depth) / 2, time);
			this.modulationDepths[i + 2] = depth;
		}
		for (let i = 0; i < 4; i++) {
			const operator = this.operators[i];
			const outputLevel = outputLevels[i] || 0;
			operator.enable();
			operator.setOutputLevel(outputLevel, time, method);
		}
	}

	useAlgorithm(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = Channel.algorithms[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
	}

	getAlgorithm() {
		algorithm: for (let i = 0; i < Channel.algorithms.length; i++) {
			const algorithm = Channel.algorithms[i];
			const modulations = algorithm[0];
			for (let j = 0; j < modulations.length; j++) {
				const algorithmModulates = modulations[j] !== 0;
				const thisModulates = this.modulationDepths[j + 2] !== 0;
				if (algorithmModulates !== thisModulates) {
					continue algorithm;
				}
			}
			const outputLevels = algorithm[1];
			for (let j = 0; j < 4; j++) {
				const algorithmOutputs = outputLevels[j] !== 0;
				const thisOutputs = this.operators[j].getOutputLevel() !== 0;
				if (algorithmOutputs !== thisOutputs) {
					continue algorithm;
				}
			}
			return i;
		} // end for each algorithm
		return -1;
	}

	#indexOfGain(modulatorOpNum, carrierOpNum) {
		if (modulatorOpNum === carrierOpNum) {
			switch (modulatorOpNum) {
			case 1: return 0;
			case 3: return 1;
			default: return - 1;
			}
		} else if (modulatorOpNum >= 4 || modulatorOpNum >= carrierOpNum) {
			return -1;
		}
		let index = 2;
		for (let i = modulatorOpNum - 1; i > 0; i--) {
			index += 4 - i;
		}
		index += carrierOpNum - modulatorOpNum - 1;
		return index;
	}

	/**
	 * @param {number} depth Range -99..99
	 */
	setModulationDepth(modulatorOpNum, carrierOpNum, depth, time = 0, method = 'setValueAtTime') {
		const index = this.#indexOfGain(modulatorOpNum, carrierOpNum);
		this.gains[index][method](modulationIndex(depth) / 2, time);
		this.modulationDepths[index] = depth;
	}

	getModulationDepth(modulatorOpNum, carrierOpNum) {
		const index = this.#indexOfGain(modulatorOpNum, carrierOpNum);
		return index === -1 ? 0 : this.modulationDepths[index];
	}

	normalizeLevels() {
		const currentGains = new Array(4);
		let total = 0;
		for (let i = 0; i < 4; i++) {
			const operator = this.operators[i];
			if (!operator.isDisabled()) {
				const gain = operator.getGain();
				currentGains[i] = gain;
				total += Math.abs(gain);
			}
		}
		if (total === 0) {
			return;
		}

		for (let i = 0; i < 4; i++) {
			const operator = this.operators[i];
			if (!operator.isDisabled()) {
				let gain = this.maxLevel * currentGains[i] / total;
				gain = Math.max(Math.min(gain, MAX_FLOAT), -MAX_FLOAT);
				operator.setGain(gain);
			}
		}
	}

	/**Sets up the parameters for creating a distortion effect. Use FMChannel.normalizeLevels()
	 * and/or Operator.setOutputLevel to create the actual distortion.
	 */
	setDistortion(decibels, symmetry = 0.5, time = 0, transitionTime = 0) {
		const maxLevel = 10 ** (decibels / 20);
		const add = Math.max(maxLevel - 1, 0) * 2 * (symmetry - 0.5);

		transitionTime = Math.max(Math.abs(add - this.add) * 0.01, transitionTime);
		this.adder.offset.setTargetAtTime(add, time, transitionTime / 3);
		this.maxLevel = maxLevel;
		this.add = add;
	}

	getDistortionAmount() {
		return Math.log10(this.maxLevel) * 20;
	}

	disableOperator(operatorNum, time = 0) {
		this.operators[operatorNum - 1].disable(time);
	}

	enableOperator(operatorNum) {
		this.operators[operatorNum - 1].enable();
	}

	setGlideRate(glideRate) {
		this.glideRate = AbstractChannel.glideRates[glideRate];
	}

	getGlideRate() {
		const glideRate = this.glideRate;
		if (glideRate === 0) {
			return 0;
		}
		return Math.round(10 / this.glideRate);
	}

	fixFrequency(operatorNum, fixed = true, time = 0) {
		const operator = this.operators[operatorNum - 1];

		if (fixed) {
			// Restore a fixed frequency from a register.
			const block = this.freqBlockNumbers[operatorNum - 1];
			const freqNum = this.frequencyNumbers[operatorNum - 1];
			operator.setFrequency(block, freqNum, 1, time);
		} else {
			// Restore a frequency ratio
			const block = this.freqBlockNumbers[3];
			const freqNum = this.frequencyNumbers[3];
			const multiple = this.frequencyMultiples[operatorNum - 1];
			operator.setFrequency(block, freqNum, multiple, time);
		}
		this.fixedFrequency[operatorNum - 1] = fixed;
	}

	isOperatorFixed(operatorNum) {
		return this.fixedFrequency[operatorNum - 1];
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, glide = true) {
		const glideRate = glide ? this.glideRate : 0;
		for (let i = 0; i < 4; i++) {
			if (!this.fixedFrequency[i]) {
				const operator = this.operators[i];
				const multiple = this.frequencyMultiples[i];
				operator.setFrequency(blockNumber, frequencyNumber, multiple, time, glideRate);
			}
		}
		this.freqBlockNumbers[3] = blockNumber;
		this.frequencyNumbers[3] = frequencyNumber;
	}

	setOperatorFrequency(operatorNum, blockNumber, frequencyNumber, time = 0, glide = true) {
		if (this.fixedFrequency[operatorNum - 1]) {
			const operator = this.operators[operatorNum - 1];
			const glideRate = glide ? this.glideRate : 0;
			operator.setFrequency(blockNumber, frequencyNumber, 1, time, glideRate);
		}
		this.freqBlockNumbers[operatorNum - 1] = blockNumber;
		this.frequencyNumbers[operatorNum - 1] = frequencyNumber;
	}

	getFrequencyBlock(operatorNum = 4) {
		return this.freqBlockNumbers[operatorNum - 1];
	}

	getFrequencyNumber(operatorNum = 4) {
		return this.frequencyNumbers[operatorNum - 1];
	}

	/**
	 * @param {number} multiple Fractions in 1/16 resolution are supported on OPZ via the "fine"
	 * ratio parameter. These combine with detune2 to effectively create even more ratios. OPM,
	 * OPN and OPL only support integers and the value 0.5. OPN and OPL don't support detune2
	 * either and OPL doesn't even support detune1. The DX7 supports values of the form
	 * N * (1 + M/100) where N is 0.5 or an integer between 1 and 31 and M is an integer between
	 * 0 and 99.
	 */
	setFrequencyMultiple(operatorNum, multiple, time = undefined) {
		this.frequencyMultiples[operatorNum - 1] = multiple;
		if (time !== undefined && !this.fixedFrequency[operatorNum - 1]) {
			const block = this.freqBlockNumbers[3];
			const freqNum = this.frequencyNumbers[3];
			const operator = this.operators[operatorNum - 1];
			operator.setFrequency(block, freqNum, multiple, time);
		}
	}

	getFrequencyMultiple(operatorNum) {
		return this.frequencyMultiples[operatorNum - 1];
	}

	#trackFilter(midiNote, time) {
		const cutoffTrackNotes = (midiNote - this.filterTrackBreakpoint) * this.cutoffKeyTracking;
		const cutoffTrackMultiple = this.tuningRatio ** cutoffTrackNotes;
		this.cutoffKeyTracker.setValueAtTime(cutoffTrackMultiple, time);
	}

	setMIDINote(noteNumber, time = 0, glide = true) {
		const block = this.noteFreqBlockNumbers[noteNumber];
		const freqNum = this.noteFrequencyNumbers[noteNumber];
		const glideRate = glide ? this.glideRate : 0;
		this.setFrequency(block, freqNum, time, glideRate);
		this.#trackFilter(noteNumber, time);

		if (this.panMode === Pan.NOTE) {
			this.#adjustPan(noteNumber, time);
		}
	}

	cancelGlide(time) {
		for (let i = 0; i < 4; i++) {
			this.operators[i].cancelGlide(time);
		}
	}

	/**
	 * @param {PitchBend} bend The pitch bend to apply, relative to the last note set using
	 * setMIDINote() or setFrequency().
	 * @param {boolean} release True to apply the note off portion of the bend, or false to
	 * apply the note on portion.
	 * @param {number} time The time to begin pitch bending from.
	 * @param {Array<number>} timesPerStep Any array formed using one of the following
	 * techniques.
	 * a) A list of the durations of tracker lines in seconds.
	 * b) An absolute value in seconds. Useful if you don't want the effect tempo synced, for
	 * example if you want to create a pitch envelope effect.
	 *
	 * Use multiple values to account for a groove (or a tempo change) and the system will
	 * rotate through them.
	 *
	 * @param {number} [scaling=1] Scales the bend's values before applying them. Useful for
	 * making the effect velocity sensitive. Negative values are also supported, in case you
	 * need to force the bend to head in particular direction without knowing which direction
	 * that's going to be when you create the bend.
	 * @param {number} [operatorMask] A number between 1 and 15. Each bit decides whether the
	 * corresponding operator will have its pitch bent or not.
	 * @param {number} [maxSteps] The maximum number of bend steps to perform. Useful if you
	 * want to cut the bend short to trigger a new note.
	 */
	pitchBend(
		bend, release, startTime, timesPerStep, scaling = 1, operatorMask = undefined,
		maxSteps = bend.getLength(release)
	) {
		this.cancelGlide(startTime);
		if (operatorMask === undefined) {
			operatorMask = 0;
			for (let i = 0; i < 4; i++) {
				operatorMask |= (!this.fixedFrequency[i]) << i;
			}
		}
		for (let i = 0; i < 4; i++) {
			if (operatorMask & (1 << i)) {
				const operator = this.operators[i];
				bend.execute(
					operator.frequencyParam, release, startTime, timesPerStep, scaling,
					operator.frequency, maxSteps
				);
			}
		}
	}

	setOperatorNote(operatorNum, noteNumber, multiple = 1, time = 0, glide = true) {
		this.fixedFrequency[operatorNum - 1] = true;
		let block = this.noteFreqBlockNumbers[noteNumber];
		let freqNum = this.noteFrequencyNumbers[noteNumber];
		if (multiple !== 1) {
			[block, freqNum] = this.multiplyFreqComponents(block, freqNum, multiple);
		}
		const glideRate = glide ? this.glideRate : 0;
		this.setOperatorFrequency(operatorNum, block, freqNum, time, glideRate);
	}

	getMIDINote(operatorNum = 4) {
		const block = this.freqBlockNumbers[operatorNum - 1];
		const freqNum = this.frequencyNumbers[operatorNum - 1];
		return this.frequencyToNote(block, freqNum);
	}

	setFeedback(amount, operatorNum = 1, time = 0, method = 'setValueAtTime') {
		const index = (operatorNum - 1) / 2;
		this.gains[index][method](amount, time);
		this.modulationDepths[index] = amount;
	}

	getFeedback(operatorNum = 1) {
		return this.modulationDepths[(operatorNum - 1) / 2];
	}

	useFeedbackPreset(n, operatorNum = 1, time = 0, method = 'setValueAtTime') {
		const amount = Math.sign(n) * -this.synth.feedbackCallibration * 2 ** (Math.abs(n) - 6);
		this.setFeedback(amount, operatorNum, time, method);
	}

	getFeedbackPreset(operatorNum = 1) {
		const amount = this.getFeedback(operatorNum);
		if (amount === 0) {
			return 0;
		}
		let logAmount;
		logAmount = Math.log2(amount / -this.synth.feedbackCallibration) + 6;
		// Convert to a precision comparable to the output level.
		logAmount = Math.round(logAmount * 28) / 28;
		return logAmount;
	}

	/**
	 * @param {number} depth The amount of tremolo effect to apply in the range of -511.5 to
	 * +511.5 (though 510 is equivalent to the largest amount permitted by Yamaha). Values
	 * between 512 and 1023 will introduce ring modulation. The tremolo is modelled on
	 * OPM's combinations of 128 modulation depths and 3 amplitude modulation sensitivities.
	 */
	setTremoloDepth(depth, time = 0, method = 'setValueAtTime') {
		const scaledDepth = depth / 1023;
		for (let i = 0; i < 4; i++) {
			if (this.tremoloEnabled[i]) {
				this.operators[i].setTremoloDepth(scaledDepth, time, method);
			}
		}
		this.tremoloDepth = scaledDepth;
	}

	getTremoloDepth() {
		return Math.round(this.tremoloDepth * 1023);
	}

	useTremoloPreset(presetNum, time = 0, method = 'setValueAtTime') {
		const scaledDepth = AbstractChannel.tremoloPresets[presetNum];
		for (let i = 0; i < 4; i++) {
			if (this.tremoloEnabled[i]) {
				this.operators[i].setTremoloDepth(scaledDepth, time, method);
			}
		}
		this.tremoloDepth = scaledDepth;
	}

	getTremoloPreset() {
		const depth = Math.round(this.tremoloDepth * 1023);
		return AbstractChannel.tremoloPresets.indexOf(depth);
	}

	enableTremolo(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const operator = this.operators[operatorNum - 1];
		operator.setTremoloDepth(enabled ? this.tremoloDepth : 0, time, method);
		this.tremoloEnabled[operatorNum - 1] = enabled;
	}

	isTremoloEnabled(operatorNum) {
		return this.tremoloEnabled[operatorNum - 1];
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const linearAmount = Math.sign(cents) * (2 ** (Math.abs(cents) / 1200) - 1);
		for (let i = 0; i < 4; i++) {
			if (this.vibratoEnabled[i]) {
				this.operators[i].setVibratoDepth(linearAmount, time, method);
			}
		}
		this.vibratoDepth = linearAmount;
	}

	getVibratoDepth() {
		return Math.round(Math.log2(this.vibratoDepth + 1) * 12000) / 10;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		return VIBRATO_PRESETS.indexOf(this.getVibratoDepth());
	}

	enableVibrato(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const operator = this.operators[operatorNum - 1];
		operator.setVibratoDepth(enabled ? this.vibratoDepth : 0, time, method);
		this.vibratoEnabled[operatorNum - 1] = enabled;
	}

	isVibratoEnabled(operatorNum) {
		return this.vibratoEnabled[operatorNum - 1];
	}

	setLFODelay(seconds) {
		this.lfoDelay = seconds;
	}

	getLFODelay() {
		return this.lfoDelay;
	}

	setFadeTime(seconds) {
		this.lfoFadeTime = seconds;
	}

	getFadeTime() {
		return this.lfoFadeTime;
	}

	setFadeDirection(direction) {
		this.lfoFadeDirection = direction;
	}

	getFadeDirection() {
		return this.lfoFadeDirection;
	}

	setFadeParameter(mode, time = 0) {
		if (this.fadeLFORate && mode === FadeParameter.DEPTH) {
			// Switch from slowing down the rate to reducing the depth
			this.lfoRateNode.offset.setValueAtTime(this.lfoRate, time);
		} else if (!this.fadeLFORate && mode === FadeParameter.RATE) {
			// Switch from reducing the depth to slowing down the rate
			this.lfoEnvelope.gain.setValueAtTime(1, time);
		}
		this.fadeLFORate = Boolean(mode);
	}

	getFadeParameter() {
		return Number(this.fadeLFORate);
	}

	setLFORate(context, frequency, time = nextQuantum(time), method = 'setValueAtTime') {
		this.lfoRateNode.offset[method](frequency, time);
		if (this.lfo) {
			if (frequency === 0) {
				this.lfo.stop(time);
				this.lfo = undefined;
			}
		} else if (frequency !== 0) {
			// Start LFO running in the background.
			const lfo = new OscillatorNode(context, {frequency: 0, type: this.lfoShape});
			this.lfoRateNode.connect(lfo.frequency);
			lfo.start(time);
			lfo.connect(this.lfoEnvelope);
			this.lfo = lfo;
		}
		this.lfoRate = frequency;
	}

	resetLFO(context, time = nextQuantum(context)) {
		if (this.lfo) {
			this.lfo.stop(time);
		}
		const lfo = new OscillatorNode(context, {frequency: 0, type: this.lfoShape});
		this.lfoRateNode.connect(lfo.frequency);
		lfo.start(time);
		lfo.connect(this.lfoEnvelope);
		this.lfo = lfo;
	}

	setLFOShape(context, shape, time = undefined) {
		if (shape === this.lfoShape) {
			return;
		}
		if (this.lfo && (time !== undefined || this.lfoKeySync == KeySync.OFF)) {
			// Change LFO shape immediately.
			// Frequency will never be 0 when this.lfo is defined.
			const lfo = new OscillatorNode(context, {frequency: 0, type: shape});
			this.lfoRateNode.connect(lfo.frequency);
			lfo.start(time);
			lfo.connect(this.lfoEnvelope);
			this.lfo.stop(time);
			this.lfo = lfo;
		}
		this.lfoShape = shape;
	}

	setLFOKeySync(context, mode) {
		if (mode !== KeySync.ON && this.lfo) {
			this.lfo.stop(context.currentTime + NEVER);
		}
		this.synth.setKeySyncFirstOn(this.id, mode === KeySync.FIRST_ON);
		this.lfoKeySync = mode;
	}

	getLFORate() {
		return this.lfoRate;
	}

	getLFOShape() {
		return this.lfoShape;
	}

	getLFOKeySync() {
		return this.lfoKeySync;
	}

	useLFOPreset(context, presetNum, time = nextQuantum(context), method = 'setValueAtTime') {
		const rate = this.synth.lfoPresetToFrequency(presetNum);
		this.setLFORate(context, rate, time, method);
	}

	getLFOPreset() {
		return this.synth.frequencyToLFOPreset(this.lfoRate);
	}

	/**Gets the *effective* LFO delay time.
	 */
	getEffectiveLFODelay() {
		const rate = this.lfoRate;
		if (
			!this.fadeLFORate || this.lfoFadeDirection === Direction.INCREASING ||
			this.lfoKeySync === KeySync.OFF || rate === 0
		) {
			return this.lfoDelay;
		}

		// If we're slowing the LFO to a stop then make sure we're ending on a zero crossing
		// point so that the pitch isn't left permanently "off".
		const delay = this.lfoDelay;
		const fadeTime = this.lfoFadeTime;
		let phase = rate * (delay + 0.5 * fadeTime);
		phase = Math.round(phase * 2) / 2;
		let newDelay = phase / rate - 0.5 * fadeTime;
		if (newDelay < 0) {
			newDelay = (phase + 0.5) / rate - 0.5 * fadeTime;
		}
		return newDelay;
	}

	#triggerLFO(context, time) {
		const rate = this.lfoRate;
		if (rate === 0) {
			return;
		}

		let initialAmount = this.lfoFadeDirection === Direction.INCREASING ? 0 : 1;
		let finalAmount = 1 - initialAmount;
		const endDelay = time + this.getEffectiveLFODelay();
		let param;
		if (this.fadeLFORate) {
			param = this.lfoRateNode.offset;
			initialAmount *= rate;
			finalAmount *= rate;
		} else {
			param = this.lfoEnvelope.gain;
		}
		cancelAndHoldAtTime(param, initialAmount, time);

		if (this.lfoKeySync === KeySync.ON) {
			// Reset LFO phase
			const lfo = new OscillatorNode(context, {frequency: 0, type: this.lfoShape});
			this.lfoRateNode.connect(lfo.frequency);
			lfo.start(initialAmount === 0 ? endDelay : time);
			lfo.connect(this.lfoEnvelope);
			if (this.lfo) {
				this.lfo.stop(time);
			}
			this.lfo = lfo;
		}

		param.setValueAtTime(initialAmount, endDelay)
		param.linearRampToValueAtTime(finalAmount, endDelay + this.lfoFadeTime);
	}

	applyLFO(time) {
		cancelAndHoldAtTime(this.lfoRateNode.offset, this.lfoRate, time);
		cancelAndHoldAtTime(this.lfoEnvelope.gain, 1, time);
	}

	scheduleSoundOff(operator, time) {
		if (operator.getOutputLevel() !== 0) {
			this.stopTime = Math.max(this.stopTime, time);
		}
	}

	scheduleOscillators() {
		let lastOpOff = 1;
		for (let i = 4; i >= 1; i--) {
			const operator = this.operators[i - 1];
			if (operator.keyIsOn) {
				// Any lower numbered operator may be modulating this one and the algorithm can
				// change while the gate is open.
				lastOpOff = i + 1;
				break;
			}
		}
		const stopTime = this.stopTime;
		for (let i = 4; i >= lastOpOff; i--) {
			this.operators[i - 1].stopOscillator(stopTime);
		}
		if (lastOpOff === 1 && this.lfo && this.lfoKeySync === KeySync.ON) {
			this.lfo.stop(stopTime);
		}
		this.oldStopTime = stopTime;
	}

	newOscillators(context, time) {
		for (let i = 0; i < 4; i++) {
			const operator = this.operators[i];
			if (!operator.disabled) {
				operator.newOscillator(context, time);
			}
		}
	}

	/**
	 * N.B. Doesn't fade in the LFO if a delay has been set. Use {@link Channel.keyOn} for that.
	 */
	keyOnOff(
		context, velocity = 127, time = nextQuantum(context),
		op1 = velocity !== 0, op2 = op1, op3 = op1, op4 = op1
	) {
		const operators = this.operators;
		if (op1) {
			operators[0].keyOn(context, velocity, time + this.operatorDelay[0]);
		} else {
			operators[0].keyOff(time);
		}
		if (op2) {
			operators[1].keyOn(context, velocity, time + this.operatorDelay[1]);
		} else {
			operators[1].keyOff(time);
		}
		if (op3) {
			operators[2].keyOn(context, velocity, time + this.operatorDelay[2]);
		} else {
			operators[2].keyOff(time);
		}
		if (op4) {
			operators[3].keyOn(context, velocity, time + this.operatorDelay[3]);
		} else {
			operators[3].keyOff(time);
		}
		this.scheduleOscillators();
	}

	keyOn(context, velocity = 127, time = nextQuantum(context)) {
		this.synth.keyOn(context, this.id, time);
		this.#triggerLFO(context, time);
		this.keyOnOff(context, velocity, time);
		if (this.panMode === Pan.VELOCITY) {
			this.#adjustPan(velocity, time);
		}
	}

	keyOff(context, time = context.currentTime) {
		this.keyOnOff(context, 0, time);
		this.synth.keyOff(this.id);
	}

	setOperatorDelay(operatorNum, delay) {
		this.operatorDelay[operatorNum - 1] = delay / 1000;
	}

	getOperatorDelay(operatorNum) {
		return this.operatorDelay[operatorNum - 1] * 1000;
	}

	soundOff(time = 0) {
		for (let operator of this.operators) {
			operator.soundOff(time);
		}
		if (this.lfo && this.lfoKeySync === KeySync.ON) {
			this.lfo.stop(time);
		}
	}

	setFilterCutoff(value, time = 0, method = 'setValueAtTime') {
		const c3Block = this.noteFreqBlockNumbers[48];
		const c3FreqNum = this.noteFrequencyNumbers[48];
		const [octave, note] = AbstractChannel.decomposeFilterSteps(value);
		const ratio = 2 ** octave * AbstractChannel.filterSteps[note];
		const fullFreqNum = Math.round(ratio * this.componentsToFullFreq(c3Block, c3FreqNum));
		const frequency = fullFreqNum * this.synth.frequencyStep;
		this.cutoff[method](frequency, time);
		this.cutoffValue = value;
	}

	getFilterCutoff() {
		return this.cutoffValue;
	}

	setFilterKeyTracking(tracking = 100) {
		this.cutoffKeyTracking = tracking / 100;
	}

	getFilterKeyTracking() {
		return this.cutoffKeyTracking * 100;
	}

	setFilterBreakpoint(midiNote) {
		this.filterTrackBreakpoint = midiNote;
	}

	getFilterTrackBreakpoint() {
		return this.filterTrackBreakpoint;
	}

	setFilterResonance(decibels, time = 0, method = 'setValueAtTime') {
		this.filter.Q[method](decibels, time);
		this.resonance = decibels;
	}

	getFilterResonance() {
		return this.resonance;
	}

	/**
	 * @param {number} panning -1 = left channel only, 0 = centre, 1 = right channel only
	 */
	setPan(panning, time = 0) {
		this.panner.pan.setValueAtTime(panningMap(panning), time);
		this.pan = panning;
		this.panMode = Pan.FIXED;
	}

	rampPan(panning, time) {
		this.panner.pan.linearRampToValueAtTime(panningMap(panning), time);
		this.pan = panning;
	}

	getPan() {
		return this.pan;
	}

	setPanModulationSource(mode, time = 0) {
		if (mode === Pan.LFO) {
			this.panner.pan.setValueAtTime(0, time);
			this.autoPan.setValueAtTime(-panningMap(this.panRange), time);
			this.pan = 0;
		} else {
			this.autoPan.setValueAtTime(0, time);
		}
		this.panMode = mode;
	}

	getPanModulationSource() {
		return this.panMode;
	}

	setStereoWidth(width, time = 0, method = 'setValueAtTime') {
		const range = this.panDirection * width / 2;
		if (this.panMode === Pan.LFO) {
			this.autoPan[method](-panningMap(range), time);
		}
		this.panRange = range;
	}

	getStereoWidth() {
		return Math.abs(this.panRange) * 2;
	}

	/**
	 * @param {number} direction 1 = left to right, -1 = right to left
	 */
	setPanModulationDirection(direction, time = 0) {
		const range = direction * Math.abs(this.panRange);
		if (this.panMode === Pan.LFO) {
			this.autoPan.setValueAtTime(-panningMap(range), time);
		}
		this.panRange = range;
		this.panDirection = direction;
	}

	getPanModulationDirection() {
		return this.panDirection;
	}

	setPanControllerCentre(value) {
		this.panInputCentre = value;
	}

	getPanControllerCentre() {
		return this.panInputCentre;
	}

	/**
	 * @param {number} range Between 0 and 2
	 */
	setPanControllerRange(range) {
		this.panInputRange = range / 2;
	}

	getPanControllerRange() {
		return this.panInputRange * 2;
	}

	#adjustPan(input, time) {
		let relativePosition = (input - this.panInputCentre) / this.panInputRange;
		if (relativePosition < -1) {
			relativePosition = -1;
		} else if (relativePosition > 1) {
			relativePosition = 1;
		}
		const pan = relativePosition * this.panRange;
		this.panner.pan.setValueAtTime(panningMap(pan), time);
		this.pan = pan;
	}

	/**
	 * @param {number} volume Range -99..99
	 */
	setVolume(volume, time = 0, method = 'setValueAtTime') {
		this.gainControl[method](outputLevelToGain(volume), time);
		this.outputLevel = volume;
	}

	setGain(gain, time = 0, method = 'setValueAtTime') {
		this.gainControl[method](gain, time);
	}

	mute(muted, time = 0) {
		this.muteControl.setValueAtTime(muted ? 0 : 1, time);
		this.muted = muted;
	}

	isMuted() {
		return this.muted;
	}

	volumeAutomation(
		automation, release, startTime, timesPerStep, maxSteps = automation.getLength(release)
	) {
		automation.execute(
			this.gainControl, release, startTime, timesPerStep, 1, undefined, maxSteps
		);
	}

	get numberOfOperators() {
		return 4;
	}

}

export {KeySync, Direction, FadeParameter, Pan, AbstractChannel, Channel};
