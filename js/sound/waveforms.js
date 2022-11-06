/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
import {logToLinear, gcd} from './common.js';

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

	clone() {
		return new SimpleOscillatorFactory(this.shape, this.waveShaping, this.bias);
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

	clone() {
		const factory = new PeriodicOscillatorFactory(this.sines, this.cosines, this.waveShaping, this.bias);
		factory.periodicWave = this.periodicWave;
		return factory;
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

	clone() {
		return new DualOscillatorFactory(
			this.oscillator1Factory.clone(), this.oscillator2Shape, this.frequencyMultiple,
			this.isOneToN, this.frequencyOffset, this.modDepth * 2, this.gain, this.additive
		);
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


class TimbreFrame {

	constructor() {
		this.holdTime = 1;
		this.fadeTime = 0;
		this.linearFade = true;
		this.amplitude = 1023;
		this.pitchRatio = 1;
	}

	clone() {
		const constructor = this.constructor;
		const frame = new constructor();
		frame.holdTime = this.holdTime;
		frame.fadeTime = this.fadeTime;
		frame.linearFade = this.linearFade;
		frame.amplitude = this.amplitude;
		frame.pitchRatio = this.pitchRatio;
		return frame;
	}

	calculate() {
		// Override as necessary in the subclasses
	}

	effectivePitchRatio() {
		return this.pitchRatio;
	}

}

class OscillatorTimbreFrame extends TimbreFrame {

	constructor() {
		super();
		this.type = 'triangle';
	}

	clone() {
		const frame = super.clone();
		frame.type = this.type;
		return frame;
	}

	createSource(context, frequency) {
		return new OscillatorNode(context, {frequency: frequency, type: this.type});
	}

}

class HarmonicTimbreFrame extends TimbreFrame {

	constructor() {
		super();
		this.magnitudes = [];
		this.phases = [];	// Between 0 and 1
		this.sines = new Float32Array([0, 0]);
		this.cosines = new Float32Array([0, 0]);
	}

	clone() {
		const frame = super.clone();
		frame.magnitudes = this.magnitudes;
		frame.phases = this.phases;
		frame.sines = this.sines;
		frame.cosines = this.cosines;
		return frame;
	}

	calculate() {
		const magnitudes = this.magnitudes;
		const phases = this.phases;
		const numHarmonics = magnitudes.length;
		const sines = new Float32Array(numHarmonics + 1);
		const cosines = new Float32Array(numHarmonics + 1);
		for (let i = 0; i < numHarmonics; i++) {
			const magnitude = magnitudes[i] || 0;
			const phase = ((phases[i] || 0) + 0.25) * (2 * Math.PI);
			sines[i + 1] = magnitude * Math.sin(phase);
			cosines[i + 1] = magnitude * Math.cos(phase);
		}
		this.sines = sines;
		this.cosines = cosines;
	}

	effectivePitchRatio() {
		const harmonics = [];
		for (let i = 0; i < this.magnitudes.length; i++) {
			if (this.magnitudes[i] !== 0) {
				harmonics.push(i + 1);
			}
		}
		switch (harmonics.length) {
		case 0: return 0;
		case 1: return harmonics[0] * this.pitchRatio;
		default:
			let multiple = gcd(harmonics[0], harmonics[1]);
			for (let i = 2; i < harmonics.length; i++) {
				multiple = gcd(multiple, harmonics[i]);
			}
			return multiple * this.pitchRatio;
		}
	}

	createSource(context, frequency) {
		const wave = new PeriodicWave(context, {real: this.cosines, imag: this.sines});
		return new OscillatorNode(context, {frequency: frequency, periodicWave: wave});
	}

}

class SampleOscillatorFactory {

	constructor(keyOn) {
		this.keyOn = keyOn;
		this.keyOff = undefined;
	}

	newOscillators(context, operator, time) {
		const definition = this.keyOn;
		const source = new AudioBufferSourceNode(audioContext, {
			buffer: definition.buffer, playbackRate: 0, loop: definition.loop,
			loopStart: definition.loopStartTime, loopEnd: Number.MAX_VALUE
		});
		const rateMultiplier = new GainNode(context, {gain: 1 / definition.recordedPitch});
		operator.frequencyNode.connect(rateMultiplier);
		rateMultiplier.connect(source.playbackRate);
		source.connect(operator.amMod);
		operator.bias.setValueAtTime(0, time);
		operator.amMod.gain.setValueAtTime(1, time);
		source.start(time);
		return [source];
	}

}

class SampleSource {

	constructor() {
		this.buffer = undefined;
		this.recordedPitch = 440 * 2 ** (-9 / 12);	// C4
		this.loop = false;
		this.loopStartTime = 0;
	}

}

class TimbreFrameOscillatorFactory extends SampleOscillatorFactory {
	constructor() {
		super(new TimbreFrameOscillator());
	}
}

class TimbreFrameOscillator extends SampleSource {

	constructor() {
		super();
		this.frames = [new HarmonicTimbreFrame()];
		this.timeScaling = 1;	// Speeds up or slows down all frames
		this.loop = true;
		this.loopStartFrame = 0;
		this.bitDepth = 25;
	}

	clone() {
		const oscillator = new TimbreFrameOscillator();
		oscillator.frames = this.frames.map(frame => frame.clone());
		oscillator.timeScaling = this.timeScaling;
		oscillator.loopStartFrame = this.loopStartFrame;
		oscillator.bitDepth = this.bitDepth;
		oscillator.buffer = this.buffer;
		oscillator.loopStartTime = this.loopStartTime;
		return oscillator;
	}

	/**Depends on the channel's tuning
	 */
	async createSample(realtimeAudioContext, channel, recordingNote = 60) {
		const sampleRate = realtimeAudioContext.sampleRate;
		const recordingPitch = channel.notePitch(recordingNote);
		this.recordedPitch = recordingPitch;
		const timeMultiple = channel.notePitch(60) / recordingPitch * this.timeScaling;
		const notePeriod = 1 / recordingPitch;
		const minAmplitude = logToLinear(1);

		const frames = this.frames.slice();;
		let numFrames = frames.length;
		let loopStartFrame = this.loopStartFrame;
		if (!this.loop) {
			const silentFrame = new HarmonicTimbreFrame();
			silentFrame.holdTime = 0;
			frames.push(silentFrame);
			numFrames++;
			loopStartFrame = numFrames - 1;
		} else if (loopStartFrame === numFrames - 1) {
			const frame = frames[numFrames - 1].clone();
			frames[numFrames - 1] = frame;
			const pitchRatio = Math.abs(frame.effectivePitchRatio());
			if (pitchRatio === 0) {
				frame.holdTime = (2 / sampleRate) / timeMultiple;
			} else {
				// Need a decent length of audio otherwise rounding errors cause detuning / phasing
				// issues when the waveform is used as an FM modulator.
				frame.holdTime = 0.4 / timeMultiple;
			}
		} else {
			// Make the beginning and end of the loop seamless.
			const loopTransition = frames[loopStartFrame].clone();
			loopTransition.holdTime = 0;
			frames.push(loopTransition);
			numFrames++;
		}

		// Round the timings to align with full numbers of cycles.
		const holdTimes = new Array(numFrames);
		let loopOffset = 0;
		for (let i = 0; i < numFrames; i++) {
			const frame = frames[i];
			const pitchRatio = Math.abs(frame.effectivePitchRatio());
			const fadeIn = i === 0 ? 0 : frames[i - 1].fadeTime * timeMultiple;
			let duration = fadeIn + frame.holdTime * timeMultiple;

			if (pitchRatio > 0) {	// i.e. the frame isn't silent.
				const period = notePeriod / pitchRatio;
				const isLastFrame = i === numFrames - 1;
				const nextFrameNum = isLastFrame ? loopStartFrame : i + 1;
				const nextFrame = frames[nextFrameNum];
				const nextPitchRatio = Math.abs(nextFrame.effectivePitchRatio());

				if (nextPitchRatio > 0 || frame.fadeTime === 0) {
					/* When the next oscillator starts fading in (after this one has been faded in
					 * and held) then we need to have completed a whole number of cycles OR for
					 * example we can be halfway through a cycle if the frequency ratio is 3:2. Thus
					 * if the two frames have harmonics in common with the same phases specified
					 * then the waves will stay phase aligned.
					 */
					let subperiod = period;
					if (pitchRatio > nextPitchRatio && nextPitchRatio > 0 &&	!isLastFrame) {
						// E.g. (3 / 2) % 1 = 0.5
						const modulus = (pitchRatio / nextPitchRatio) % 1;
						if (modulus > 0) {
							subperiod *= modulus;
						}
					}
					duration = Math.round((fadeIn + frame.holdTime * timeMultiple) / subperiod) * subperiod;
					if (duration < fadeIn || duration === 0) {
						duration += period;
					}
					if (isLastFrame) {
						duration += loopOffset;
					}
				}

				if (i === loopStartFrame) {
					loopOffset = fadeIn % period;
				}
			}
			holdTimes[i] = duration - fadeIn;
		}

		// Calculate when each frame has faded in and what the total sample length is.
		const fadedInTimes = new Array(numFrames);
		fadedInTimes[0] = 0;
		let totalDuration = 0;
		for (let i = 0; i < numFrames - 1; i++) {
			totalDuration += holdTimes[i] + frames[i].fadeTime * timeMultiple;
			fadedInTimes[i + 1] = totalDuration;
		}
		totalDuration += holdTimes[numFrames - 1];
		this.loopStartTime = fadedInTimes[loopStartFrame];

		// Render the audio to a sample.
		const length = Math.round(totalDuration * sampleRate);
		const context = new OfflineAudioContext(1, length, sampleRate);

		for (let i = 0; i < numFrames; i++) {
			const frame = frames[i];
			const source = frame.createSource(context, recordingPitch * frame.pitchRatio);
			const amplifier = new GainNode(context);
			source.connect(amplifier);
			amplifier.connect(context.destination);
			const gain = amplifier.gain;

			const amplitude = logToLinear(frame.amplitude);
			const timeConstants = Math.log(amplitude / minAmplitude);
			const fadeInDuration = i === 0 ? 0 : frames[i - 1].fadeTime * timeMultiple;

			const startTime = fadedInTimes[i] - fadeInDuration;
			source.start(startTime);
			if (fadeInDuration === 0) {
				gain.setValueAtTime(amplitude, startTime);
			} else {
				gain.setValueAtTime(0, startTime);
				if (frames[i - 1].linearFade || timeConstants <= 0) {
					gain.linearRampToValueAtTime(amplitude, fadedInTimes[i]);
				} else {
					gain.setTargetAtTime(amplitude, startTime, fadeInDuration / timeConstants);
				}
			}

			if (i < numFrames - 1) {
				const fadeOutDuration = frame.fadeTime * timeMultiple;
				if (fadeOutDuration > 0) {
					const endHold = fadedInTimes[i] + holdTimes[i];
					if (frame.linearFade || timeConstants <= 0) {
						gain.setValueAtTime(amplitude, endHold);
						gain.linearRampToValueAtTime(0, fadedInTimes[i + 1]);
					} else {
						gain.setTargetAtTime(0, endHold, fadeOutDuration / timeConstants);
					}
				}
				source.stop(fadedInTimes[i + 1]);
			}
		} // End for each timbre frame

		const buffer = await context.startRendering();

		// Apply bitcrusher effect
		const wave = buffer.getChannelData(0);
		const steps = 2 ** (this.bitDepth - 1);
		for (let i = 0; i < length; i++) {
			wave[i] = Math.round(wave[i] * steps) / steps;
		}

		this.buffer = buffer;
	}

}

function weighHarmonic(n, bias) {
	let weight = n - bias;
	if (weight <= 0) {
		weight = 2 - weight;
	}
	return weight;
}

function weighFundamental(boost) {
	if (boost >= 0) {
		return boost + 1;
	} else {
		return 1 / (1 - boost);
	}
}

const OscillatorFactory = {

	mono: function (shape, waveShaping = false) {
		/*The offset needed is calculated for a sine or cosine wave. There's no point in shaping
		  the other basic shapes. Inverting the negative portion of a square wave produces a
		  flat line, triangle transforms into itself, and sawtooth transforms into triangle. */
		const bias = waveShaping * -2 / Math.PI ;
		return singleOscillatorFactory(shape, waveShaping, bias);
	},

	/**
	 * @param {Object} oscillator1Factory
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

	additive: function (magnitudes, phases) {
		const numHarmonics = magnitudes.length;
		const sines = new Float32Array(numHarmonics + 1);
		const cosines = new Float32Array(numHarmonics + 1);
		for (let i = 0; i < numHarmonics; i++) {
			const magnitude = magnitudes[i] || 0;
			const phase = ((phases[i] || 0) + 0.25) * (2 * Math.PI);
			sines[i + 1] = magnitude * Math.sin(phase);
			cosines[i + 1] = magnitude * Math.cos(phase);
		}
		return new PeriodicOscillatorFactory(sines, cosines);
	},

	// Waveforms from FS1R and FM-X, although the same concept exists in Ableton but by a
	// different name. E.g. Ableton's "Saw 6" = all1(5).

	/**First N overtones of a sawtooth wave. The fundamental is also included as well as the N
	 * overtones.
	 * Ableton has presets for 2, 3, 5, 7, 15, 31 & 63.
	 * Korg opsix has a preset for 4.
	 */
	all1: function (skirt, curve = 1, bias = 0, boost = 0) {
		const length = skirt + 2;
		const coefficients = new Float32Array(length);
		coefficients[1] = -(weighFundamental(boost) ** curve);
		let sign = 1;
		// E.g. skirt = 1 means the 1st and 2nd harmonics are present, array indices 0..2, length 3
		for (let i = 2; i <= skirt + 1; i++) {
			coefficients[i] = sign / (weighHarmonic(i, bias) ** curve);
			sign *= -1;
		}
		return new PeriodicOscillatorFactory(coefficients, new Float32Array(length));
	},

	coAll1: function (skirt, curve = 1, bias = 0, boost = 0) {
		const length = skirt + 2;
		const coefficients = new Float32Array(length);
		coefficients[1] = -(weighFundamental(boost) ** curve);
		let sign = 1;
		for (let i = 2; i <= skirt + 1; i++) {
			coefficients[i] = sign * i /  (weighHarmonic(i, bias) ** curve);
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
		// E.g. skirt = 1 means the 1st and 3rd are harmonics present, array indices 0..3, length 4
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

	timbreFrames: function() {
		return new TimbreFrameOscillatorFactory();
	}

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

	// From the Yamaha DX11 and TX81Z (OPZ)
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
	OscillatorFactory, PeriodicOscillatorFactory, singleOscillatorFactory, Waveform,
	OscillatorTimbreFrame, HarmonicTimbreFrame
};
