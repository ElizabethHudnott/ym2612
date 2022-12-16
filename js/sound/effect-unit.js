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
		leftDelay.connect(leftFeedback);
		leftFeedback.connect(leftDelay);

		const rightDelay = new DelayNode(context, {maxDelayTime: maxDelayTime});
		this.rightDelay = rightDelay.delayTime;
		splitter.connect(rightDelay, 1);
		const rightFeedback = new GainNode(context, {gain: 0});
		rightDelay.connect(rightFeedback);
		rightFeedback.connect(rightDelay);
		this.feedbackParams = [leftFeedback.gain, rightFeedback.gain];

		const modGain = new GainNode(context, {gain: 0});
		this.modDepthParam = modGain.gain;

		const merger = new ChannelMergerNode(context, {numberOfInputs: 2});
		this.merger = merger;
		leftDelay.connect(merger, 0, 1);		// Send left input to right output
		rightDelay.connect(merger, 0, 0);	// Send right input to left output

		this.delayType = DelayType.DOUBLING;
		this.delayAmount = 128;		// Between 0 and approximately 255
		this.delayWidth = 0;			// Between -1 and 1
		this.modulationRate = 1.5;	// In Hertz
		this.modulationDepth = 0;	// Between 0 and 1
		this.feedback = [0.5, 0.5]; // Between -1 and 1 (left and right)
		this.lfo = undefined;
		this.setDelayAmount(this.delayAmount);
	}

	connectIn(input) {
		input.connect(this.splitter);
	}

	connectOut(destination) {
		this.merger.connect(destination);
	}

	setDelay(
		context, amount, type = this.delayType, width = this.delayWidth,
		modulationDepth = this.modulationDepth, time = nextQuantum(context),
		method = 'setValueAtTime'
	) {
		const delayUnits = TIME_OFFSETS[type] + amount * TIME_MULTIPLES[type];
		let leftUnits, rightUnits;
		if (width > 0) {
			leftUnits = Math.max(Math.round(delayUnits * (1 - 0.5 * width)), 1);
			rightUnits = delayUnits;
		} else {
			leftUnits = delayUnits;
			rightUnits = Math.max(Math.round(delayUnits * (1 + 0.5 * width)), 1);
		}
		const minDelayUnits = Math.min(leftUnits, rightUnits);
		this.effectiveDelayWidth = 1 - 2 * (minDelayUnits / delayUnits - 0.5);

		let modulationUnits = 0, effectiveModDepth = 0;
		if (type >= DelayType.CHORUS) {
			const maxModulation = Math.min(minDelayUnits, MAX_MODULATION);
			modulationUnits = Math.round(modulationDepth * maxModulation);
			this.modulationDepth = modulationDepth;
			effectiveModDepth = modulationUnits / maxModulation;
		}
		if (type < DelayType.FLANGE) {
			this.feedbackParams[0].linearRampToValueAtTime(0, time);
			this.feedbackParams[1].linearRampToValueAtTime(0, time);
		} else if (this.delayType < DelayType.FLANGE) {
			this.feedbackParams[0].setValueAtTime(this.feedback[0], time);
			this.feedbackParams[1].setValueAtTime(this.feedback[1], time);
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
		this.delayWidth = width;
		this.effectiveModDepth = effectiveModDepth;
	}

	setDelayAmount(context, amount, type = this.delayType, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(amount, type, this.delayWidth, this.modulationDepth, time, method);
	}

	setDelayWidth(context, width, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(this.delayAmount, this.delayType, width, this.modulationDepth, time, method);
	}

	setModulationDepth(context, depth, time = nextQuantum(context), method = 'setValueAtTime') {
		this.setDelay(this.delayAmount, this.delayType, this.delayWidth, depth, time, method);
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

	getDelayWidth() {
		return this.delayWidth;
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

	setFeedback(amount, channelMask = 3, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 2; i++) {
			if (channelMask & (1 << i)) {
				this.feedbackParams[i][method](amount, time);
				this.feedback[i] = amount;
			}
		}
	}

	getFeedback(channelNum = 0) {
		return this.feedback[channelNum];
	}

}

export {DelayType, EffectUnit};
