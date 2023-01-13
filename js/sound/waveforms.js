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

/* Functions for quickly creating a bunch of magnitudes and phases of harmonics from a set of
 * macro parameters.
 */

function weighSides(n, centre, skew) {
	const side = Math.sign(centre - n);
	const biasedSide = Math.sign(skew);
	let weighting = 1;
	if (side === biasedSide) {
		weighting = Math.abs(skew);
	} else if (side === -biasedSide) {
		weighting = 1 / Math.abs(skew);
	}
	return weighting;
}

function weighHarmonic(n, curve, centre, skew) {
	let weight = n - (centre - 1);
	if (weight <= 0) {
		weight = 2 - weight;
	}
	return 1 / ((weight ** curve) * weighSides(n, centre, skew));
}

function weighHarmonic2(n, xRadiusSquared, minLevel, centre, skew) {
	const xDistance = n - centre;
	const square = 1 - xDistance * xDistance / xRadiusSquared;
	if (square <= 0) {
		return 0;
	}
	const level = 1023 * Math.sqrt(square);
	return logToLinear(level) * weighSides(n, centre, skew);
}

function weighBoosted(n, weighting, skirt, modulus, centre, skew, boost) {
	if ((n - 1) % modulus > 0) {
		if (boost <= 0) {
			return 0;
		}
		const distance = Math.max(modulus * skirt + 1 - centre, centre - 1) + modulus;
		if (n > centre) {
			n = centre + distance;
		} else {
			n = centre - distance;
		}
	}
	let newPosition;
	if (n >= centre) {
		newPosition = n - boost;
		if (newPosition <= centre) {
			return 1 + Math.abs(skew) * ((centre - newPosition) / modulus);
		}
	} else {
		newPosition = n + boost;
		if (newPosition >= centre) {
			return 1 + Math.abs(skew) * ((newPosition - centre) / modulus);
		}
	}
	return weighting(newPosition);
}

/**First N overtones of a sawtooth wave, square wave, triangle wave or something similar.
 * The fundamental is also included as well as the N overtones.
 *
 * For modulus = 1 (sawtooth like waves):
 * 	Ableton has presets for skirt values of 2, 3, 5, 7, 15, 31 & 63. (i.e. Saw 3, Saw 4...)
 * 	Korg opsix has a preset for 4.
 *
 * For modulus = 2 (square like waves):
 * 	Ableton has presets for 2, 3, 5, 7, 15, 31 & 63 (i.e. Square 3, Square 4...)
 *
 * @param {boolean} phaseFlip true produces triangle like shapes (when modulus and curve are
 * both set to 2), and false produces square like shapes. Should be true when modulus is odd.
 */
function spectrum(skirt, modulus = 1, phaseFlip = modulus % 2 === 1, curve = 1, centre = 1,
	bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
) {
	centre = (centre - 1) * modulus + 1;
	boost *= modulus;
	const skew = ((1 + Math.abs(bias) * modulus) ** curve) * (bias < 0 ? -1 : 1);
	const length = 2 + modulus * skirt;
	const coefficients = new Float32Array(length);
	const signMultiplier = phaseFlip ? -1 : 1;
	let sign = 1;
	/* Examples:
	 * modulus = 1, skirt = 1 means:
	 * 	1st and 2nd harmonics are present, array indices 0..2, length 3
	 * modulus = 2, skirt = 1 means:
	 * 	1st and 3rd are harmonics present, array indices 0..3, length 4
	 */
	for (let i = 0; i <= skirt; i++) {
		coefficients[modulus * i + 1] = sign * weighHarmonic(modulus * i + 1, curve, centre, skew);
		sign *= signMultiplier;
	}
	if (boost !== 0) {
		sign = signMultiplier ** Math.trunc((boostedHarmonic - 1) / modulus);
		const weighting = n => weighHarmonic(n, curve, centre, skew);
		coefficients[boostedHarmonic] = sign * weighBoosted(boostedHarmonic, weighting, skirt, modulus, centre, skew, boost);
	}
	return coefficients;
}

function spectrum2(skirt, modulus = 1, phaseFlip = modulus % 2 === 1, minLevel = 512,
	centre = 1, bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
) {
	const xRadiusSquared = skirt * skirt / (1 - minLevel * minLevel / (1023 * 1023));
	skirt = Math.max(skirt, centre + skirt - 1);
	centre = (centre - 1) * modulus + 1;
	boost *= modulus;
	const skew = (1 + Math.abs(bias) * modulus) * (bias < 0 ? -1 : 1);
	const length = 2 + modulus * skirt;
	const coefficients = new Float32Array(length);
	const signMultiplier = phaseFlip ? -1 : 1;
	let sign = 1;
	for (let i = 0; i <= skirt; i++) {
		coefficients[modulus * i + 1] = sign * weighHarmonic2(modulus * i + 1, xRadiusSquared, minLevel, centre, skew);
		sign *= signMultiplier;
	}
	if (boost !== 0) {
		sign = signMultiplier ** Math.trunc((boostedHarmonic - 1) / modulus);
		const weighting = n => weighHarmonic2(n, xRadiusSquared, minLevel, centre, skew);
		coefficients[boostedHarmonic] = sign * weighBoosted(boostedHarmonic, weighting, skirt, modulus, centre, skew, boost);
	}
	return coefficients;
}

/**Takes two positive real numbers, a and b, and finds integers, c and d, such that a/b = c/d,
 * where c and d don't share any common factors, and then returns d.
 */
function findDenominator(a, b) {
	if (a < 1 && b < 1) {
		const min = Math.min(a, b);
		a /= min;
		b /= min;
	}
	if (a % 1 > 0 || b % 1 > 0) {
		const multiple = a > b ? a / b : b / a;
		let remainder = multiple % 1;
		if (remainder === 0) {
			a *= multiple;
			b *= multiple;
		} else {
			const rounding = 10e-11;
			let numeratorA, numeratorB;
			do {
				numeratorA = (a / remainder) % 1;
				if (numeratorA < rounding || numeratorA > 1 - rounding) {
					numeratorA = 1;
				}
				numeratorB = (b / remainder) % 1;
				if (numeratorB < rounding || numeratorB > 1 - rounding) {
					numeratorB = 1;
				}
				remainder *= Math.min(numeratorA, numeratorB);
			} while (numeratorA < 1 || numeratorB < 1);
			a = Math.round((a / remainder) / rounding) * rounding;
			b = Math.round((b / remainder) / rounding) * rounding;
		}
	}
	return b / gcd(a, b);
}

class TimbreFrame {

	constructor() {
		this.holdTime = 1;
		this.fadeTime = 0;
		this.linearFade = true;
		this.amplitude = 1023;
		this.pitchRatio = 1;		// >= 0
		this.subharmonics = 0;
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
		return this.pitchRatio / (this.subharmonics + 1);
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

	fillSpectrum(skirt, modulus = 1, phaseFlip = modulus % 2 === 1, curve = 1, centre = 1,
		bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const magnitudes = spectrum(skirt, modulus, phaseFlip, curve, centre, bias, boost, boostedHarmonic).slice(1);
		const length = magnitudes.length;
		const phases = new Array(length);
		phases.fill(0);
		this.magnitudes = magnitudes;
		this.phases = phases;
		this.calculate();
	}

	fillSpectrum2(skirt, modulus = 1, phaseFlip = modulus % 2 === 1, minLevel = 512, centre = 1,
		bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const magnitudes = spectrum2(skirt, modulus, phaseFlip, minLevel, centre, bias, boost, boostedHarmonic).slice(1);
		const length = magnitudes.length;
		const phases = new Array(length);
		phases.fill(0);
		this.magnitudes = magnitudes;
		this.phases = phases;
		this.calculate();
	}

	calculate() {
		const magnitudes = this.magnitudes;
		const phases = this.phases;
		const numHarmonics = magnitudes.length;
		const sines = new Float32Array(numHarmonics + 1);
		const cosines = new Float32Array(numHarmonics + 1);
		for (let i = 0; i < numHarmonics; i++) {
			let magnitude = magnitudes[i] || 0;
			let phase = ((phases[i] || 0) + 0.25) * (2 * Math.PI);
			if (magnitude < 0) {
				magnitudes[i] = -magnitude;
				phases[i] = (phase + 0.5) % 1;
			}
			sines[i + 1] = magnitude * Math.sin(phase);
			cosines[i + 1] = magnitude * Math.cos(phase);
		}
		this.sines = sines;
		this.cosines = cosines;
	}

	effectivePitchRatio() {
		let pitchRatio = super.effectivePitchRatio();
		const harmonics = [];
		for (let i = 0; i < this.magnitudes.length; i++) {
			if ((this.magnitudes[i] || 0) !== 0) {
				harmonics.push(i + 1);
			}
		}
		switch (harmonics.length) {
		case 0: return 0;
		case 1: return harmonics[0] * pitchRatio;
		default:
			let multiple = gcd(harmonics[0], harmonics[1]);
			for (let i = 2; i < harmonics.length; i++) {
				multiple = gcd(multiple, harmonics[i]);
			}
			return multiple * pitchRatio;
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
		const frequency = operator.frequency;
		const numBuffers = definition.buffers.length;
		let bufferNum = 0;
		let bufferFrequency = definition.bufferFrequencies[0];
		while (frequency > bufferFrequency && bufferNum < numBuffers - 1) {
			bufferNum++;
			bufferFrequency = definition.bufferFrequencies[bufferNum];
		}

		const source = new AudioBufferSourceNode(audioContext, {
			buffer: definition.buffers[bufferNum], playbackRate: 0, loop: definition.loop,
			loopStart: definition.loopStartTimes[bufferNum], loopEnd: Number.MAX_VALUE
		});
		const rateMultiplier = new GainNode(context, {gain: 1 / bufferFrequency});
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
		this.buffers = [];
		this.bufferFrequencies = [];
		this.loop = false;
		this.loopStartTimes = [];
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
		/* The timing note is the note that has a time value of 1 equal to 1 second.
		 * Alternatively use -1 to specify times in terms of numbers of cycles. */
		this.timingNote = 60;
		this.timeScaling = 1;	// Speeds up or slows down all frames (normally 1 when timingNote = -1)
		this.loop = true;
		this.loopStartFrame = 0;
		this.bitDepth = 24;
	}

	clone() {
		const oscillator = new TimbreFrameOscillator();
		oscillator.frames = this.frames.map(frame => frame.clone());
		oscillator.timingNote = this.timingNote;
		oscillator.timeScaling = this.timeScaling;
		oscillator.loop = this.loop;
		oscillator.loopStartFrame = this.loopStartFrame;
		oscillator.bitDepth = this.bitDepth;
		return oscillator;
	}

	/**Depends on the channel's tuning
	 */
	async createSamples(realtimeAudioContext, channel) {
		let cPitch;
		if (this.timingNote === -1) {
			// Time timbre frames using number of waveform cycles.
			for (let midiNote = 36; midiNote <= 108; midiNote += 12) {
				cPitch = channel.notePitch(midiNote);
				const bufferNum = midiNote / 12 - 3;
				this.#createSample(realtimeAudioContext, channel, bufferNum, 1, cPitch, 1);
			}
			return;
		}

		// Time timbre frames in seconds.
		const timingC = Math.ceil(this.timingNote / 12) * 12;
		const timingPitch = channel.notePitch(this.timingNote)
		cPitch = channel.notePitch(timingC);
		let stretch = 1;
		for (let midiNote = timingC; midiNote <= 108; midiNote += 12) {
			const bufferNum = midiNote / 12 - 3;
			this.#createSample(realtimeAudioContext, channel, bufferNum, timingPitch, cPitch, stretch);
			cPitch = channel.notePitch(midiNote + 12);
			stretch *= cPitch / channel.notePitch(midiNote + 11);
		}
		stretch = 1;
		for (let midiNote = timingC - 12; midiNote >= 36; midiNote -= 12) {
			cPitch = channel.notePitch(midiNote);
			stretch *= cPitch / channel.notePitch(midiNote + 1);
			const bufferNum = midiNote / 12 - 3;
			this.#createSample(realtimeAudioContext, channel, bufferNum, timingPitch, cPitch, stretch);
		}
	}

	async #createSample(realtimeAudioContext, channel, bufferNum, timingPitch, recordingPitch, timeStretch) {
		const sampleRate = realtimeAudioContext.sampleRate;
		this.bufferFrequencies[bufferNum] = recordingPitch;
		const timeMultiple = timingPitch / recordingPitch * this.timeScaling * timeStretch;
		const notePeriod = 1 / recordingPitch;
		const minAmplitude = logToLinear(1);

		const frames = this.frames.slice();;
		let numFrames = frames.length;
		let loopStartFrame = this.loopStartFrame;
		if (!this.loop) {
			// Case 1: Non-looping. Add an implied fading to silence frame on the end.
			const silentFrame = frames[numFrames - 1].clone();
			silentFrame.holdTime = 0;
			frames.push(silentFrame);
			numFrames++;
			loopStartFrame = numFrames - 1;
		} else if (loopStartFrame === numFrames - 1) {
			// Case 2: Loop last frame only.
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
			// Case 3: Loop multiple frames. Add an implied copy of the loop start frame so that
			// the end of the loop transitions to match the start of the loop.
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
					 * then those harmonics will stay phase aligned.
					 * Example:
					 * Faster wave:	0		1.5	3		4.5	6 ...
					 * Slower wave:	0		1		2		3		4 ...
					 * So every instant that's a multiple of 0.5 times the period of the faster wave
					 * is special.
					 * Alternatively:
					 * Faster wave:	0		1		2		3		4		5		6 ...
					 * Slower wave:	0		2/3	4/3	2		2+2/3	2+4/3	4 ...
					 * So there's periodicity in 2/3 of the period of the slower wave too.
					 */
					let subperiod = period;
					if (!isLastFrame) {
						if (nextPitchRatio === 0) {
							subperiod *= 0.5;	// i.e. any zero crossing point
						} else {
							const multiple = findDenominator(pitchRatio, nextPitchRatio);
							// The interference pattern must happen fast enough to be perceived as
							// timbre, not modulation, i.e. minimum 20Hz.
							if (nextPitchRatio * recordingPitch / multiple >= 20) {
								subperiod /= multiple;
							}
						}
					}
					duration = Math.round((fadeIn + frame.holdTime * timeMultiple) / subperiod) * subperiod;
					if (duration < fadeIn) {
						duration += subperiod;
					}
				}

				if (i === loopStartFrame) {
					loopOffset = fadeIn % period;
				}

				if (isLastFrame) {
					duration += loopOffset;
				} else {
					// Time scaling (or just high pitch) may have made the frame length shorter
					// than a single cycle of the waveform, which usually isn't useful.
					const minCycles =
						timingPitch === 1 && fadeIn === 0 && frame.holdTime === 0.5 ? 0.5 : 1;
					duration = Math.max(duration, minCycles * period);
				}

			} // end if the frame isn't silent

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
		this.loopStartTimes[bufferNum] = fadedInTimes[loopStartFrame];

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

		this.buffers[bufferNum] = buffer;
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

	/**Creates a waveform shaped like a Yamaha operator with feedback set to 6, which is also
	 * one of the Casio CZ "resonant" waveforms (if the permissible DCW positions are
	 * restricted, since the hard sync part isn't implemented here).
	 * @param {number} boostedHarmonic Must be an even number. 34 possibly best emulates
	 * Yamaha (the harmonics quickly exceed the Nyquist frequency though) and Casio goes up to
	 * 15 (so 14 or 16 using this function).
	 */
	resonantSaw: function (boostedHarmonic) {
		const frequencyMultiple = boostedHarmonic >> 1;
		const bias = -1 / Math.PI;
		/* To normalize the waveform use f(u) as the number being subtracted from in the
		 * denominator instead of 1, where:
		 * u is a solution to frequencyMultiple * (PI - x) / tan(frequencyMultiple * x) - 1 = 0
		 * -PI < u < -PI + PI / frequencyMultiple
		 * f(x) = (0.5 - 0.5 * x / PI) * abs(sin(frequencyMultiple * x))
		 */
		const gain = 1 / (1 + bias);
		const oscillator1Factory = singleOscillatorFactory('sine', true, bias);
		return OscillatorFactory.dual(
			oscillator1Factory, 'sawtooth', frequencyMultiple, false, 0, -1, gain
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


	spectral: function (skirt, modulus = 1, phaseFlip = modulus % 2 === 1, curve = 1,
		centre = 1, bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const sines = spectrum(skirt, modulus, phaseFlip, curve, centre, bias, boost, boostedHarmonic);
		const cosines = new Float32Array(sines.length);
		return new PeriodicOscillatorFactory(sines, cosines);
	},

	spectral2: function (skirt, modulus = 1, phaseFlip = modulus % 2 === 1, minLevel = 512,
		centre = 1, bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const sines = spectrum2(skirt, modulus, phaseFlip, minLevel, centre, bias, boost, boostedHarmonic);
		const cosines = new Float32Array(sines.length);
		return new PeriodicOscillatorFactory(sines, cosines);
	},

	cospectral: function (skirt, modulus = 1, phaseFlip = modulus % 2 === 1, curve = 1,
		centre = 1, bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const cosines = spectrum(skirt, modulus, phaseFlip, curve, centre, bias, boost, boostedHarmonic);
		const length = cosines.length;
		const sines = new Float32Array(length);
		for (let i = 2; i < length; i++) {
			cosines[i] *= i;
		}
		return new PeriodicOscillatorFactory(sines, cosines);
	},

	cospectral2: function (skirt, modulus = 1, phaseFlip = modulus % 2 === 1, minLevel = 512,
		centre = 1, bias = 0, boost = 0, boostedHarmonic = (centre - 1) * modulus + 1
	) {
		const cosines = spectrum2(skirt, modulus, phaseFlip, minLevel, centre, bias, boost, boostedHarmonic);
		const length = cosines.length;
		const sines = new Float32Array(length);
		for (let i = 2; i < length; i++) {
			cosines[i] *= i;
		}
		return new PeriodicOscillatorFactory(sines, cosines);
	},

	timbreFrames: function() {
		return new TimbreFrameOscillatorFactory();
	},

	integrate: function(coefficients) {
		let max = 0, area = 0;
		for (let i = 0; i < coefficients.length; i++) {
			area += -coefficients[i] / (i + 1) * (Math.cos((i + 1) * Math.PI) - 1);
			max += coefficients[i] * Math.sin((i + 1) * 0.5 * Math.PI);
		}
		return area / max;
	}

}

const SINE_SQ_COEFFICIENTS = [1, 0, -0.19, 0, -0.03, 0, -0.01];
const COSINE_SQ_COEFFICIENTS = SINE_SQ_COEFFICIENTS.map((x, i) => x * (i + 1));
const SINE_SQ_OFFSET = -OscillatorFactory.integrate(SINE_SQ_COEFFICIENTS) / (2 * Math.PI);

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


	// From the Yamaha DX11, TX81Z, SY77, SY99 and TG77

	// W2
	SINE_SQ:			OscillatorFactory.ringMod('sine', true, 'sine'),
	ALTERNATING_SINE:	OscillatorFactory.ringMod('sine', true, 'square', 2), // d/dx(|sin(x)| * sin(x))

	// W4
	HALF_SINE_SQ:	OscillatorFactory.additiveSin(SINE_SQ_COEFFICIENTS, false, SINE_SQ_OFFSET, 1),
	HALF_COSINE_SQ: OscillatorFactory.additiveCos(COSINE_SQ_COEFFICIENTS, false, 0, 1),

	// W6
	ODD_SINE_SQ:	OscillatorFactory.additiveSin(SINE_SQ_COEFFICIENTS, false, 0, 2),
	ODD_COSINE_SQ:	OscillatorFactory.additiveCos(COSINE_SQ_COEFFICIENTS, false, 0, 2),

	//W8
	ABS_ODD_SINE_SQ: OscillatorFactory.additiveSin(SINE_SQ_COEFFICIENTS, true, SINE_SQ_OFFSET, 2),


	// From Yamaha chips used in early 2000s mobile phones, e.g. YMU762 (MA-3)
	HALF_TRIANGLE:	OscillatorFactory.am('triangle', false, -0.25, 'square'),
	QUARTER_TRIANGLE:	OscillatorFactory.am('triangle', true, -0.25, 'square', 2, true),
	ODD_TRIANGLE:	OscillatorFactory.am('triangle', false, 0, 'square', 2),
	ABS_ODD_TRI:	OscillatorFactory.am('triangle', true, -0.25, 'square', 2),
	HALF_SAWTOOTH:	OscillatorFactory.am('sawtooth', false, -0.25, 'square'),
	ODD_SAWTOOTH:	OscillatorFactory.am('sawtooth', false, 0, 'square', 2),


	// Additive
	TRIANGLE12:		OscillatorFactory.additive2('triangle', false, 0, 'triangle', 2, false, 4/3),
	SQUARE12:		OscillatorFactory.additive2('square', false, 0, 'square', 2),
	SAW12:			OscillatorFactory.additive2('sawtooth', false, 0, 'sawtooth', 2, false, 4/3),

	SINE12345:		OscillatorFactory.spectral(4),
	COSINE12345:	OscillatorFactory.cospectral(4),

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
