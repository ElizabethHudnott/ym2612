import {logToLinear, linearToLog} from './opn2.js';

class Point {
	constructor(time, value) {
		this.time = time;	// in steps
		this.value = value;
	}
}

const IntervalType = Object.freeze({
	SMOOTH: 0,		// A smooth transition
	GLISSANDO: 1,	// A sequence of jumps within one or more pitch bend steps
	JUMP: 2,			// A single jump
});

class Bend {

	static NUM_TIME_CONSTANTS = 4;

	constructor(initialValue, stepResolutionOption = 0) {
		this.points = [ new Point(0, initialValue) ];
		this.intervalTypes = [];
		// For the GUI only.
		this.stepsPerInteger = this.stepOptions[stepResolutionOption];
		this.releasePoint = Infinity;		// Note on bend only.
	}

	/**
	 * @param {AudioParam} param The audio parameter to modify.
	 * @param {boolean} release True to execute the key off portion of the bend, or false to
	 * execute the key on portion.
	 * @param {number} startTime The time relative to the AudioContext to begin making changes
	 * from.
	 * @param {number} timePerStep Either the duration of a line (fine changes, i.e. slower) or
	 * the duration of a tick, in seconds, or an absolute value if you don't want the effect
	 * tempo synced.
	 * @param {number} maxSteps The maximum number of bend steps to perform. If the bend is
	 * longer than the number of steps provided then only the beginning of the bend will be
	 * performed.
	 * @param {number} [initialValue] The audio parameter's initial value. Required for pitch
	 * bends, ignored for other types of bend.
	 * @param {number} [scaling=1] Scales the bend's values (y-axis) before applying them, for
	 * applying a greater or less extreme bend. Negative values inverts a pitch bend.
	 */
	execute(param, release, startTime, timePerStep, maxSteps, initialValue, scaling = 1, invert = false) {
		const points = this.points;
		let startStep, firstPointIndex;
		if (release) {
			firstPointIndex = this.releasePoint;
			if (firstPointIndex >= points.length) {
				// Bend doesn't contain any note off changes.
				return;
			}
			startStep = points[firstPointIndex].time;
			maxSteps += startStep;
		} else if (this.releasePoint === 0) {
			// Bend only contains note off changes.
			return;
		} else {
			firstPointIndex = 0;
			startStep = 0;
			if (this.releasePoint < points.length) {
				maxSteps = Math.min(maxSteps, points[this.releasePoint].time);
			}
		}

		let from = points[firstPointIndex].value * scaling;
		param.setValueAtTime(this.encodeValue(from, initialValue), startTime);

		for (let i = firstPointIndex + 1; i < points.length; i++) {
			let to = points[i].value * scaling;
			let endStep = points[i].time;
			let encodedValue;
			switch (this.intervalTypes[i - 1]) {

			case IntervalType.JUMP:
				// Jumps occur at the beginning of the step. Smooth transitions flow till the end.
				endStep--;
				if (endStep > maxSteps) {
					return;
				}
				param.setValueAtTime(this.encodeValue(to, initialValue), startTime + endStep * timePerStep);
				break;

			case IntervalType.SMOOTH:

				// Smooth transition
				encodedValue = this.encodeValue(to, initialValue);

				if (startStep >= maxSteps) {

					return;

				} else if (this.isExponential) {

					const timeConstantInSteps = (endStep - startStep) / Bend.NUM_TIME_CONSTANTS;
					param.setTargetAtTime(
						encodedValue,
						startTime + startStep * timePerStep,
						timeConstantInSteps * timePerStep
					);
					if (endStep > maxSteps) {
						const value = to + (from - to) * Math.exp((startStep - maxSteps) / timeConstantInSteps);
						encodedValue = this.encodeValue(value, initialValue);
						param.setValueAtTime(encodedValue, startTime + maxSteps * timePerStep);
						return;
					}

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
				if (startStep >= maxSteps) {
					return;
				}

				const gradient = (to - from) / (endStep - startStep);
				endStep = Math.min(endStep, maxSteps);
				encodedValue = this.encodeValue(from, initialValue);
				const round = to >= from ? Math.trunc : Math.ceil;
				let prevIntValue = round(from);
				to = from;
				for (let j = startStep + 1; j <= endStep; j++) {
					const intValue = round(from + (j - startStep) * gradient);
					if (prevIntValue !== intValue) {
						encodedValue = this.encodeValue(intValue, initialValue);
						param.setValueAtTime(encodedValue, startTime + j * timePerStep);
						to = intValue;
						prevIntValue = intValue;
					}
				}
				param.setValueAtTime(encodedValue, startTime + endStep * timePerStep);

			}

			from = to;
			startStep = endStep;
		}
	}

	getLength(release = false) {
		const points = this.points;
		const numSteps = points[points.length - 1].time;
		const releasePointIndex = this.releasePoint;
		if (release) {
			if (releasePointIndex < points.length) {
				return numSteps - points[releasePointIndex].time;
			} else {
				return 0;
			}
		} else {
			if (releasePointIndex < points.length) {
				return points[releasePointIndex].time;
			} else {
				return numSteps;
			}
		}
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
