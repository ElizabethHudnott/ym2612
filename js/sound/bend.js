import {logToLinear, linearToLog} from './opn2.js';

class Point {
	constructor(time, value) {
		this.time = time;	// in steps
		this.value = value;
	}
}

const IntervalType = Object.freeze({
	SMOOTH: 0,		// A smooth transition
	GLISSANDO: 1,	// A sequence of steps
	JUMP: 2,			// A single step
});

class Bend {

	static NUM_TIME_CONSTANTS = 4;

	constructor(initialValue, stepResolutionOption = 0) {
		this.points = [ new Point(0, initialValue) ];
		this.intervalTypes = [];
		// For the GUI only.
		this.stepsPerInteger = this.stepOptions[stepResolutionOption];
	}

	/**
	 * @param {number} timePerStep Either the duration of a line (fine changes, i.e. slower) or
	 * the duration of a tick, in seconds.
	 */
	execute(param, startTime, timePerStep, maxSteps, initialValue) {
		const points = this.points;
		let from = points[0].value;
		param.setValueAtTime(this.encodeValue(from, initialValue), startTime);
		let startStep = 0;
		const numPoints = points.length;
		for (let i = 1; i < points.length; i++) {
			let to = points[i].value;
			let endStep = points[i].time;
			let encodedValue;
			switch (this.intervalTypes[i - 1]) {

			case IntervalType.JUMP:
				endStep--;
				if (endStep > maxSteps) {
					return;
				}
				param.setValueAtTime(this.encodeValue(to, initialValue), startTime + endStep * timePerStep);
				break;

			case IntervalType.SMOOTH:

				// Smooth transition
				encodedValue = this.encodeValue(to, initialValue);
				if (this.isExponential) {

					if (startStep >= maxSteps) {
						return;
					}

					param.setTargetAtTime(
						encodedValue,
						startTime + startStep * timePerStep,
						(endStep - startStep) * timePerStep / Bend.NUM_TIME_CONSTANTS
					);

				} else {

					// Linear
					if (endStep > maxSteps) {
						to = from + (to - from) * (maxSteps - startStep) / (endStep - startStep);
						encodedValue = this.encodeValue(to, initialValue);
						param.linearRampToValueAtTime(encodedValue, startTime + maxSteps * timePerStep);
						return;
					} else {
						param.linearRampToValueAtTime(encodedValue, startTime + endStep * timePerStep);
					}

				}
				break;

			default:

				// Glissando
				let numIncrements = Math.abs(to - from);
				if (numIncrements > 0) {
					const stepsPerIncrement = (endStep - startStep) / numIncrements;
					let intValue = to >= from ? Math.ceil(from) : Math.trunc(from);
					const partIncrement = intValue - from;
					const partIncrementSteps = startStep +
						Math.abs(partIncrement) / numIncrements * stepsPerIncrement;
					if (partIncrementSteps > maxSteps) {
						return;
					}

					encodedValue = this.encodeValue(intValue, initialValue);
					param.setValueAtTime(encodedValue, startTime + partIncrementSteps * timePerStep);
					numIncrements -= Math.abs(partIncrement);
					const intIncrements = Math.trunc(numIncrements);

					for (let j = 1; j <= intIncrements; j++) {
						const incrementSteps = partIncrementSteps + j * stepsPerIncrement;
						if (incrementSteps > maxSteps) {
							return;
						}
						intValue = intValue + (to >= from ? 1 : -1);
						encodedValue = this.encodeValue(intValue, initialValue);
						param.setValueAtTime(encodedValue, startTime +  incrementSteps * timePerStep);
					}
				}
				if (endStep > maxSteps) {
					return;
				}
				encodedValue = this.encodeValue(to, initialValue)
				param.setValueAtTime(encodedValue, startTime + endStep * timePerStep);
			}

			from = to;
			startStep = endStep;
		}
	}

	get length() {
		return this.points[this.points.length - 1].time;
	}

	get isExponential() {
		return true;
	}

	get allowStepped() {
		return false;
	}

}

class PitchBend extends Bend {

	static STEP_OPTIONS = [1, 4, 16, 100];

	constructor() {
		super(0, 2);	// Default to 1/16 semitone increments
		this.maxUp = 2;
		this.maxDown = 2;
	}

	get min() {
		return -this.maxDown;
	}

	get max() {
		return this.maxUp;
	}

	get stepOptions() {
		return PitchBend.STEP_OPTIONS;
	}

	get allowStepped() {
		return true;
	}

	encodeValue(semitones, startFrequency) {
		return startFrequency * 2 ** (semitones / 12);
	}

}

class VolumeBend extends Bend {

	static STEP_OPTIONS = [1];

	constructor() {
		super(1);
	}

	get min() {
		return 0;
	}

	get max() {
		return 63;	// Amiga style volume measurement
	}

	get stepOptions() {
		return VolumeBend.STEP_OPTIONS;
	}

	encodeValue(volume) {
		return logToLinear(Math.round(volume * 1023 / 63));
	}

}

export {PitchBend, VolumeBend};
