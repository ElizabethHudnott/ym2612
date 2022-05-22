import {VIBRATO_PRESETS, PROCESSING_TIME} from './common.js';
import {AbstractChannel} from './fm-channel.js';

export default class TwoOperatorChannel extends AbstractChannel {

	static algorithms = [
		[99, [0, 99]], // FM
		[0, [99, 99]], // Additive
	];

	constructor(parentChannel, startingOperator) {
		super();
		this.parentChannel = parentChannel;
		this.operatorOffset = startingOperator - 1;
		this.tremoloDepth = 0;
		this.vibratoDepth = 0;
		this.tuneNotes();
	}

	copyOperator(from, to) {
		const parent = this.parentChannel;
		const effectiveFrom = this.operatorOffset + from;
		const effectiveTo = this.operatorOffset + to;
		const fromOperator = parent.getOperator(effectiveFrom);
		const toOperator = parent.getOperator(effectiveTo);
		fromOperator.copyTo(toOperator);

		let block = parent.getFrequencyBlock(effectiveFrom);
		let freqNum = parent.getFrequencyNumber(effectiveFrom);
		const multiple = parent.getFrequencyMultiple(effectiveFrom);
		const fixedFrequency = parent.isOperatorFixed(effectiveFrom);

		if (to !== 2 || fixedFrequency) {
			parent.freqBlockNumbers[effectiveTo - 1] = block;
			parent.frequencyNumbers[effectiveTo - 1] = freqNum;
		}
		parent.setFrequencyMultiple(effectiveTo, multiple);
		parent.fixedFrequency[effectiveTo - 1] = fixedFrequency;

		if (fixedFrequency) {
			toOperator.setFrequency(block, freqNum, 1);
		} else {
			block = parent.getFrequencyBlock(this.operatorOffset + 2);
			freqNum = parent.getFrequencyNumber(this.operatorOffset + 2);
			this.setFrequency(block, freqNum);
		}

		const sensitivity = parent.getDynamics(effectiveFrom);
		parent.setDynamics(
			effectiveTo, sensitivity.minLevel, sensitivity.maxLevel, 0,
			sensitivity.minAttack, sensitivity.maxAttack
		);
		parent.setOperatorDelay(effectiveTo, parent.getOperatorDelay(effectiveFrom));
	}

	getOperator(operatorNum) {
		return this.parentChannel.getOperator(this.operatorOffset + operatorNum);
	}

	/**Switches into two operator mode. A fixed panning setting for the pair of two
	 * operator channels needs to be configured on the parent channel.
	 */
	activate(context, time = 0) {
		const parent = this.parentChannel;
		parent.setGain(0.5, time);	// Reserve half the output level for the other 2 op channel.
		// Disable features that don't apply to 2 op channels.
		parent.setLFOShape(context, 'triangle', time);	// Fixed LFO shape
		parent.setLFOKeySync(context, false);
		parent.applyLFO(time);	// No LFO envelope
		parent.mute(false, time);
	}

	setAlgorithm(modulationDepth, outputLevels, time = 0, method = 'setValueAtTime') {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		parent.setModulationDepth(offset + 1, offset + 2, modulationDepth, time, method);
		for (let i = 1; i <= 2; i++) {
			const operator = parent.getOperator(offset + i);
			const outputLevel = outputLevels[i - 1] || 0;
			operator.enable();
			operator.setOutputLevel(outputLevel, time, method);
		}
	}

	useAlgorithm(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = TwoOperatorChannel.algorithms[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
	}

	getAlgorithm() {
		const isFM = this.getModulationDepth(1, 2) !== 0;
		return isFM ? 0 : 1;
	}

	setModulationDepth(amount, time = 0, method = 'setValueAtTime') {
		const offset = this.operatorOffset;
		this.parentChannel.setModulationDepth(offset + 1, offset + 2, amount, time, method);
	}

	getModulationDepth() {
		const offset = this.operatorOffset;
		return this.parentChannel.getModulationDepth(offset + 1, offset + 2);
	}

	disableOperator(operatorNum, time = 0) {
		this.parentChannel.disableOperator(this.operatorOffset + operatorNum, time);
	}

	enableOperator(operatorNum) {
		this.parentChannel.enableOperator(this.operatorOffset + operatorNum);
	}

	fixFrequency(operatorNum, fixed, time = undefined) {
		const parent = this.parentChannel;
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const multiple = parent.getFrequencyMultiple(effectiveOperatorNum);

		if (fixed) {
			if (multiple !== 1 && !parent.isOperatorFixed(effectiveOperatorNum) &&
				(operatorNum !== 2 || parent.isOperatorFixed(this.operatorOffset))
			) {
				// Turn a frequency multiple into a fixed frequency.
				let block = parent.getFrequencyBlock(this.operatorOffset + 2);
				let freqNum = parent.getFrequencyNumber(this.operatorOffset + 2);
				[block, freqNum] = this.multiplyFreqComponents(block, freqNum, multiple);
				parent.freqBlockNumbers[effectiveOperatorNum - 1] = block;
				parent.frequencyNumbers[effectiveOperatorNum - 1] = freqNum;
			}
		} else if (time !== undefined) {
				// Restore a frequency ratio
				const operator = parent.getOperator(effectiveOperatorNum);
				const block = parent.getFrequencyBlock(this.operatorOffset + 2);
				const freqNum = parent.getFrequencyNumber(this.operatorOffset + 2);
				operator.setFrequency(block, freqNum, multiple, time);
		}
		parent.fixedFrequency[effectiveOperatorNum - 1] = fixed;
	}

	isOperatorFixed(operatorNum) {
		return this.parentChannel.isOperatorFixed(this.operatorOffset + operatorNum);
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, glideRate = 0) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (!parent.isOperatorFixed(operatorNum)) {
				const operator = parent.getOperator(operatorNum);
				const multiple = parent.getFrequencyMultiple(operatorNum);
				operator.setFrequency(blockNumber, frequencyNumber, multiple, time, glideRate);
			}
		}
		parent.freqBlockNumbers[offset + 1] = blockNumber;
		parent.frequencyNumbers[offset + 1] = frequencyNumber;
	}

	setOperatorFrequency(operatorNum, blockNumber, frequencyNumber, time = 0, glideRate = 0) {
		this.parentChannel.setOperatorFrequency(this.operatorOffset + operatorNum, blockNumber, frequencyNumber, time, glideRate);
	}

	getFrequencyBlock(operatorNum = 2) {
		return this.parentChannel.getFrequencyBlock(this.operatorOffset + operatorNum);
	}

	getFrequencyNumber(operatorNum = 2) {
		return this.parentChannel.getFrequencyNumber(this.operatorOffset + operatorNum);
	}

	setFrequencyMultiple(operatorNum, multiple, time = undefined) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		const effectiveOperatorNum = offset + operatorNum;
		parent.setFrequencyMultiple(effectiveOperatorNum, multiple);
		if (time !== undefined && !parent.isOperatorFixed(effectiveOperatorNum)) {
			const block = parent.getFrequencyBlock(offset + 1);
			const freqNum = parent.getFrequencyNumber(offset + 1);
			const operator = parent.getOperator(effectiveOperatorNum);
			operator.setFrequency(block, freqNum, multiple, time);
		}
	}

	getFrequencyMultiple(operatorNum) {
		return this.parentChannel.getFrequencyMultiple(this.operatorOffset + operatorNum);
	}

	setMIDINote(noteNumber, time = 0, glideRate = 0) {
		const block = this.noteFreqBlockNumbers[noteNumber];
		const freqNum = this.noteFrequencyNumbers[noteNumber];
		this.setFrequency(block, freqNum, time, glideRate);
	}

	pitchBend(
		bend, release, startTime, timesPerStep, scaling = 1, operatorMask = undefined,
		maxSteps = bend.getLength(release)
	) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		if (operatorMask === undefined) {
			operatorMask = !parent.isOperatorFixed(offset);
			operatorMask |= (!parent.isOperatorFixed(offset + 1)) << 1;
		}
		for (let i = 0; i < 2; i++) {
			if (operatorMask & (1 << i)) {
				const operator = parent.getOperator(offset + i);
				bend.execute(
					operator.frequencyParam, release, startTime, timesPerStep, scaling,
					operator.frequency, maxSteps
				);
			}
		}
	}

	setOperatorNote(operatorNum, noteNumber, time = 0, glideRate = 0) {
		const parent = this.parentChannel;
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		parent.fixFrequency(effectiveOperatorNum, true, undefined, false);
		const block = this.noteFreqBlockNumbers[noteNumber];
		const freqNum = this.noteFrequencyNumbers[noteNumber];
		parent.setOperatorFrequency(effectiveOperatorNum, block, freqNum, time, glideRate);
	}

	getMIDINote(operatorNum = 2) {
		const parent = this.parentChannel;
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const block = parent.getFrequencyBlock(effectiveOperatorNum);
		const freqNum = parent.getFrequencyNumber(effectiveOperatorNum);
		return this.frequencyToNote(block, freqNum);
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setFeedback(amount, this.operatorOffset + 1, time, method);
	}

	getFeedback() {
		return this.parentChannel.getFeedback(this.operatorOffset + 1);
	}

	useFeedbackPreset(n, time = 0, method = 'setValueAtTime') {
		this.parentChannel.useFeedbackPreset(n, this.operatorOffset + 1, time, method);
	}

	getFeedbackPreset() {
		return this.parentChannel.getFeedbackPreset(this.operatorOffset + 1);
	}

	setTremoloDepth(depth, time = 0, method = 'setValueAtTime') {
		const linearAmount = (1020 * depth / 384) / 1023;
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isTremoloEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloDepth() {
		return Math.round(this.tremoloDepth * 1023 / 1020 * 384);
	}

	useTremoloPreset(presetNum, time = 0, method = 'setValueAtTime') {
		const linearAmount = TREMOLO_PRESETS[presetNum];
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isTremoloEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloPreset() {
		const depth = Math.round(this.tremoloDepth * 1023);
		return TREMOLO_PRESETS.indexOf(depth);
	}

	enableTremolo(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const operator = this.parentChannel.getOperator(effectiveOperatorNum);
		operator.setTremoloDepth(enabled ? this.tremoloDepth : 0, time, method);
		parentChannel.tremoloEnabled[effectiveOperatorNum - 1] = enabled;
	}

	isTremoloEnabled(operatorNum) {
		return this.parentChannel.isTremoloEnabled(this.operatorOffset + operatorNum);
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const linearAmount = Math.sign(cents) * (2 ** (Math.abs(cents) / 1200) - 1);
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isVibratoEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setVibratoDepth(linearAmount, time, method);
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
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const operator = this.parentChannel.getOperator(effectiveOperatorNum);
		operator.setVibratoDepth(enabled ? this.vibratoDepth : 0, time, method);
		parentChannel.vibratoEnabled[effectiveOperatorNum - 1] = enabled;
	}

	isVibratoEnabled(operatorNum) {
		return this.parentChannel.isVibratoEnabled(this.operatorOffset + operatorNum);
	}

	setLFORate(context, frequency, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setLFORate(context, frequency, time, method);
	}

	getLFORate() {
		return this.parentChannel.getLFORate();
	}

	useLFOPreset(context, presetNum, time = 0, method = 'setValueAtTime') {
		this.parentChannel.useLFOPreset(context, presetNum, time, method);
	}

	getLFOPreset() {
		return this.parentChannel.getLFOPreset();
	}

	keyOnOff(
		context, velocity = 127, time = context.currentTime + PROCESSING_TIME,
		op1 = velocity !== 0, op2 = op1
	) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		const operator1 = parent.getOperator(offset + 1);
		const operator2 = parent.getOperator(offset + 2);
		if (op1) {
			operator1.keyOn(context, velocity, time + parent.getOperatorDelay(offset + 1));
		} else {
			operator1.keyOff(time);
		}
		if (op2) {
			operator2.keyOn(context, velocity, time + parent.getOperatorDelay(offset + 2));
		} else {
			operator2.keyOff(time);
		}
		parent.scheduleOscillators();
	}

	keyOn(context, velocity = 127, time = context.currentTime + PROCESSING_TIME) {
		this.keyOnOff(context, velocity, time);
	}

	keyOff(context, time = context.currentTime) {
		this.keyOnOff(context, 0, time);
	}

	setOperatorDelay(operatorNum, delay) {
		this.parentChannel.setOperatorDelay(this.operatorOffset + operatorNum, delay);
	}

	getOperatorDelay(operatorNum) {
		return this.parentChannel.getOperatorDelay(this.operatorOffset + operatorNum);
	}

	soundOff(time = 0) {
		for (let i = 1; i <= 2; i++) {
			this.parentChannel.getOperator(this.operatorOffset + i).soundOff(time);
		}
	}

	tuneNotes(detune = 0, interval = 2, divisions = 12, steps = [1]) {
		const tuning = this.parentChannel.synth.getTuning(detune, interval, divisions, steps);
		this.octaveThreshold = tuning.octaveThreshold;
		this.noteFreqBlockNumbers = tuning.freqBlockNumbers;
		this.noteFrequencyNumbers = tuning.frequencyNumbers;
	}

	get numberOfOperators() {
		return 2;
	}

}
