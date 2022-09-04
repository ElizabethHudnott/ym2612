/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
class AbstractOscillatorFactory {

	constructor(waveShaping, bias) {
		this.waveShaping = waveShaping;
		this.bias = bias;
	}

	newOscillators(context, operator, time) {
		const oscillator = this.createOscillator(context, 0);
		operator.frequencyNode.connect(oscillator.frequency);
		oscillator.connect(this.waveShaping ? operator.shaper : operator.amMod);
		operator.bias.setValueAtTime(this.bias, time);
		operator.amMod.gain.setValueAtTime(1, time);
		oscillator.start(time);
		return [oscillator];
	}

}

class SimpleOscillatorFactory extends AbstractOscillatorFactory {

	constructor(shape, waveShaping, bias) {
		super(waveShaping, bias);
		this.shape = shape;
	}

	createOscillator(context, frequencyOffset) {
		return new OscillatorNode(context, {frequency: frequencyOffset, type: this.shape});
	}

}

class PeriodicOscillatorFactory extends AbstractOscillatorFactory {

	constructor(sines, cosines, waveShaping = false, bias = 0) {
		super(waveShaping, bias);
		this.sines = sines;
		this.cosines = cosines;
		this.periodicWave = undefined;
	}

	createOscillator(context, frequencyOffset) {
		if (this.periodicWave === undefined) {
			this.periodicWave = new PeriodicWave(context, {real: this.cosines, imag: this.sines});
		}
		return new OscillatorNode(
			context, {frequency: frequencyOffset, periodicWave: this.periodicWave}
		);
	}

}

class DualOscillatorFactory {

	constructor(
		oscillator1Factory, oscillator2Shape, frequencyMultiple = 1, isOneToN = false,
		frequencyOffset = 0, modDepth = 1, gain = 1, additive = false
	) {
		this.oscillator1Factory = oscillator1Factory;
		this.oscillator2Shape = oscillator2Shape;
		this.additive = additive;
		this.modDepth = 0.5 * modDepth;
		this.gain = gain;
		this.frequencyMultiple = frequencyMultiple;
		this.isOneToN = isOneToN;
		this.frequencyOffset = frequencyOffset;
	}

	newOscillators(context, operator, time) {
		const frequencyNode = operator.frequencyNode;
		const frequencyMultipleNode = operator.frequencyMultiplier;
		const frequencyMultipleParam = frequencyMultipleNode.gain;
		const shaper = operator.shaper;
		const amMod = operator.amMod;
		const amModAmp = operator.amModAmp;
		const biasParam = operator.bias;
		const gain = this.gain;
		const amplitude = this.modDepth; // Amplitude of the modulator, before gain
		let oscillator1, oscillator2;

		if (this.isOneToN) {
			oscillator1 = this.oscillator1Factory.createOscillator(context, 0);
			oscillator2 = new OscillatorNode(
				context, {frequency: this.frequencyOffset, type: this.oscillator2Shape}
			);
			frequencyNode.connect(oscillator1.frequency);
			frequencyMultipleNode.connect(oscillator2.frequency);
		} else {
			// N:1 frequency ratio
			oscillator1 = this.oscillator1Factory.createOscillator(context, this.frequencyOffset);
			oscillator2 = new OscillatorNode(context, {frequency: 0, type: this.oscillator2Shape});
			frequencyMultipleNode.connect(oscillator1.frequency);
			frequencyNode.connect(oscillator2.frequency);
		}

		oscillator1.connect(this.oscillator1Factory.waveShaping ? shaper : amMod);
		frequencyMultipleParam.setValueAtTime(this.frequencyMultiple, time);
		biasParam.setValueAtTime(this.oscillator1Factory.bias * gain, time);
		oscillator2.connect(amModAmp);
		if (this.additive) {
			oscillator2.connect(amMod);
		}
		amModAmp.gain.setValueAtTime(gain * amplitude, time);
		amMod.gain.setValueAtTime(gain * (1 - Math.abs(amplitude)), time);

		oscillator1.start(time);
		oscillator2.start(time);
		return [oscillator1, oscillator2];
	}

}

function singleOscillatorFactory(shape, waveShaping, bias) {
	if (shape === 'cosine') {
		return new PeriodicOscillatorFactory(
			Float32Array.from([0, 0]), Float32Array.from([0, 1]), waveShaping, bias
		);
	} else {
		return new SimpleOscillatorFactory(shape, waveShaping, bias);
	}
}


const OscillatorFactory = {

	mono: function (shape, waveShaping = false) {
		let bias;
		if (!waveShaping) {
			bias = 0;
		} else if (shape === 'sine' || shape === 'cosine') {
			bias = -2 / Math.PI;
		} else {
			bias = -0.5;	// Triangle or sawtooth
		}
		return singleOscillatorFactory(shape, waveShaping, bias);
	},

	/**
	 * @param {Object} oscillator1Factory E.g. obtained via singleOscillatorFactory()
	 * @param {string} oscillator2Shape The waveform used for the modulator oscillator:
	 * 'sine', 'sawtooth', square' or 'triangle'.
	 * @param {number} frequencyMultiple The frequency of one oscillator relative to the other.
	 * @param {boolean} isOneToN If true then the frequency relationship between Oscillator 1
	 * and Oscillator 2 is 1:frequencyMultiple, otherwise it's frequencyMultiple:1.
	 * @param {number} modDepth How much amplitude modulation to apply [-2..2]. The values 2 and
	 * -2 result in ring modulation rather than AM.
	 * @param {number} gain Scales the resulting wave by a constant.
	 * @param {boolean} additive Adds the modulator signal to the carrier before performing
	 * modulation.
	 */
	dual: function (
		oscillator1Factory, oscillator2Shape, frequencyMultiple = 1, isOneToN = false,
		frequencyOffset = 0, modDepth = 1, gain = 1, additive = false
	) {
		return new DualOscillatorFactory(
			oscillator1Factory, oscillator2Shape, frequencyMultiple, isOneToN, frequencyOffset,
			modDepth, gain, additive
		)
	},

	am: function (
		oscillator1Shape, waveShaping, bias, oscillator2Shape, frequencyMultiple = 1,
		isOneToN = false
	) {
		const oscillator1Factory = singleOscillatorFactory(oscillator1Shape, waveShaping, bias);
		return new DualOscillatorFactory(
			oscillator1Factory, oscillator2Shape, frequencyMultiple, isOneToN
		);
	},

	ringMod: function (
		oscillator1Shape, waveShaping, oscillator2Shape, frequencyMultiple = 1, isOneToN = false
	) {
		const oscillator1Factory = singleOscillatorFactory(oscillator1Shape, waveShaping, 0);
		return new DualOscillatorFactory(
			oscillator1Factory, oscillator2Shape, frequencyMultiple, isOneToN, 0, 2
		);
	},

	additive2: function (
		oscillator1Shape, waveShaping, bias, oscillator2Shape, frequencyMultiple = 1,
		isOneToN = false, gain = 1
	) {
		const oscillator1Factory = singleOscillatorFactory(oscillator1Shape, waveShaping, bias);
		return new DualOscillatorFactory(
			oscillator1Factory, oscillator2Shape, frequencyMultiple, isOneToN, 0, 0, 0.5 * gain, true
		);
	},

	additiveSin: function (sines, waveShaping = false, bias = 0, frequencyMultiple = undefined) {
		sines = Float32Array.from([0].concat(sines));
		const cosines = new Float32Array(sines.length);
		const oscillator1Factory = new PeriodicOscillatorFactory(sines, cosines, waveShaping, bias);
		if (frequencyMultiple === undefined) {
			return oscillator1Factory;
		} else {
			return new DualOscillatorFactory(oscillator1Factory, 'square', frequencyMultiple);
		}
	},

	additiveCos: function (cosines, waveShaping = false, bias = 0, frequencyMultiple = undefined) {
		cosines = Float32Array.from([0].concat(cosines));
		const sines = new Float32Array(cosines.length);
		const oscillator1Factory = new PeriodicOscillatorFactory(sines, cosines, waveShaping, bias);
		if (frequencyMultiple === undefined) {
			return oscillator1Factory;
		} else {
			return new DualOscillatorFactory(oscillator1Factory, 'square', frequencyMultiple);
		}
	},

	additive: function (cosines, waveShaping = false, bias = 0, frequencyMultiple = undefined) {
		sines = Float32Array.from([0].concat(sines));
		cosines = Float32Array.from([0].concat(cosines));
		const oscillator1Factory = new PeriodicOscillatorFactory(sines, cosines, waveShaping, bias);
		if (frequencyMultiple === undefined) {
			return oscillator1Factory;
		} else {
			return new DualOscillatorFactory(oscillator1Factory, 'square', frequencyMultiple);
		}
	},

	// Waveforms from FS1R and FM-X, although the same concept exists in Ableton but by a
	// different name. E.g. Ableton's "Saw 6" = all1(5).

	/**First N overtones of a sawtooth wave. The fundamental is also included as well as the N
	 * overtones.
	 * Ableton has presets for 2, 3, 5, 7, 15, 31 & 63.
	 * Korg opsix has a preset for 4.
	 */
	all1: function (skirt) {
		const length = skirt + 2;
		const coefficients = new Float32Array(length);
		coefficients[1] = 1;
		let sign = -1;
		// E.g. skirt = 1 => 1st and 2nd harmonics present, array indices 0..2, length 3
		for (let i = 2; i <= skirt + 1; i++) {
			coefficients[i] = sign / i;
			sign *= -1;
		}
		return new PeriodicOscillatorFactory(coefficients, new Float32Array(length));
	},

	coAll1: function (skirt) {
		const length = skirt + 2;
		const coefficients = new Float32Array(length);
		let sign = 1;
		for (let i = 1; i <= skirt + 1; i++) {
			coefficients[i] = sign;
			sign *= -1;
		}
		return new PeriodicOscillatorFactory(new Float32Array(length), coefficients);
	},

	/**First N overtones of a square wave. The fundamental is also included as well as the N
	 * overtones.
	 * Ableton has presets for 2, 3, 5, 7, 15, 31 & 63.
	 */
	odd1: function (skirt) {
		const length = 2 + 2 * skirt;
		const coefficients = new Float32Array(length);
		// E.g. skirt = 1 => 1st and 3rd harmonics present, array indices 0..3, length 4
		for (let i = 0; i <= skirt; i++) {
			coefficients[2 * i + 1] = 1 / (2 * i + 1);
		}
		return new PeriodicOscillatorFactory(coefficients, new Float32Array(length));
	},

	coOdd1: function (skirt) {
		const length = 2 + 2 * skirt;
		const coefficients = new Float32Array(length);
		for (let i = 0; i <= skirt; i++) {
			coefficients[2 * i + 1] = 1;
		}
		return new PeriodicOscillatorFactory(new Float32Array(length), coefficients);
	},

}

const W2_COEFFICIENTS = [1, 0, -0.19, 0, 0.03, 0, -0.01];
const COW2_COEFFICIENTS = [1, 0, -0.19 * 3, 0, 0.03 * 5, 0, -0.01 * 7];
const W2_OFFSET = -1.8824761903362 / Math.PI;

const Waveform = {
	// Waveforms are mostly listed in pairs of one waveform followed by its derivative, where available.

	SINE: 			OscillatorFactory.mono('sine'),
	COSINE:			OscillatorFactory.mono('cosine'),

	HALF_SINE:		OscillatorFactory.am('sine', false, -0.85 / Math.PI, 'square'),
	HALF_COSINE:	OscillatorFactory.am('cosine', false, 0, 'square'),

	ABS_SINE:		OscillatorFactory.mono('sine', true),
	CO_ABS_SINE:	OscillatorFactory.ringMod('cosine', false, 'square'),

	QUARTER_SINE:	OscillatorFactory.am('sine', true, -1 / Math.PI, 'square', 2, true),
	QUARTER_COSINE: OscillatorFactory.am('cosine', true, -1 / Math.PI, 'square', 2, true),

	ODD_SINE:		OscillatorFactory.am('sine', false, 0, 'square', 2),
	ODD_COSINE:		OscillatorFactory.am('cosine', false, 0, 'square', 2),

	TRIANGLE:		OscillatorFactory.mono('triangle'),
	SQUARE90:		OscillatorFactory.ringMod('square', false, 'square', 2),

	ABS_ODD_SINE:	OscillatorFactory.am('sine', true, -1 / Math.PI, 'square', 2),
	SQUARE:			OscillatorFactory.mono('square'),
	SPIKE: 			OscillatorFactory.am('sawtooth', false, 0, 'triangle', -2),	// approximate log saw
	PULSE:			OscillatorFactory.dual(	// 25% duty cycle
		singleOscillatorFactory('square', false, -0.5),
		'square', 2, false, 0, 1, 2/3, true
	),
	SAWTOOTH:		OscillatorFactory.mono('sawtooth'),

	// From the Yamaha DX11 and TX81Z (OP Z)
	W2:				OscillatorFactory.additiveSin(W2_COEFFICIENTS),
	COW2:				OscillatorFactory.additiveCos(COW2_COEFFICIENTS),

	HALF_W2:			OscillatorFactory.additiveSin(W2_COEFFICIENTS, false, W2_OFFSET, 1),	// W4
	HALF_COW2:		OscillatorFactory.additiveCos(COW2_COEFFICIENTS, false, 0, 1),

	ODD_W2:			OscillatorFactory.additiveSin(W2_COEFFICIENTS, false, 0, 2),	// W6
	ODD_COW2:		OscillatorFactory.additiveCos(COW2_COEFFICIENTS, false, 0, 2),

	ABS_ODD_W2:		OscillatorFactory.additiveSin(W2_COEFFICIENTS, true, W2_OFFSET, 2),	// W8

	// From Yamaha chips used in early 2000s mobile phones, e.g. YMU762 (MA-3)
	HALF_TRIANGLE:	OscillatorFactory.am('triangle', false, -0.25, 'square'),
	QUARTER_TRIANGLE:	OscillatorFactory.am('triangle', true, -0.25, 'square', 2, true),
	ODD_TRIANGLE:	OscillatorFactory.am('triangle', false, 0, 'square', 2),
	ABS_ODD_TRI:	OscillatorFactory.am('triangle', true, -0.25, 'square', 2),
	HALF_SAWTOOTH:	OscillatorFactory.am('sawtooth', false, -0.25, 'square'),
	ODD_SAWTOOTH:	OscillatorFactory.am('sawtooth', false, 0, 'square', 2),

	// From the Yamaha SY77, SY99 and TG77
	SINE_SQUARED:	OscillatorFactory.ringMod('sine', true, 'sine'),
	ALTERNATING_SINE:	OscillatorFactory.ringMod('sine', true, 'square', 2), // d/dx(|sin(x)| * sin(x))

	// Additive
	TRIANGLE12:		OscillatorFactory.additive2('triangle', false, 0, 'triangle', 2, false, 4/3),
	SQUARE12:		OscillatorFactory.additive2('square', false, 0, 'square', 2),
	SAW12:			OscillatorFactory.additive2('sawtooth', false, 0, 'sawtooth', 2, false, 4/3),

	SINE12345:		OscillatorFactory.all1(4),
	COSINE12345:	OscillatorFactory.coAll1(4),

	SINE12:			OscillatorFactory.additiveSin([1, 1]),
	COSINE12:		OscillatorFactory.additiveCos([1, 2]),

	SINE13:			OscillatorFactory.additiveSin([1, 0, 1]),
	COSINE13:		OscillatorFactory.additiveCos([1, 0, 3]),

	SINE14:			OscillatorFactory.additiveSin([1, 0, 0, 1]),
	COSINE14:		OscillatorFactory.additiveCos([1, 0, 0, 4]),

	SINE15:			OscillatorFactory.additiveSin([1, 0, 0, 0, 1]),
	COSINE15:		OscillatorFactory.additiveCos([1, 0, 0, 0, 5]),

	SINE16:			OscillatorFactory.additiveSin([1, 0, 0, 0, 0, 1]),
	COSINE16:		OscillatorFactory.additiveCos([1, 0, 0, 0, 0, 6]),

	SINE17:			OscillatorFactory.additiveSin([1, 0, 0, 0, 0, 0, 1]),
	COSINE17:		OscillatorFactory.additiveCos([1, 0, 0, 0, 0, 0, 7]),

	SINE18:			OscillatorFactory.additiveSin([1, 0, 0, 0, 0, 0, 0, 1]),
	COSINE18:		OscillatorFactory.additiveCos([1, 0, 0, 0, 0, 0, 0, 8]),

	// Miscellaneous
	STEP:				OscillatorFactory.am('square', false, 0, 'square', 2, true),

}

Waveform[0] = Waveform.SINE;
Waveform[1] = Waveform.HALF_SINE;
Waveform[2] = Waveform.ABS_SINE;
Waveform[3] = Waveform.QUARTER_SINE;
Waveform[4] = Waveform.ODD_SINE;
Waveform[5] = Waveform.ABS_ODD_SINE;
Waveform[6] = Waveform.SQUARE;
Waveform[7] = Waveform.LOG_SAW;
// Differentiated versions at n + 8
Waveform[8] = Waveform.COSINE;
Waveform[9] = Waveform.HALF_COSINE;
Waveform[10] = Waveform.CO_ABS_SINE;
Waveform[11] = Waveform.QUARTER_COSINE;
Waveform[12] = Waveform.ODD_COSINE;

export {
	OscillatorFactory, PeriodicOscillatorFactory, singleOscillatorFactory, Waveform
};
