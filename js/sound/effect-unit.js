import {nextQuantum, logToLinear} from './common.js';

const DelayType = Object.freeze({
	DOUBLING: 0,
	SHORT: 1,
	LONG: 2,
	CHORUS: 3,
	FLANGE: 4,
	MANUAL: 5,
});

const TIME_UNIT = 0.040165;

const TIME_MULTIPLES = [  3,   7,   60, 1, 3,   83];
const TIME_OFFSETS =   [249, 498, 2614, 1, 124, 1];
const MAX_MODULATION = TIME_OFFSETS[DelayType.CHORUS] + 224 * TIME_MULTIPLES[DelayType.CHORUS];

class EffectUnit {

	constructor(context) {
		const splitter = new ChannelSplitterNode(context, {numberOfOutputs: 2});
		this.splitter = splitter;

		const maxDelayTime = TIME_UNIT * (
			TIME_OFFSETS[DelayType.MANUAL] + 255 * TIME_MULTIPLES[DelayType.MANUAL]
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

		const modGain = new GainNode(context, {gain: 0});
		this.modDepthParam = modGain.gain;

		const leftDelayPan = new StereoPannerNode(context, {pan: 1}); // Send left input to right output
		const rightDelayPan = new StereoPannerNode(context, {pan: -1}); // Send right input to left output
		this.leftDelayPan = leftDelayPan;
		this.rightDelayPan = rightDelayPan;
		this.leftDelay.connect(leftDelayPan);
		this.rightDelay.connect(rightDelayPan);

		this.delayType = DelayType.DOUBLING;
		this.delayAmount = 128;		// Between 0 and approximately 255
		this.delayOffset = 0;		// Between -1 and 1
		this.modulationRate = 1.5;	// In Hertz
		this.modulationDepth = 0;	// Between 0 and 1
		this.feedback = 0;			// Between 0 and 1
		this.feedbackPolarity = [1, 1];
		this.feedbackPan = 0;		// Between -1 and 1
		this.delayWidth = -1			// Between -1 and 1;
		this.delayPan = 0;			// Between -1 and 1;
		this.lfo = undefined;
		this.setDelayAmount(this.delayAmount);
	}

	connectIn(input) {
		input.connect(this.splitter);
	}

	connectOut(destination) {
		this.leftDelayPan.connect(destination);
		this.rightDelayPan.connect(destination);
	}

	setDelay(
		context, amount, type = this.delayType, offset = this.delayDelay,
		modulationDepth = this.modulationDepth, time = nextQuantum(context),
		method = 'setValueAtTime'
	) {
		const delayUnits = TIME_OFFSETS[type] + amount * TIME_MULTIPLES[type];
		let leftUnits, rightUnits;
		if (offset > 0) {
			leftUnits = Math.max(Math.round(delayUnits * (1 - offset)), 1);
			rightUnits = delayUnits;
		} else {
			leftUnits = delayUnits;
			rightUnits = Math.max(Math.round(delayUnits * (1 + offset)), 1);
		}
		const minDelayUnits = Math.min(leftUnits, rightUnits);
		this.effectiveDelayOffset = 1 - minDelayUnits / delayUnits;

		let modulationUnits = 0, effectiveModDepth = 0;
		if (type >= DelayType.CHORUS) {
			const maxModulation = Math.min(minDelayUnits, MAX_MODULATION);
			modulationUnits = Math.round(modulationDepth * maxModulation);
			this.modulationDepth = modulationDepth;
			effectiveModDepth = modulationUnits / maxModulation;
		}
		if (type < DelayType.FLANGE) {
			this.leftFeedback.linearRampToValueAtTime(0, time);
			this.rightFeedback.linearRampToValueAtTime(0, time);
		} else if (this.delayType <= DelayType.FLANGE) {
			this.setFeedbackAmount(this.feedback, time, method);
		}

		this.leftDelay[method](leftUnits * TIME_UNIT, time);
		this.rightDelay[method](rightUnits * TIME_UNIT, time);
		this.modDepthParam[method](modulationUnits * TIME_UNIT, time);
		let lfo = this.lfo;
		if (lfo === undefined) {
			if (modulationUnits > 0 && this.modulationRate !== 0) {
				lfo = new OscillatorNode(context, {frequency: this.modulationRate});
				lfo.start(time);
				this.lfo = lfo;
			}
		} else if (modulationUnits === 0) {
			lfo.stop(time);
			this.lfo = undefined;
		}

		this.delayType = type;
		this.delayAmount = amount;
		this.delayTime = delayUnits * TIME_UNIT;
		this.delayOffset = offset;
		this.effectiveModDepth = effectiveModDepth;
	}

	setDelayAmount(context, amount, type = this.delayType, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(amount, type, this.delayOffset, this.modulationDepth, time, method);
	}

	setDelayOffset(context, offset, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(this.delayAmount, this.delayType, offset, this.modulationDepth, time, method);
	}

	setModulationDepth(context, depth, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(this.delayAmount, this.delayType, this.delayOffset, depth, time, method);
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

	setModulationRate(rate, time = nextQuantum(context), method = 'setValueAtTime') {
		let lfo = this.lfo;
		if (lfo === undefined) {
			if (rate !== 0 && this.effectiveModDepth > 0) {
				lfo = new OscillatorNode(context, {frequency: this.modulationRate});
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

	setFeedback(amount, pan = this.feedbackPan, time = 0, method = 'setValueAtTime') {
		let leftAmount, rightAmount;
		if (pan <= 0) {
			leftAmount = 1;
			rightAmount = 1 + pan;
		} else {
			leftAmount = 1 - pan;
			rightAmount = 1;
		}
		leftAmount *= amount * this.feedbackPolarity[0];
		rightAmount *= amount * this.feedbackPolarity[1];
		this.leftFeedback[method](leftAmount, time);
		this.rightFeedback[method](rightAmount, time);
		this.feedback = amount;
		this.feedbackPan = pan;
	}

	setFeedbackAmount(amount, time = 0, method = 'setValueAtTime') {
		this.setFeedback(amount, this.feedbackPan, time, method);
	}

	setFeedbackPan(pan, time = 0, method = 'setValueAtTime') {
		this.setFeedback(this.feedback, pan, time, method);
	}

	getFeedbackAmount() {
		return this.feedback;
	}

	getFeedbackPan() {
		return this.feedbackPan;
	}

	setDelayPan(pan, width = this.delayWidth, time = 0, method = 'setValueAtTime') {
		this.leftDelayPan.pan[method](pan - width, time, method);
		this.rightDelayPan.pan[method](pan + width, time, method);
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

}

export {DelayType, EffectUnit};
