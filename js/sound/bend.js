import {logToLinear, linearToLog} from './opn2.js';

class Point {
	constructor(time, value) {
		this.time = time;	// in steps
		this.value = value;
	}
}

class Bend {

	static NUM_TIME_CONSTANTS = 4;

	constructor(initialValue, stepResolutionOption = 0) {
		this.points = [ new Point(0, initialValue) ];
		this.smooth = [];
		this.stepsPerInteger = this.stepOptions[stepResolutionOption];
	}

	/**
	 * @param {number} timePerStep Either the duration of a line (fine changes, i.e. slower) or
	 * the duration of a tick, in seconds.
	 */
	execute(param, startTime, timePerStep, initialValue) {
		const points = this.points;
		let from = points[0].value;
		param.setValueAtTime(this.encodeValue(from, initialValue), startTime);
		let startStep = 0;
		const numPoints = points.length;
		for (let i = 1; i < points.length; i++) {
			let to = points[i].value;
			const endStep = points[i].time;
			if (this.smooth[i - 1]) {

				// Smooth transition
				const encodedValue = this.encodeValue(to, initialValue);
				if (this.isExponential) {
					param.setTargetAtTime(
						encodedValue,
						startTime + startStep * timePerStep,
						(endStep - startStep) * timePerStep / Bend.NUM_TIME_CONSTANTS
					);
				} else {
					param.linearRampToValueAtTime(encodedValue, startTime + endStep * timePerStep);
				}

			} else {

				// Stepped transition
				const stepSize = this.stepsPerInteger;
				const gradient = (to - from) * stepSize / (endStep - startStep);
				for (let j = startStep + 1; j <= endStep; j++) {
					const numSteps = j - startStep;
					const value = from + Math.trunc(numSteps * gradient) / stepSize;
					param.setValueAtTime(
						this.encodeValue(value, initialValue),
						startTime + j * timePerStep
					);
				}

			}

			from = to;
			startStep = endStep;
		}
	}

	get isExponential() {
		return true;
	}
}

class PitchBend extends Bend {

	static STEP_OPTIONS = [1, 4, 16, 64]

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

	encodeValue(semitones, startFrequency) {
		return startFrequency * 2 ** (semitones / 12);
	}

	decodeValue(frequency, startFrequency) {
		return 12 * Math.log2(frequency / startFrequency) ;
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

	decodeValue(gain) {
		return linearToLog(gain) * 63 / 1023;
	}

}

export {PitchBend, VolumeBend};
