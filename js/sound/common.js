const TIMER_IMPRECISION = 0.002;
const NEVER = 8388500;

const ClockRate = {
	PAL: 	53203424 / 7,
	NTSC: 53693175 / 7
}

const LFO_FREQUENCIES = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2, 0, 0, 0, 0, 0, 0, 0, 0];

const VIBRATO_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80];

function decibelReductionToAmplitude(decibels) {
	return 10 ** (-decibels / 20);
}

function amplitudeToDecibels(amplitude) {
	return -20 * Math.log10(1 - amplitude);
}

/**Creates a sample that can be used as a waveform for creating chip tunes.
 * @param {number} sampleRate The sample rate of the AudioContext used to play the sample.
 * @param {object} options An object containing any additional options.
*/
function makeBasicWaveform(sampleRate, options = {}) {
	// 'sine' or 'triangle'.
	let type = options.type || ('duty' in options ? 'triangle' : 'sine');

	// Default to a 50% duty cycle for triangle waves.
	let dutyCycle = 'duty' in options ? options.duty : 0.5;

	// The number of samples used.
	const length = options.length || 1024;

	// Default to 25 bit precision (mantissa length + sign bit of a IEEE 754 single precision number).
	// Each sample has one of 2**sampleBits + 1 values.
	const sampleBits = options.bits || 25;

	// If set to 1 then the portions of the wave from PI/2 to PI radians and from 3PI/2 to 2PI
	// radians are zeroed out (These values are for a 50% duty cycle). Defaults to 0. Fractional
	// values are possible too.
	const zeroed = options.pulse || 0;

	// Default to leaving negative samples as negative, i.e. undistorted, rather than creating,
	// for example, a half sine (0) wave or a camel sine (-1) wave.
	const negative = 'negative' in options ? options.negative : 1;

	// For example,  0.25 turns a sine wave into a cosine wave. Phase shifts are inserted
	// *after* negative samples interpretation.
	const phaseShift = options.phaseShift || 0;

	// By default the waveform takes up 100% of the available samples, with no zero samples
	// added as padding. Values between 0 and 1 are permissible.
	const width = options.width || 1;

	// By default, don't intensify the wave by cubing the basic waveform's sample values.
	const squared = options.power === 2;

	// Multiple waves can be summed and normalized but we default to using the fundamental only.
	const harmonics = options.harmonics || [1];

	let wave;
	if (type === 'sine') {

		wave = function (x) {
			return Math.sin(2 * Math.PI * x);
		}

	} else {

		// triangle (or sawtooth when dutyCycle equals 1)
		wave = function (x) {
			x = (x + 0.5 * dutyCycle) % 1;
			if (x < dutyCycle) {
				return 2 * x / dutyCycle - 1;
			} else {
				return 1 - 2 * (x - dutyCycle) / (1 - dutyCycle);
			}
		}

	}

	const buffer = new AudioBuffer({length: length, sampleRate: sampleRate});
	const data = buffer.getChannelData(0);
	const period = Math.round(length * width);
	const cutoffOneLB = dutyCycle / 2 + (1 - zeroed) * (1 - dutyCycle) / 2;
	const zeroPoint = dutyCycle / 2 + (1 - dutyCycle) / 2;
	const cutoffTwoLB = dutyCycle / 2 + (1 - dutyCycle) + (1 - zeroed) * dutyCycle / 2;

	for (let harmonic of harmonics) {
		for (let i = 0; i < period; i++) {
			const x = ((i + 0.5) * harmonic / period) % 1;
			let value, phaseShifted;
			if (x > cutoffTwoLB || (x > cutoffOneLB && x <= zeroPoint)) {
				value = 0;
			} else {
				value = wave(x);
				phaseShifted = wave(x + phaseShift);
				if (value < 0) {
					phaseShifted *= negative;
				}
				if (squared) {
					phaseShifted = Math.abs(phaseShifted) * phaseShifted;
				}
			}
			data[i] += phaseShifted;
		}
	}

	let max = 0;
	for (let i = 0; i < period; i++) {
		max = Math.max(max, data[i]);
	}

	const steps = 2 ** (sampleBits - 1);
	for (let i = 0; i < period; i++) {
		data[i] = Math.round(steps * data[i] / max) / steps;
	}

	return buffer;
}

const MICRO_TUNINGS = Object.freeze({
	WHITE_ONLY: 	[0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
	BLACK_ONLY: 	[1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0],
	PURE_MAJOR: 	[0.70673, 1.33237, 1.11731, 0.70673, 1.11731, 0.70673, 1.33237, 0.70673, 1.11731, 1.33237, 0.70673, 1.11731],
	PURE_MINOR: 	[0.70673, 1.11731, 1.33237, 0.70673, 1.11731, 0.70673, 1.33237, 0.70673, 1.11731, 1.33237, 0.70673, 1.11731],
	MEAN_TONE: 		[0.76049, 1.171079, 1.171078, 0.76049, 1.171079, 0.76049, 1.171078, 0.76049, 1.171079, 1.171079, 0.760489, 1.171079],
	PYTHAGOREAN: 	[1.13685, 0.90225, 0.90225, 1.13685, 0.90225, 1.13685, 0.90225, 1.13685, 0.90225, 0.90225, 1.13685, 0.90225],
	WERCKMEISTER: 	[0.90225, 1.01955, 1.01955, 0.9609, 1.0782, 0.90225, 1.0782, 0.9609, 0.9609, 1.0782, 0.9609, 1.0782],
	KIRNBERGER: 	[0.90225, 1.02932, 1.00978, 0.92179, 1.11731, 0.92179, 1.06354, 0.95602, 0.97555, 1.06355, 0.92179, 1.11731],
	VALLOTTI: 		[0.94135, 1.01955, 1.01955, 0.94135, 1.09775, 0.90225, 1.05865, 0.98045, 0.98045, 1.05865, 0.90225, 1.09775],
});

/**
 * @param {number} gradations Use 85 for the SY-77 family (approximate) or 64 for the DX11 and
 * TX81Z.
 */
function roundMicrotuning(steps, gradations = 64) {
	const numSteps = steps.length;
	const newSteps = new Array(numSteps);
	let error = 0, originalTotal = 0, roundedTotal = 0;
	for (let i = 0; i < numSteps - 1; i++) {
		const rounded = Math.round((steps[i] - error) * gradations) / gradations;
		newSteps[i] = rounded;
		originalTotal += steps[i];
		roundedTotal += rounded;
		error = roundedTotal - originalTotal;
	}
	newSteps[numSteps - 1] = numSteps - roundedTotal;
	return newSteps;
}

function rotateArray(arr, shift) {
	const length = arr.length;
	const newArr = new Array(length);
	for (let i = 0; i < length; i++) {
		newArr[i] = arr[(i + shift) % length];
	}
	return newArr;
}

export {
	decibelReductionToAmplitude, amplitudeToDecibels, makeBasicWaveform,
	roundMicrotuning, rotateArray,
	TIMER_IMPRECISION, NEVER, ClockRate, LFO_FREQUENCIES, VIBRATO_PRESETS, MICRO_TUNINGS,
}
