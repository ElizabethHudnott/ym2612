const PROCESSING_TIME = 0.001;
const NEVER = 8388498;

const ClockRate = {PAL: 53203424, NTSC: 53693175};

const LFO_FREQUENCIES = [0, 3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2];

const VIBRATO_RANGES = [5, 10, 20, 50, 100, 400, 700]

const VIBRATO_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80];

function cancelAndHoldAtTime(param, holdValue, time) {
	if (param.cancelAndHoldAtTime) {
		param.cancelAndHoldAtTime(time);
	} else {
		param.cancelScheduledValues(time);
	}
	param.setValueAtTime(holdValue, time);
}

function decibelReductionToAmplitude(decibels) {
	return 10 ** (-decibels / 20);
}

function amplitudeToDecibels(amplitude) {
	return -20 * Math.log10(1 - amplitude);
}

const MICRO_TUNINGS = {
	WHITE_ONLY: 	[0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
	BLACK_ONLY: 	[1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0],
	PURE_MAJOR: 	[0.70673, 1.33237, 1.11731, 0.70673, 1.11731, 0.70673, 1.33237, 0.70673, 1.11731, 1.33237, 0.70673, 1.11731],
	PURE_MINOR: 	[0.70673, 1.11731, 1.33237, 0.70673, 1.11731, 0.70673, 1.33237, 0.70673, 1.11731, 1.33237, 0.70673, 1.11731],
	MEAN_TONE: 		[0.76049, 1.171079, 1.171078, 0.76049, 1.171079, 0.76049, 1.171078, 0.76049, 1.171079, 1.171079, 0.760489, 1.171079],
	PYTHAGOREAN: 	[1.13685, 0.90225, 0.90225, 1.13685, 0.90225, 1.13685, 0.90225, 1.13685, 0.90225, 0.90225, 1.13685, 0.90225],
	WERCKMEISTER: 	[0.90225, 1.01955, 1.01955, 0.9609, 1.0782, 0.90225, 1.0782, 0.9609, 0.9609, 1.0782, 0.9609, 1.0782],
	KIRNBERGER: 	[0.90225, 1.02932, 1.00978, 0.92179, 1.11731, 0.92179, 1.06354, 0.95602, 0.97555, 1.06355, 0.92179, 1.11731],
	VALLOTTI: 		[0.94135, 1.01955, 1.01955, 0.94135, 1.09775, 0.90225, 1.05865, 0.98045, 0.98045, 1.05865, 0.90225, 1.09775],
};

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

/** Approximately -48db converted to base 2.
 *  https://gendev.spritesmind.net/forum/viewtopic.php?f=24&t=386&p=6114&hilit=48db#p6114
 */
const ATTENUATION_BITS = 8;

/**
 * @param {number} x A number in the range 0 (silence) to 1023 (loudest).
 * @return {number} A number in the range 0 (silence) to 1 (loudest).
 */
function logToLinear(x) {
	if (x <= 0) {
		return 0;
	}
	return 2 ** (-ATTENUATION_BITS * (1023 - Math.abs(x)) / 1024);
}

/**
 * @param {number} y A number in the range 0 (silence) to 1 (loudest).
 * @return {number} A number in the range 0 (silence) to 1023 (loudest).
 */
function linearToLog(y) {
	if (y <= 0) {
		return 0;
	}
	return 1023 + Math.log2(Math.abs(y)) * 1024 / ATTENUATION_BITS;
}

const DX_TO_SY_LEVEL = [
	0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46, 48
];

function dxToSYLevel(outputLevel) {
	if (outputLevel < 20) {
		return DX_TO_SY_LEVEL[Math.round(outputLevel)]
	} else {
		return outputLevel + 28;
	}
}

function syToDXLevel(level) {
	if (level >= 48) {
		return level - 28;
	} else {
		for (let i = 19; i >= 0; i--) {
			if (level >= DX_TO_SY_LEVEL[i]) {
				return i;
			}
		}
	}
}

function modulationIndex(outputLevel) {
	const level = dxToSYLevel(Math.abs(outputLevel));
	return Math.sign(outputLevel) * Math.PI * 2 ** (33 / 16 - (127 - level) / 8);
}

function outputLevelToGain(outputLevel) {
	const level = dxToSYLevel(Math.abs(outputLevel));
	return Math.sign(outputLevel) * logToLinear(level * 1023 / 127);
}

function gainToOutputLevel(gain) {
	const level = linearToLog(Math.abs(gain)) * 127 / 1023;
	return Math.sign(gain) * syToDXLevel(level);
}

/**Produces a Float32Array that can be used as a waveform for creating chip tunes.
 * @param {object} options An object containing any additional options.
*/
function makeBasicWaveform(options = {}, length = 1024) {
	// 'sine' or 'triangle'.
	let type = options.type || ('dutyCycle' in options ? 'triangle' : 'sine');

	// Default to a 50% duty cycle for triangle waves.
	let dutyCycle = 'dutyCycle' in options ? options.dutyCycle : 0.5;

	// Default to maximum amplitude
	const amplitude = options.amplitude || 1;

	const freqNumerator = options.frequencyMultiply || 1;
	const freqDenominator = options.frequencyDivide || 1;
	const frequency = freqNumerator / freqDenominator;

	// Default to leaving negative samples as negative, i.e. undistorted, rather than creating,
	// for example, a half sine (0) wave or a camel sine (1) wave.
	const negative = 'negative' in options ? -1 * options.negative : 1;

	// For example, 0.25 turns a sine wave into a cosine wave.
	const phaseShift = options.phase || 0;

	// By default the waveform takes up 100% of the available samples, with no zero samples
	// added as padding. Values between 0 and 1 are permissible.
	const width = options.width || 1;

	// By default, don't intensify the wave by squaring, etc.
	const power = 'power' in options ? options.power : 1;

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

	const data = new Float32Array(length);
	const wavePeriod = Math.round(length / frequency * width);
	const fullPeriod = Math.round(length / frequency);

	for (let i = 0; i < length; i++) {
		const fullX = (i + phaseShift * fullPeriod) % fullPeriod;
		if (fullX < wavePeriod) {
			const waveX = ((fullX + 0.5) / wavePeriod) % 1;
			let value = wave(waveX);
			value = Math.sign(value) * (Math.abs(value) ** power);
			if (value < 0) {
				value *= negative;
			}
			data[i] = amplitude * value;
		}
	}

	return data;
}

function gcd(a, b) {
	while (b !== 0) {
		[a, b] = [b, a % b];
	}
	return a;
}

function lcm(values) {
	if (values.length === 0) {
		return 1;
	}
	let lcmSoFar = values[0];
	for (let i = 1; i < values.length; i++) {
		const nextValue = values[i];
		lcmSoFar = lcmSoFar * nextValue / gcd(lcmSoFar, nextValue);
	}
	return lcmSoFar;
}

/**
 * @param {number} sampleBits Defaults to 25 bit precision (mantissa length + sign bit of an
 * IEEE 754 single precision number). Each sample has one of 2**sampleBits + 1 values.
 */
function makeMathyWave(waveOptionsArr, sampleRate, length = 1024, sampleBits = 25) {
	const numWaves = waveOptionsArr.length;
	const denominators = [];
	for (let waveOptions of waveOptionsArr) {
		let denominator = waveOptions.frequencyDivide;
		if (denominator) {
			const numerator = waveOptions.frequencyMultiply || 1;
			denominator /= gcd(numerator, denominator);
			denominators.push(denominator);
		}
	}
	length *= lcm(denominators);

	const waves = new Array(numWaves);
	for (let i = 0; i < numWaves; i++) {
		waves[i] = makeBasicWaveform(waveOptionsArr[i], length);
	}

	const buffer = new AudioBuffer({length: length, sampleRate: sampleRate});
	const summedWave = buffer.getChannelData(0);
	let min = Number.MAX_VALUE, max = Number.MIN_VALUE, offset = 0;
	for (let i = 0; i < length; i++) {
		let total = 0;
		for (let wave of waves) {
			total += wave[i];
		}
		summedWave[i] = total;
		offset += total;
		min = Math.min(min, total);
		max = Math.max(max, total);
	}

	const subtract = offset / length;
	min -= subtract;
	max -= subtract;
	const magnitude = Math.max(max, Math.abs(min));

	const steps = 2 ** (sampleBits - 1);
	for (let i = 0; i < length; i++) {
		const value = (summedWave[i] - subtract) / magnitude;
		summedWave[i] = Math.round(steps * value) / steps;
	}

	return buffer;
}

export {
	cancelAndHoldAtTime, decibelReductionToAmplitude, amplitudeToDecibels,
	roundMicrotuning,
	logToLinear, linearToLog, modulationIndex, outputLevelToGain, gainToOutputLevel,
	makeMathyWave,
	PROCESSING_TIME, NEVER, ClockRate, LFO_FREQUENCIES, VIBRATO_RANGES, VIBRATO_PRESETS,
	MICRO_TUNINGS,
}
