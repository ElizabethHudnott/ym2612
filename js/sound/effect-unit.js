import {nextQuantum, logToLinear, panningMap} from './common.js';

const DelayType = Object.freeze({
	DOUBLING: 0,
	SLAPBACK: 1,
	LONG: 2,
	FLANGE: 3,
	CHORUS: 4,
	MANUAL: 5,
});

const StereoModulation = Object.freeze({
	LEFT_ONLY: Object.freeze([1, 0]),
	RIGHT_ONLY: Object.freeze([0, 1]),
	SAME: Object.freeze([1, 1]),
	OPPOSITE: Object.freeze([1, -1]),
});

const TIME_UNIT = 0.000040165;

// [DOUBLING, SLAPBACK, LONG, FLANGE, CHORUS, MANUAL]
// Original values modelled on Korg DS-8: [3, 7, 60, 1, 3, 83]
const TIME_MULTIPLES = [3, 6, 59, 1, 3, 83];

class EffectUnit {

	constructor(context) {
		// Cycles must include a delay of at least one sample frame block
		const minDelayUnits = (128 / context.sampleRate) / TIME_UNIT;

		// [DOUBLING, SLAPBACK, LONG, FLANGE, CHORUS, MANUAL]
		// Original values modelled on Korg DS-8: [249, 498, 2614, 1, 124, 1]
		const timeOffsets = [498, 1476, 3012, minDelayUnits, 124, 84];
		this.timeOffsets = timeOffsets;
		const maxDelayAmounts = [
			255, 255, 255,
			Math.ceil(0.0055 / TIME_UNIT - minDelayUnits),	// Flanger
			255, 254
		];
		this.maxDelayAmounts = maxDelayAmounts;

		// 6db/octave, cutoff 300Hz
		const highpass = new IIRFilterNode(context, {feedforward: [0.955], feedback: [1, 0.0447]});
		this.highpass = highpass;
		const splitter = new ChannelSplitterNode(context, {numberOfOutputs: 2});
		highpass.connect(splitter);

		const maxDelayTime = TIME_UNIT * (
			timeOffsets[DelayType.MANUAL] +
			maxDelayAmounts[DelayType.MANUAL] * TIME_MULTIPLES[DelayType.MANUAL] +
			31 * 8 * TIME_MULTIPLES[DelayType.CHORUS]
		);
		const leftDelay = new DelayNode(context, {maxDelayTime: maxDelayTime});
		this.leftDelay = leftDelay.delayTime;
		splitter.connect(leftDelay, 0);
		const leftFeedback = new GainNode(context, {gain: 0});
		this.leftFeedback = leftFeedback.gain;
		leftDelay.connect(leftFeedback);
		leftFeedback.connect(leftDelay);

		const rightDelay = new DelayNode(context, {maxDelayTime: maxDelayTime});
		this.rightDelay = rightDelay.delayTime;
		splitter.connect(rightDelay, 1);
		const rightFeedback = new GainNode(context, {gain: 0});
		this.rightFeedback = rightFeedback.gain;
		rightDelay.connect(rightFeedback);
		rightFeedback.connect(rightDelay);

		const ltrCrossfeed = new GainNode(context, {gain: 0});
		this.ltrCrossfeed = ltrCrossfeed.gain;
		leftDelay.connect(ltrCrossfeed);
		ltrCrossfeed.connect(rightDelay);
		const rtlCrossfeed = new GainNode(context, {gain: 0});
		this.rtlCrossfeed = rtlCrossfeed.gain;
		rightDelay.connect(rtlCrossfeed);
		rtlCrossfeed.connect(leftDelay);

		const leftModGain = new GainNode(context, {gain: 0});
		this.leftModGain = leftModGain;
		leftModGain.connect(leftDelay.delayTime);
		const rightModGain = new GainNode(context, {gain: 0});
		this.rightModGain = rightModGain;
		rightModGain.connect(rightDelay.delayTime);

		const leftDelayPan = new StereoPannerNode(context, {pan: 1}); // Send left input to right output
		const rightDelayPan = new StereoPannerNode(context, {pan: -1}); // Send right input to left output
		this.leftDelayPan = leftDelayPan.pan;
		this.rightDelayPan = rightDelayPan.pan;
		leftDelay.connect(leftDelayPan);
		rightDelay.connect(rightDelayPan);
		const delayGainOut = new GainNode(context);
		this.delayGainOut = delayGainOut;
		leftDelayPan.connect(delayGainOut);
		rightDelayPan.connect(delayGainOut);

		this.delayType = DelayType.DOUBLING;
		/* Suggested maximum delay amounts:
		 * SHORT: 294
		 * FLANGE: 136
		 * Everything else: 255
		 */
		this.delayAmount = 128;				// Between 0 and approximately 255
		this.delayOffset = 0;				// Between -1 and 1
		this.modulationRate = 2;			// In Hertz
		this.modulationDepth = 15;			// Between 0 and 31
		this.stereoModulation = StereoModulation.OPPOSITE;	// Publicly assignable. Then call setDelay()
		this.feedback = 0;					// Between 0 and 1023
		this.feedbackPan = 0;				// Between -1 (only applied to left) and 1 (only applied to right)
		this.feedbackPolarity = [1, 1];	// Publicly assignable. Then call setFeedback()
		this.crossfeedMix = 0;				// Between 0 and 1
		this.crossfeedPolarity = [1, 1];	// Publicly assignable. Then call setFeedback()
		this.delayWidth = -1;				// Between -1 and 1
		this.delayPan = 0;					// Between -1 and 1
		this.delayReturn = 1023;			// Between 0 and 1023
		this.lfo = undefined;
		this.setDelayAmount(context);
	}

	connectDelayInput(input) {
		input.connect(this.highpass);
	}

	connectOut(destination) {
		this.delayGainOut.connect(destination);
	}

	/**
	 * @param {string} method exponentialRampToValueAtTime is not supported for all possible
	 * parameter values and pre-existing internal states.
	 */
	setDelay(
		context, amount = this.delayAmount, type = this.delayType, offset = this.delayOffset,
		modulationDepth = this.modulationDepth, time = nextQuantum(context),
		method = 'setValueAtTime'
	) {
		// Calculate left and right delay times.
		const delayUnits = this.timeOffsets[type] + amount * TIME_MULTIPLES[type];
		let leftUnits, rightUnits;
		if (offset > 0) {
			leftUnits = Math.trunc(delayUnits * (1 - 0.5 * offset));
			rightUnits = delayUnits;
		} else {
			leftUnits = delayUnits;
			rightUnits = Math.trunc(delayUnits * (1 + 0.5 * offset));
		}
		const minDelayUnits = Math.min(leftUnits, rightUnits);
		this.effectiveDelayOffset = Math.min(2 * (1 - minDelayUnits / delayUnits), 1);

		// Calculate modulation depth and increase delay times accordingly.
		let modulationStepSize;	// Internally accounts for modulation being bipolar.
		switch (type) {
		case DelayType.FLANGE:
			modulationStepSize = 2 * TIME_MULTIPLES[DelayType.FLANGE];
			break;
		case DelayType.CHORUS:
		case DelayType.MANUAL:
			modulationStepSize = 4 * TIME_MULTIPLES[DelayType.CHORUS];
			break;
		default:
			modulationStepSize = 0;
		}
		const modulationUnits = modulationDepth * modulationStepSize;
		const stereoModulation = this.stereoModulation;
		leftUnits += Math.abs(stereoModulation[0]) * modulationUnits;
		rightUnits += Math.abs(stereoModulation[1]) * modulationUnits;

		// Doubling delay can't have feedback.
		if (type === DelayType.DOUBLING) {
			this.leftFeedback[method](0, time);
			this.rightFeedback[method](0, time);
			this.ltrCrossfeed[method](0, time);
			this.rtlCrossfeed[method](0, time);
		} else if (this.delayType === DelayType.DOUBLING) {
			this.setFeedbackAmount(this.feedback, time, method);
		}

		// Apply delay time and modulation depth changes.
		this.leftDelay[method](leftUnits * TIME_UNIT, time);
		this.rightDelay[method](rightUnits * TIME_UNIT, time);
		const modulationTime = modulationUnits * TIME_UNIT;
		this.leftModGain.gain[method](stereoModulation[0] * modulationTime, time);
		this.rightModGain.gain[method](stereoModulation[1] * modulationTime, time);
		let lfo = this.lfo;
		if (lfo === undefined) {
			if (modulationUnits > 0 && this.modulationRate !== 0) {
				lfo = new OscillatorNode(context, {frequency: this.modulationRate});
				lfo.connect(this.leftModGain);
				lfo.connect(this.rightModGain);
				lfo.start(time);
				this.lfo = lfo;
			}
		} else if (modulationUnits === 0) {
			lfo.stop(time);
			this.lfo = undefined;
		}

		// Save new values.
		this.delayType = type;
		this.delayAmount = amount;
		this.delayTime = delayUnits * TIME_UNIT;
		this.delayOffset = offset;
		this.isModulating = modulationStepSize !== 0;
		if (this.isModulating) {
			this.modulationDepth = modulationDepth;
		}
	}

	setDelayAmount(context, amount, type = this.delayType, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(context, amount, type, this.delayOffset, this.modulationDepth, time, method);
	}

	setDelayOffset(context, offset, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(context, this.delayAmount, this.delayType, offset, this.modulationDepth, time, method);
	}

	setModulationDepth(context, depth, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(context, this.delayAmount, this.delayType, this.delayOffset, depth, time, method);
	}

	getDelayType() {
		return this.delayType;
	}

	getDelayAmount() {
		return this.delayAmount;
	}

	getDelayTime() {
		return this.delayTime;
	}

	getDelayOffset() {
		return this.delayOffset;
	}

	getModulationDepth() {
		return this.modulationDepth;
	}

	setModulationRate(context, rate, time = nextQuantum(context), method = 'setValueAtTime') {
		let lfo = this.lfo;
		if (lfo === undefined) {
			if (rate !== 0 && this.isModulating && this.modulationDepth !== 0) {
				lfo = new OscillatorNode(context, {frequency: this.modulationRate});
				lfo.connect(this.leftModGain);
				lfo.connect(this.rightModGain);
				lfo.start(time);
				this.lfo = lfo;
			}
		} else {
			lfo.frequency[method](rate, time);
			if (rate === 0) {
				lfo.stop(time);
				this.lfo = undefined;
			}
		}
		this.modulationRate = rate;
	}

	getModulationRate() {
		return this.modulationRate;
	}

	setFeedback(
		amount = this.feedback, pan = this.feedbackPan, crossfeedMix = this.crossfeedMix,
		time = 0, method = 'setValueAtTime'
	) {
		let leftAmount, rightAmount;
		if (pan <= 0) {
			leftAmount = 1;
			rightAmount = 1 + pan;
		} else {
			leftAmount = 1 - pan;
			rightAmount = 1;
		}

		const linearAmount = logToLinear(amount);
		const crossfeedAmount = crossfeedMix * linearAmount;
		this.ltrCrossfeed[method](crossfeedAmount * this.crossfeedPolarity[0], time);
		this.rtlCrossfeed[method](crossfeedAmount * this.crossfeedPolarity[1], time);

		const straightAmount = linearAmount - crossfeedAmount;
		leftAmount *= straightAmount * this.feedbackPolarity[0];
		rightAmount *= straightAmount * this.feedbackPolarity[1];
		this.leftFeedback[method](leftAmount, time);
		this.rightFeedback[method](rightAmount, time);

		this.feedback = amount;
		this.feedbackPan = pan;
		this.crossfeedMix = crossfeedMix;
	}

	setFeedbackAmount(amount, time = 0, method = 'setValueAtTime') {
		this.setFeedback(amount, this.feedbackPan, this.crossfeedMix, time, method);
	}

	setFeedbackPan(pan, time = 0, method = 'setValueAtTime') {
		this.setFeedback(this.feedback, pan, this.crossfeedMix, time, method);
	}

	setCrossfeedMix(mix, time = 0, method = 'setValueAtTime') {
		this.setFeedback(this.feedback, this.feedbackPan, mix, time, method);
	}

	getFeedbackAmount() {
		return this.feedback;
	}

	getFeedbackPan() {
		return this.feedbackPan;
	}

	getCrossfeedMix() {
		return this.crossfeedMix;
	}

	setDelayPan(pan, width = this.delayWidth, time = 0, method = 'setValueAtTime') {
		const leftPan = panningMap(Math.min(Math.max(pan - width, -1), 1));
		const rightPan = panningMap(Math.min(Math.max(pan + width, -1), 1));
		this.leftDelayPan[method](leftPan, time, method);
		this.rightDelayPan[method](rightPan, time, method);
		this.delayPan = pan;
		this.delayWidth = width;
	}

	setDelayWidth(width, time = 0, method = 'setValueAtTime') {
		this.setDelayPan(this.delayPan, width, time, method);
	}

	getDelayPan() {
		return this.delayPan;
	}

	getDelayWidth() {
		return this.delayWidth;
	}

	setDelayReturn(level, time = 0, method = 'setValueAtTime') {
		this.delayGainOut.gain[method](logToLinear(level), time);
		this.delayReturn = level;
	}

	getDelayReturn() {
		return this.delayReturn;
	}

}

export {DelayType, EffectUnit};
