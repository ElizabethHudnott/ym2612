class OscillatorConfig {
	/**
	 * @param {string} oscillator1Shape The waveform used for the carrier oscillator:
	 * 'sine', 'sawtooth', square' or 'triangle'.
	 * @param {boolean} waveShaping Inverts the negative portion of the carrier oscillator's
	 * waveform when true.
	 * @param {number} bias The amount of DC offset to add.
	 * @param {string} oscillator2Shape The waveform used for the modulator oscillator:
	 * 'sine', 'sawtooth', square', 'triangle' or undefined (no modulation).
	 * @param {number} oscillator2FrequencyMult The frequency of the modulator relative to the base
	 * frequency.
	 * @param {number} oscillator1FrequencyMult The frequency of the carrier relative to the base
	 * frequency, which is usually 1x but a few waveforms use 2x. If this parameter has a value
	 * other than 1 then the value of oscillator2FrequencyMult must be 1 (or 0).
	 * @param {number} modDepth How much amplitude modulation to apply [0..1].
	 * @param {boolean} ringMod Performs ring modulation if true, or amplitude modulation if false.
	 * @param {number} gain Scales the resulting wave by a constant.
	 * @param {boolean} additive Adds the modulator signal to the carrier before performing modulating.
	 */
	constructor(
		oscillator1Shape, waveShaping = false, bias = 0,
		oscillator2Shape = undefined, oscillator2FrequencyMult = 0, oscillator1FrequencyMult = 1,
		modDepth = 1, ringMod = false, gain = 1, additive = false
	) {
		this.oscillator1Shape = oscillator1Shape;
		this.waveShaping = waveShaping;
		this.bias = bias;
		this.oscillator2Shape = oscillator2Shape;
		this.oscillator2FrequencyMult = oscillator2FrequencyMult;
		this.modDepth = (ringMod ? 1 : 0.5) * modDepth;
		this.oscillator1FrequencyMult = oscillator1FrequencyMult;
		this.frequencyMultiplier = oscillator1FrequencyMult !== 1 ? oscillator1FrequencyMult : oscillator2FrequencyMult;
		this.gain = gain;
		this.additive = additive;
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
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, modDepth = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, modDepth, false, gain);
	}

	static ringMod(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, modDepth = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, modDepth, true, gain);
	}

	static additive(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, 0, false, 0.5 * gain, true);
	}

}

const root = x => 2 * Math.atan(Math.sqrt(x));
const organGain = (harmonic, x) => 2 / (Math.sin(x) + Math.sin(harmonic * x));


const Waveform = {
	// Waveforms are listed in pairs, one waveform followed by its derivative, where available.

	SINE: 			OscillatorConfig.mono('sine'),
	COSINE:			OscillatorConfig.mono('cosine'),

	HALF_SINE:		OscillatorConfig.am('sine', false, -0.85 / Math.PI, 'square', 1),
	HALF_COSINE:	OscillatorConfig.am('cosine', false, 0, 'square', 1),

	ABS_SINE:		OscillatorConfig.mono('sine', true),
	CO_ABS_SINE:	OscillatorConfig.ringMod('cosine', false, 0, 'square', 1),

	QUARTER_SINE:	OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 2),
	QUARTER_COSINE: OscillatorConfig.am('cosine', true, -1 / Math.PI, 'square', 2),

	ODD_SINE:		OscillatorConfig.am('sine', false, 0, 'square', 1, 2),
	ODD_COSINE:		OscillatorConfig.am('cosine', false, 0, 'square', 1, 2),

	TRIANGLE:		OscillatorConfig.mono('triangle'),
	SQUARE90:		OscillatorConfig.ringMod('square', false, 0, 'square', 1),

	ABS_ODD_SINE:	OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 1, 2),
	SQUARE:			OscillatorConfig.mono('square'),
	SAWTOOTH:		OscillatorConfig.mono('sawtooth'),
	PULSE:			new OscillatorConfig('square', false, -0.5, 'square', 1, 2, 1, false, 2/3, true),	// 25% duty cycle

	// From Yamaha chips used in early 2000s mobile phones
	HALF_TRIANGLE:	OscillatorConfig.am('triangle', false, -0.25, 'square', 1),
	QUARTER_TRIANGLE:	OscillatorConfig.am('triangle', true, -0.25, 'square', 2),
	ODD_TRIANGLE:	OscillatorConfig.am('triangle', false, 0, 'square', 1, 2),
	ABS_ODD_TRI:	OscillatorConfig.am('triangle', true, -0.25, 'square', 1, 2),
	HALF_SAWTOOTH:	OscillatorConfig.am('sawtooth', false, -0.25, 'square', 1),
	ODD_SAWTOOTH:	OscillatorConfig.am('sawtooth', false, 0, 'square', 1, 2),

	// From the Yamaha SY77, SY99 and TG77
	SINE_SQUARED:	OscillatorConfig.ringMod('sine', true, 0, 'sine', 1),
	ALTERNATING_SINE:	OscillatorConfig.ringMod('sine', true, 0, 'square', 1, 2),
	/* Sort of the derivative of ALTERNATING_SINE. The initial phase is 90 degrees off. Use
		COSINE instead of SINE as the carrier (or SQUARE90 instead of SQUARE) to compensate. */
	ALTERNATING_COSINE: OscillatorConfig.ringMod('cosine', false, 0, 'square', 1, 2),

	// Additive
	TRIANGLE12:		OscillatorConfig.additive('triangle', false, 0, 'triangle', 2, 1, 4/3),
	SQUARE12:		OscillatorConfig.additive('square', false, 0, 'square', 2),
	SAW12:			OscillatorConfig.additive('sawtooth', false, 0, 'sawtooth', 2, 1, 4/3),
	SINE1234:		new OscillatorConfig('sine', false, -0.25, 'sine', 2, 1, 1, false, 2/3, true),
	COSINE1234:		new OscillatorConfig(
							'cosine', false, -0.25, 'cosine', 2, 1, 1, false, 2/3, true
						),
	SINE12:			OscillatorConfig.additive('sine', false, 0, 'sine', 2, 1,
							organGain(2, root(6 - Math.sqrt(33)))
						),
	COSINE12:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 2, 1,
							organGain(2, root(6 - Math.sqrt(33)))
						),
	SINE13:			OscillatorConfig.additive('sine', false, 0, 'sine', 3, 1,
							organGain(3, root(5 - 2 * Math.sqrt(6)))
						),
	COSINE13:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 3, 1,
							organGain(3, root(5 - 2 * Math.sqrt(6)))
						),
	SINE14:			OscillatorConfig.additive('sine', false, 0, 'sine', 4, 1,
							organGain(4, 2 * 0.97043)
						),
	COSINE14:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 4, 1,
							organGain(4, 2 * 0.97043)
						),
	SINE15:			OscillatorConfig.additive('sine', false, 0, 'sine', 5, 1,
							organGain(5, Math.PI / 2)
						),
	COSINE15:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 5, 1,
							organGain(5, Math.PI / 2)
						),
	SINE16:			OscillatorConfig.additive('sine', false, 0, 'sine', 6, 1,
							organGain(6, root(0.597383))
						),
	COSINE16:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 6, 1,
							organGain(6, root(0.597383))
						),
	SINE17:			OscillatorConfig.additive('sine', false, 0, 'sine', 7, 1,
							organGain(7, root(0.402496))
						),
	COSINE17:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 7, 1,
							organGain(7, root(0.402496))
						),
	SINE18:			OscillatorConfig.additive('sine', false, 0, 'sine', 8, 1,
							organGain(8, root(1.47569))
						),
	COSINE18:		OscillatorConfig.additive('cosine', false, 0, 'cosine', 8, 1,
							organGain(8, root(1.47569))
						),
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
