class OscillatorConfig {
	/**
	 * @param {string} oscillator1Shape The waveform used for the carrier oscillator:
	 * 'sine', 'cosine', sawtooth', square' or 'triangle'.
	 * @param {boolean} waveShaping Inverts the negative portion of the carrier oscillator's
	 * waveform when true.
	 * @param {number} bias The amount of DC offset to add.
	 * @param {string} oscillator2Shape The waveform used for the modulator oscillator:
	 * 'sine', 'cosine', sawtooth', square', 'triangle' or undefined (no modulation).
	 * @param {number} oscillator2FrequencyMult The frequency of the modulator relative to the base
	 * frequency.
	 * @param {number} oscillator1FrequencyMult The frequency of the carrier relative to the base
	 * frequency, which is usually 1 but a few waveforms use 2. If this parameter has a value
	 * other than 1 then the value of oscillator2FrequencyMult must be 1.
	 * @param {number} modDepth How much amplitude modulation to apply [-2..2]. The values 2 and
	 * -2 result in ring modulation rather than AM.
	 * @param {number} gain Scales the resulting wave by a constant.
	 * @param {boolean} additive Adds the modulator signal to the carrier before performing
	 * modulation.
	 */
	constructor(
		oscillator1Shape, waveShaping = false, bias = 0,
		oscillator2Shape = undefined, oscillator2FrequencyMult = 1, oscillator1FrequencyMult = 1,
		modDepth = 1, gain = 1, additive = false
	) {
		if (oscillator1Shape === 'cosine') {
			this.oscillator1Shape = 'custom';
			this.sines = Float32Array.from([0, 0]);
			this.cosines = Float32Array.from([0, 1]);
		} else {
			this.oscillator1Shape = oscillator1Shape;
			this.sines = undefined;
			this.cosines = undefined;
		}
		this.periodicWave = undefined;
		this.waveShaping = waveShaping;
		this.bias = bias;
		this.oscillator2Shape = oscillator2Shape;
		this.modDepth = 0.5 * modDepth;
		this.oscillator1FrequencyMult = oscillator1FrequencyMult;
		this.frequencyMultiplier = oscillator1FrequencyMult !== 1 ? oscillator1FrequencyMult : oscillator2FrequencyMult;
		this.gain = gain;
		this.additive = additive;
		this.frequencyOffset = 0;	// Value in Hertz added to the modulator
	}

	static mono(shape, waveShaping = false) {
		let bias;
		if (!waveShaping) {
			bias = 0;
		} else if (shape === 'sine' || shape === 'cosine') {
			bias = -2 / Math.PI;
		} else {
			bias = -0.5;	// Triangle or sawtooth
		}
		return new OscillatorConfig(shape, waveShaping, bias);
	}

	static am(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult = 1, oscillator1FrequencyMult = 1, modDepth = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, modDepth, gain);
	}

	static ringMod(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult = 1, oscillator1FrequencyMult = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, 2, gain);
	}

	// Adds together two oscillators
	static additive2(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult = 1, oscillator1FrequencyMult = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, 0, 0.5 * gain, true);
	}

	// Adds together sine waves
	static additiveSin(sines, waveShaping = false, bias = 0, oscillator2FrequencyMult = undefined, oscillator1FrequencyMult = 1) {
		let config;
		if (oscillator2FrequencyMult === undefined) {
			config = new OscillatorConfig('custom', waveShaping, bias);
		} else {
			config = new OscillatorConfig('custom', waveShaping, bias, 'square', oscillator2FrequencyMult, oscillator1FrequencyMult);
		}
		config.sines = Float32Array.from([0].concat(sines));
		config.cosines = new Float32Array(sines.length + 1);
		return config;
	}

	// Adds together cosine waves
	static additiveCos(cosines, waveShaping = false, bias = 0, oscillator2FrequencyMult = undefined, oscillator1FrequencyMult = 1) {
		let config;
		if (oscillator2FrequencyMult === undefined) {
			config = new OscillatorConfig('custom', waveShaping, bias);
		} else {
			config = new OscillatorConfig('custom', waveShaping, bias, 'square', oscillator2FrequencyMult, oscillator1FrequencyMult);
		}
		config.sines = new Float32Array(cosines.length + 1);
		config.cosines = Float32Array.from([0].concat(cosines));
		return config;
	}

	// Adds together a mixture of sine waves and cosine waves
	static additive(sines, cosines, waveShaping = false, bias = 0, oscillator2FrequencyMult = undefined, oscillator1FrequencyMult = 1) {
		let config;
		if (oscillator2FrequencyMult === undefined) {
			config = new OscillatorConfig('custom', waveShaping, bias);
		} else {
			config = new OscillatorConfig('custom', waveShaping, bias, 'square', oscillator2FrequencyMult, oscillator1FrequencyMult);
		}
		config.sines = Float32Array.from([0].concat(sines));
		config.cosines = Float32Array.from([0].concat(cosines));
		return config;
	}

}

const W2_COEFFICIENTS = [1, 0, -0.19, 0, 0.03, 0, -0.01];
const COW2_COEFFICIENTS = [1, 0, -0.19 * 3, 0, 0.03 * 5, 0, -0.01 * 7];
const W2_OFFSET = -1.8824761903362 / Math.PI;

const Waveform = {
	// Waveforms are listed in pairs, one waveform followed by its derivative, where available.

	SINE: 			OscillatorConfig.mono('sine'),
	COSINE:			OscillatorConfig.mono('cosine'),

	HALF_SINE:		OscillatorConfig.am('sine', false, -0.85 / Math.PI, 'square'),
	HALF_COSINE:	OscillatorConfig.am('cosine', false, 0, 'square'),

	ABS_SINE:		OscillatorConfig.mono('sine', true),
	CO_ABS_SINE:	OscillatorConfig.ringMod('cosine', false, 0, 'square'),

	QUARTER_SINE:	OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 2),
	QUARTER_COSINE: OscillatorConfig.am('cosine', true, -1 / Math.PI, 'square', 2),

	ODD_SINE:		OscillatorConfig.am('sine', false, 0, 'square', 1, 2),
	ODD_COSINE:		OscillatorConfig.am('cosine', false, 0, 'square', 1, 2),

	TRIANGLE:		OscillatorConfig.mono('triangle'),
	SQUARE90:		OscillatorConfig.ringMod('square', false, 0, 'square', 1, 2),

	ABS_ODD_SINE:	OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 1, 2),
	SQUARE:			OscillatorConfig.mono('square'),
	PULSE:			new OscillatorConfig('square', false, -0.5, 'square', 1, 2, 1, 2/3, true),	// 25% duty cycle
	SAWTOOTH:		OscillatorConfig.mono('sawtooth'),

	// From the Yamaha DX11 and TX81Z (OP Z)
	W2:				OscillatorConfig.additiveSin(W2_COEFFICIENTS),
	COW2:				OscillatorConfig.additiveCos(COW2_COEFFICIENTS),
	HALF_W2:			OscillatorConfig.additiveSin(W2_COEFFICIENTS, false, W2_OFFSET, 1),	// W4
	HALF_COW2:		OscillatorConfig.additiveCos(COW2_COEFFICIENTS, false, 0, 1),
	ODD_W2:			OscillatorConfig.additiveSin(W2_COEFFICIENTS, false, 0, 1, 2),	// W6
	ODD_COW2:		OscillatorConfig.additiveCos(COW2_COEFFICIENTS, false, 0, 1, 2),
	ABS_ODD_W2:		OscillatorConfig.additiveSin(W2_COEFFICIENTS, true, W2_OFFSET, 1, 2),	// W8

	// From Yamaha chips used in early 2000s mobile phones, e.g. YMU762 (MA-3)
	HALF_TRIANGLE:	OscillatorConfig.am('triangle', false, -0.25, 'square'),
	QUARTER_TRIANGLE:	OscillatorConfig.am('triangle', true, -0.25, 'square', 2),
	ODD_TRIANGLE:	OscillatorConfig.am('triangle', false, 0, 'square', 1, 2),
	ABS_ODD_TRI:	OscillatorConfig.am('triangle', true, -0.25, 'square', 1, 2),
	HALF_SAWTOOTH:	OscillatorConfig.am('sawtooth', false, -0.25, 'square'),
	ODD_SAWTOOTH:	OscillatorConfig.am('sawtooth', false, 0, 'square', 1, 2),

	// From the Yamaha SY77, SY99 and TG77
	SINE_SQUARED:	OscillatorConfig.ringMod('sine', true, 0, 'sine'),
	ALTERNATING_SINE:	OscillatorConfig.ringMod('sine', true, 0, 'square', 1, 2), // d/dx(|sin(x)| * sin(x))

	// Additive
	TRIANGLE12:		OscillatorConfig.additive2('triangle', false, 0, 'triangle', 2, 1, 4/3),
	SQUARE12:		OscillatorConfig.additive2('square', false, 0, 'square', 2),
	SAW12:			OscillatorConfig.additive2('sawtooth', false, 0, 'sawtooth', 2, 1, 4/3),

	SINE12345:		OscillatorConfig.additiveSin([1, -1/2, 1/3, -1/4, 1/5]),
	COSINE12345:	OscillatorConfig.additiveCos([1, -1, 1, -1, 1]),

	SINE12:			OscillatorConfig.additiveSin([1, 1]),
	COSINE12:		OscillatorConfig.additiveCos([1, 2]),

	SINE13:			OscillatorConfig.additiveSin([1, 0, 1]),
	COSINE13:		OscillatorConfig.additiveCos([1, 0, 3]),

	SINE14:			OscillatorConfig.additiveSin([1, 0, 0, 1]),
	COSINE14:		OscillatorConfig.additiveCos([1, 0, 0, 4]),

	SINE15:			OscillatorConfig.additiveSin([1, 0, 0, 0, 1]),
	COSINE15:		OscillatorConfig.additiveCos([1, 0, 0, 0, 5]),

	SINE16:			OscillatorConfig.additiveSin([1, 0, 0, 0, 0, 1]),
	COSINE16:		OscillatorConfig.additiveCos([1, 0, 0, 0, 0, 6]),

	SINE17:			OscillatorConfig.additiveSin([1, 0, 0, 0, 0, 0, 1]),
	COSINE17:		OscillatorConfig.additiveCos([1, 0, 0, 0, 0, 0, 7]),

	SINE18:			OscillatorConfig.additiveSin([1, 0, 0, 0, 0, 0, 0, 1]),
	COSINE18:		OscillatorConfig.additiveCos([1, 0, 0, 0, 0, 0, 0, 8]),

}

Waveform[0] = Waveform.SINE;
Waveform[1] = Waveform.HALF_SINE;
Waveform[2] = Waveform.ABS_SINE;
Waveform[3] = Waveform.QUARTER_SINE;
Waveform[4] = Waveform.ODD_SINE;
Waveform[5] = Waveform.ABS_ODD_SINE;
Waveform[6] = Waveform.SQUARE;
Waveform[7] = Waveform.SAWTOOTH;

export {OscillatorConfig, Waveform};
