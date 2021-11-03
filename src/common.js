const CLOCK_RATE = {
	PAL: 	7600489,
	NTSC: 	7670454
}

const LFO_FREQUENCIES = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2, 0, 0, 0, 0, 0, 0, 0, 0];

const AM_PRESETS = [0, 1.4, 5.9, 11.8];

const VIBRATO_PRESETS = [0, 3.4, 6.7, 10, 14, 20, 40, 80].map(x => (2 ** (x / 1200)) - 1);

function decibelReductionToAmplitude(decibels) {
	return 10 ** (-decibels / 20);
}

export {
	CLOCK_RATE, LFO_FREQUENCIES, AM_PRESETS, VIBRATO_PRESETS,
	decibelReductionToAmplitude
}
