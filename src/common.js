const TIMER_IMPRECISION = 0.002;

const CLOCK_RATE = {
	PAL: 	7600489,
	NTSC: 	7670454
}

const LFO_FREQUENCIES = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2, 0, 0, 0, 0, 0, 0, 0, 0];

const VIBRATO_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80];

function decibelReductionToAmplitude(decibels) {
	return 10 ** (-decibels / 20);
}

function amplitudeToDecibels(amplitude) {
	return -20 * Math.log10(1 - amplitude);
}

export {
	TIMER_IMPRECISION, CLOCK_RATE, LFO_FREQUENCIES, VIBRATO_PRESETS,
	decibelReductionToAmplitude, amplitudeToDecibels
}
