const CLOCK_RATE = {
	PAL: 	7600489,
	NTSC: 	7670454
}

function decibelReductionToAmplitude(decibels) {
	return 10 ** (-decibels / 20);
}

export {
	CLOCK_RATE,
	decibelReductionToAmplitude
}
