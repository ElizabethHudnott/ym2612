/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2023. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
class PhaseDistortion {

	static fromValues(sampleRate, frequency, xValues, yValues) {
		let period = sampleRate / frequency;
		let numPoints = xValues.length;
		const numCycles = xValues[numPoints - 1];
		let length = Math.trunc(period * numCycles);
		period = length / numCycles;
		frequency = numCycles / length * sampleRate;
		let nyquistThreshold = 0.5 * period;

		// Ensure congruent y-values are treated equally and collapse zero length portions.
		let prevX = 0;
		let prevY = 0;
		let i = 0;
		while (i < numPoints) {
			const x = xValues[i];
			if (x === prevX) {
				let j = i + 1;
				while (j < numPoints && xValues[j] === prevX) {
					j++;
				}
				j--;

				let prevYFraction = prevY % 1;
				if (prevYFraction < 0) {
					prevYFraction = 1 - prevYFraction;
				}
				const y = yValues[j];
				let yFraction = y % 1;
				if (yFraction < 0) {
					yFraction = 1 - yFraction;
				}

				if (yFraction === prevYFraction) {
					const diff = prevY - y;
					const numToDelete = j - i + 1;
					xValues.splice(i, numToDelete);
					yValues.splice(i, numToDelete);
					numPoints -= numToDelete;
					for (j = i; j < numPoints; j++) {
						yValues[j] += diff;
					}
				} else {
					prevY = yValues[i];
					i++;
				}
			} else {
				prevX = x;
				prevY = yValues[i];
				i++;
			}
		}
		const decayLevel = yValues[numPoints - 1] / xValues[numPoints - 1];

		// Scale values by the period.
		xValues = xValues.slice();
		yValues = yValues.slice();
		for (i = 0; i < numPoints; i++) {
			xValues[i] = Math.round(xValues[i] * period);
			yValues[i] *= period;
		}

		// Ensure we don't exceed the Nyquist limit.
		prevX = 0;
		prevY = 0;
		for (i = 0; i < numPoints - 1; i++) {
			let x = xValues[i];
			if (x < prevX) {
				x = prevX;
			}
			const y = yValues[i];
			let xDistance = x - prevX;
			const yDistance = y - prevY;
			const currentFrequency = yDistance / xDistance;
			if (xDistance === 0 || Math.abs(currentFrequency) > nyquistThreshold) {
				// Nudge this point forward on the x-axis.
				xDistance = Math.ceil(Math.abs(yDistance) / nyquistThreshold);
				x = prevX + xDistance;
				xValues[i] = x;
			}
			prevX = x;
			prevY = y;
		}
		prevX = xValues[numPoints - 1];
		prevY = yValues[numPoints - 1];
		for (i = numPoints - 2; i >= 0; i--) {
			let x = xValues[i];
			if (x > prevX) {
				x = prevX;
			}
			const y = yValues[i];
			let xDistance = prevX - x;
			const yDistance = prevY - y;
			const currentFrequency = yDistance / xDistance;
			if (xDistance === 0 || Math.abs(currentFrequency) > nyquistThreshold) {
				// Nudge this point backward on the x-axis.
				xDistance = Math.ceil(Math.abs(yDistance) / nyquistThreshold);
				x = prevX - xDistance;
				if (x <= 0) {
					if (x === 0 && y === 0) {
						xValues.splice(0, i + 1);
						yValues.splice(0, i + 1);
						numPoints = xValues.length;
						break;
					}
					throw new Error('One or more segments of the phase distortion function require a carrier frequency which exceeds the Nyquist frequency.');
				}
				xValues[i] = x;
			} else {
				break;
			}
			prevX = x;
			prevY = y;
		}

		// Remove any remaining duplicate points created by rounding to the length of the period.
		prevX = 0;
		i = 0;
		while (i < numPoints) {
			const x = xValues[i];
			if (x === prevX) {
				xValues.splice(i, 1);
				if (i === 0) {
					yValues.splice(i, 1);
				} else {
					yValues.splice(i - 1, 1);
				}
				numPoints--;
			} else {
				prevX = x;
				i++;
			}
		}


		// Compute final frequencies.
		const frequencies = new Array(numPoints);
		let minFrequency = Infinity, maxFrequency = -Infinity;
		prevX = 0;
		prevY = 0;
		for (i = 0; i < numPoints; i++) {
			const x = xValues[i];
			const y = yValues[i];
			const xDistance = x - prevX;
			const currentFrequency = (y - prevY) / xDistance;
			minFrequency = Math.min(minFrequency, currentFrequency);
			maxFrequency = Math.max(maxFrequency, currentFrequency);
			frequencies[i] = currentFrequency;
			prevX = x;
			prevY = y;
		}

		// Might be able to employ the same sample to also do phase distortion at a few higher
		// fundamental frequencies without loss of temporal resolution (sharpness) or aliasing.
		let commonDivisor = 1;
		let factors, powers;
		if (numPoints > 1) {
			commonDivisor = gcd(xValues[0], xValues[1]);
			for (i = 2; i < numPoints; i++) {
				commonDivisor = gcd(commonDivisor, xValues[i]);
			}

			let maxFrequencyRatio = Infinity;
			for (i = 0; i < numPoints; i++) {
				maxFrequencyRatio = Math.min(
					maxFrequencyRatio, nyquistThreshold /  Math.abs(frequencies[i])
				);
			}
			[factors, powers] = factorize(commonDivisor);
			i = factors.length - 1;
			while (i >= 0 && commonDivisor > maxFrequencyRatio) {
				const factor = factors[i];
				let power = powers[i];
				while (power > 0 && commonDivisor > maxFrequencyRatio) {
					commonDivisor /= factor;
					power--;
				}
				powers[i] = power;
				i--;
			}
			const index = powers[i + 1] === 0 ? i + 1 : i + 2;
			factors.splice(index);
			powers.splice(index);

			length /= commonDivisor;
			nyquistThreshold = length / (2 * numCycles);
			for (i = 0; i < numPoints; i++) {
				xValues[i] /= commonDivisor;
			}
		} else {
			factors = [];
			powers = [];
		}

		// Render the phase distortion pattern into an AudioBuffer.
		const buffer = new AudioBuffer({length: length, sampleRate: sampleRate});
		const data = buffer.getChannelData(0);
		data[0] = 0.5 * (minFrequency + maxFrequency);
		const centreFrequency = data[0];

		let total = 0;
		prevX = 0;
		for (i = 0; i < numPoints; i++) {
			const x = xValues[i];
			data.fill(frequencies[i] - centreFrequency, prevX, x);
			total += (data[prevX] + centreFrequency) * ((x - prevX) * commonDivisor);
			prevX = x;
		}

		// Correct for rounding errors.
		const error = total - yValues[numPoints - 1];
		i = length - 1;
		while (i > 0 && Math.abs(data[i] + centreFrequency - error) > nyquistThreshold) {
			i--;
		}
		data[i] -= error;
		const allFactors = expandFactors(factors, powers);
		const distortion = new PhaseDistortion(
			buffer, frequency, centreFrequency, decayLevel, commonDivisor, allFactors
		);
		return distortion;
	}

	/**
	 * The sound can be played at full fidelity at the build frequency or at any other multiple
	 * of the build frequency that can be found in the factors array. The array contains the
	 * multiplication factors.
	 */
	constructor(buffer, buildFrequency, centre, decayLevel, frequencyMultiplier, factors) {
		this.buffer = buffer;
		this.buildFrequency = buildFrequency;
		this.centre = centre;
		this.decayLevel = decayLevel;
		this.baseFrequency = buildFrequency * frequencyMultiplier;
		this.factors = factors;
	}

	getPlaybackRate(frequency) {
		return frequency / this.baseFrequency;
	}

	/**
	 * Cosine: Sonically close approximation of a sawtooth wave.
	 * Square, Sawtooth & Sine: Same shape as the input but with two distinct "pulse" widths.
	 * Triangle: Triangle with two "pulse" widths. Rate change occurs on zero crossings.
	 * @param {number} x The x-coordinate when half of the waveform has played.
	 */
	static halfSlow(x) {
		return [[x, 1], [0.5, 1]];
	}

	/**Whereas halfSlow() moves the x-coordinate, moreDoneByHalfTime() moves the y-coordinate
	 * instead and produces different wave shapes.
	 * See Figure 2 in http://recherche.ircam.fr/pub/dafx11/Papers/55_e.pdf
	 * @param {number} colour For a cosine wave input, zero produces the fundamental only. One
	 * produces all harmonics, and two produces the same result as finishEarly(0.5), which
	 * contains the odd harmonics plus a strong second harmonic. Negative values flip the order
	 * of the shaped sections but produce the same spectrum as positive values.
	 */
	static moreDoneByHalfTime(colour = 1) {
		const absColour = Math.abs(colour);
		let ySplit;
		if (absColour <= 1) {
			ySplit = 0.85 * absColour;
		} else {
			ySplit = 0.85 + 0.15 * (absColour - 1);
		}
		if (colour < 0) {
			ySplit = 1 - ySplit;
		}
		return [[0.5, 1], [ySplit, 1]];
	}

	/**
	 * N.B. The final phase accumulation is zero, which means that if a phase distortion
	 * envelope is applied then it will function as an amplitude envelope too. Running a
	 * rectified version of the input wave through a Half Slow transform will produce the same
	 * shape but without this side effect. The problem also disappears when this distortion has
	 * another distortion applied after it.
	 * Sine: Double sine (i.e. rectified sine, though the two halves have different frequencies
	 * if x is not equal to 0.5). Setting the distortion amp to 0.5 produces a 1/4 slow, 1/4
	 * fast absolute sine shape.
	 * Cosine: Sawtooth approximation. Same as the Half Slow function.
	 * Sawtooth: Triangle with two "pulse" widths. Rate change occurs at the most positive
	 * points and at the most negative points. Doesn't alter the fundamental frequency.
	 * Triangle: Triangle with two "pulse" widths. Rate change occurs at the most negative
	 * points only.
	 * Square: Not useable.
	 * @param {number} x The x-coordinate when half of the waveform has played for the first. time.
	 */
	static forwardAndBack(splitPoint) {
		return [[splitPoint, 1], [0.5, 0]];
	}

	/**
	 * N.B. The final phase accumulation is zero, which means that if a phase distortion
	 * envelope is applied then it will function as an amplitude envelope too. The problem
	 * disappears when this distortion has another distortion applied after it.
	 * @param {number} phase How much of the waveform to complete before hitting the mirror.
	 */
	static mirror(phase) {
		return [[0.5, 1], [phase, 0]];
	}

	/**
	 * @param {number} width How much of the output waveform should contain the input waveform.
	 */
	static finishEarly(width) {
		return [[width, 1], [1, 1]];
	}

	/**
	 * Use with cosine and an offset of 0.5 to replicate Casio's pulse shape.
	 * Use with abs(sin(x)) to replicate one of Bitwig's Phase-4 waveforms.
	 */
	holdAtMiddle(holdLength) {
		return [[0.5 - 0.5 * holdLength, 0.5 + 0.5 * holdLength, 1], [0.5, 0.5, 1]];
	}

	/**
	 * Cosine: Rounded pulse wave.
	 * Square: Pulse wave.
	 * Sawtooth: Held at zero. Then ramps up and is held at maximum (trapezoid). Then
	 * transitions to -1 and completes the second half of the sawtooth wave.
	 * Sine & Triangle: Held at zero. The completes the first half of the cycle. Then held at
	 * zero again. Then completes the second half of the cycle.
	 * @param {number} dutyCycle Even when the duty cycle is 0 or 1 the sound isn't necessarily
	 * hollow because of the effect of the transition width parameter.
	 * @param {number} transitionWidth Between 0 and 0.5.
	 */
	static holdAtStartAndMiddle(dutyCycle, transitionWidth) {
		const a = dutyCycle * (1 - 2 * transitionWidth);
		return [[a, a + transitionWidth, 1 - transitionWidth, 1], [0, 0.5, 0.5, 1]];
	}

	/**
	 * Cosine: Square wave with bumps.
	 */
	static rippleAtStartAndMiddle(transitionWidth, ripple) {
		const a = 0.5 - transitionWidth;
		const xValues = [0.5 * a, a, 0.5, 0.5 + 0.5 * a, 1 - transitionWidth, 1];
		const yValues = [ripple, 0, 0.5, 0.5 + ripple, 0.5, 1];
		return [xValues, yValues];
	}

	/**Produces the Casio Saw-Pulse wave When applied to a cosine wave. Use an offset equal to
	 * the hold length if the slant is equal to zero.
	 */
	holdAtStartAndHalfSlow(holdLength, splitPoint, slant = 0) {
		return [[holdLength, splitPoint, 1], [slant, 0.5, 1]];
	}

	/**
	 * @param {number} phase How much of the waveform to complete before restarting.
	 */
	static hardSync(phase) {
		return [[phase, phase], [phase, Math.max(Math.round(phase), 1)]];
	}

	static chain(xValues1, yValues1, xValues2, yValues2) {
		const length1 = xValues1.length;
		const joinPositionX = xValues1[length1 - 1];
		const joinPositionY = yValues1[length1 - 1];
		const xValues = xValues1.concat(xValues2.map(x => x + joinPositionX));
		const yValues = yValues1.concat(yValues2.map(y => y + joinPositionY));
		return [xValues, yValues];
	}

	/**Useful when chained together with an actual distortion.
	 */
	static noDistortion(numCycles = 1) {
		return [[numCycles], [numCycles]];
	}

	/**
	 * Useful when chained together with another waveform.
	 */
	static holdOnly(length = 1) {
		return [[length], [0]];
	}

	/**
	 * Useful when chained together with another waveform.
	 * @param {number} resonanceLength The number of wave cycles to insert. Must be a multiple
	 * of 0.5.
	 */
	static resonance(resonantHarmonic = 14, resonanceLength = resonantHarmonic) {
		return [[resonanceLength / resonantHarmonic], [resonanceLength]];
	}

	/**
	 * Cosine: Casio's "Sine Pulse" wave shape.
	 * Sine & Triangle: Two negative half cycles and then one full cycle.
	 * Sawtooth: One negative half cycle of a triangle and then one full cycle of sawtooth.
	 * Square: Not useable.
	 */
	static cosinePulse(pulseWidth) {
		return [[0.5 * pulseWidth, pulseWidth, 1], [-0.5, 0, 1]];
	}

	/**
	 * See Figure 4 and Figure 5 in http://recherche.ircam.fr/pub/dafx11/Papers/55_e.pdf
	 * @param {number} pitchRatio The pitch of the partial to accentuate. Non-integers will
	 * introduce a lot of high frequency content and cause some aliasing.
	 * @param {number} [spread] Between -2 and 2.
	 * @param {boolean} [smoothSweep] Pass in true when you need the waveform to
	 * smoothly transition over varying pitch ratios or varying amounts of spread while
	 * simultaneously applying a phase distortion envelope. Otherwise leave as false to achieve
	 * smooth transitions when using a phase distortion envelope alone without other concurrent
	 * modulations.
	 */
	static formant(pitchRatio, spread = 1, smoothSweep = false) {
		const splitY = 0.5 * (pitchRatio + 1);
		const similarToPointFive = 0.5 * (pitchRatio + 1) ** 2 / (pitchRatio * pitchRatio + 1);
		let splitX;
		if (spread <= -1) {
			/* -2 <= spread <= -1
			 * Case 1: Like Case 4 but in this case it's the piece with the lesser number of
			 * cycles that gets squeezed.
			 */
			splitX = -1 - spread + (2 + spread) * similarToPointFive;
			if (pitchRatio <= 0) {
				splitX = 1 - splitX;
			}
		} else if (pitchRatio === 0 && spread <= 1) {
			splitX = 0.5;
		} else if (spread <= 0) {
			/* -1 <= spread <= 0
			 * Case 2: Like Case 3 but in this case it's the piece with the lesser number of
			 * cycles that gets squeezed.
			 */
			splitX = -spread * similarToPointFive + (1 + spread) * splitY / pitchRatio;
		} else if (spread <= 1) {
			/* Case 3: 0 <= spread <= 1
			 * Fade between a single a partial (spread = 0) and odd harmonics (i.e. a square wave
			 * like spectrum) augmented with a cluster of five accentuated partials centred on the
			 * target partial.
			 */
			splitX = (1 - spread) * splitY / pitchRatio + 0.5 * spread;
		} else {
			/* Case 4: 1 <= spread <= 2
			 * As spread is increased above 1, the cluster of elevated partials turns into lots of
			 * smaller clusters spread throughout the spectrum. Thus, the higher harmonic content
			 * increases. In the time domain the piece of the wave pattern with the higher number
			 * of cycles gets squeezed into occupying less and less time. That piece occurs at
			 * the beginning when pitchRatio is positive.
			 */
			splitX = 0.5 * (2 - spread);
			if (pitchRatio <= 0) {
				splitX = 1 - splitX;
			}
		}

		let endY;
		if (smoothSweep || pitchRatio === 0 || pitchRatio % 1 !== 0) {
			endY = 1;
		} else {
			endY = pitchRatio;
		}
		return [[splitX, 1], [splitY, endY]];
	}

	/**From the Korg Prophecy. Given a triangle wave, slows down some parts and speeds up
	 * others depending on the value of the shape parameter.
	 * @param {number} shape Between 0 and 1.
	 */
	static prophecyRamp(shape) {
		const section = Math.trunc(shape * 4);
		let a, xValues, yValues;
		switch (section) {
		case 0:	// 0 <= shape < 0.25
			a = 0.75 - shape;
			xValues = [2/3 * a, 1.5 - a, 1.5];
			yValues = [0.5    , 0.75   , 1.5];
			break;
		case 1:	// 0.25 <= shape < 0.5
			a = 1/3 + (shape - 0.25) * 4 * (0.5 - 1/3);
			xValues = [a      , 1   , 1.5];
			yValues = [1.5 * a, 0.75, 1.5];
			break;
		case 2:	// 0.5 <= shape < 0.75
			a = 0.5 + (shape - 0.5) * 4 * (1/3 - 0.5);
			xValues = [0.5 , 1.5 - a      , 1.5];
			yValues = [0.75, 1.5 - 1.5 * a, 1.5];
			break;
		default:	// 0.75 <= shape <= 1
			a = shape - 0.25;
			xValues = [a   , 1.5 - 2/3 * a, 1.5];
			yValues = [0.75, 1            , 1.5];
		}
		return [xValues, yValues];
	}

	/**From the Korg NTS-1. Used with either sawtooth or triangle.
	 * N.B. The final phase accumulation is zero, which means that if a phase distortion
	 * envelope is applied then it will function as an amplitude envelope too. The problem
	 * disappears when this distortion has another distortion applied after it.
	 * @param {number} a Between 0 and 1.
	 */
	static nts1(a) {
		a = 1.5 - 0.5 * a;	// Result is between 1 and 1.5.
		return [[a, a, 3 - a, 3 - a, 2], [a, 2 - a, a - 1, 1 - a, 0]];
	}

}

// Definitions copied from common.js

function gcd(a, b) {
	while (b !== 0) {
		[a, b] = [b, a % b];
	}
	return a;
}


// All primes up to half the wavelength of A0, assuming a 48k sample rate.
const PRIMES = Object.freeze([
	  2,   3,   5,   7,  11,  13,  17,  19,  23,  29,  31,  37,  41,  43,  47,  53,  59,  61,
	 67,  71,  73,  79,  83,  89,  97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
	 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251,
	 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359,
	 367, 373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433, 439, 443, 449, 457, 461, 463,
	 467, 479, 487, 491, 499, 503, 509, 521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593,
	 599, 601, 607, 613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701,
	 709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811, 821, 823, 827,
	 829, 839, 853, 857, 859, 863
]);

function factorize(n) {
	const factors = [];
	const powers = [];
	let i = 0;
	while (n > 1 && i < PRIMES.length) {
		const prime = PRIMES[i];
		if (n % prime === 0) {
			let power = 0;
			do {
				power++;
				n /= prime;
			} while (n % prime === 0);
			factors.push(prime);
			powers.push(power);
		}
		i++;
	}
	if (n > 1) {
		factors.push(n);
		powers.push(1);
	}
	return [factors, powers];
}

function expandFactors(factors, powers, factorsSoFar = [1], index = 0) {
	if (index === factors.length) {
		return factorsSoFar.sort((a, b) => a - b);
	}
	const counters = new Array(factors.length);
	const numPreviousFactors = factorsSoFar.length;
	let multiplier = 1;
	for (let power = 1; power <= powers[index]; power++) {
		multiplier *= factors[index];
		for (let j = 0; j < numPreviousFactors; j++) {
			factorsSoFar.push(multiplier * factorsSoFar[j]);
		}
	}
	return expandFactors(factors, powers, factorsSoFar, index + 1);
}

cosine = new PeriodicWave(audioContext, {real: [0, 1], imag: [0, 0]});
carrier = new OscillatorNode(audioContext, {frequency: 0, periodicWave: cosine});
//carrier = new OscillatorNode(audioContext, {frequency: 0});
carrier.start();
highFrequency = 440;
phaseDistorter = PhaseDistortion.fromValues(
	48000, highFrequency, ...PhaseDistortion.formant(3)
);
// Pulse wave example: 	[0.3, 0.37, 0.93, 1], [0, 0.5, 0.5, 1]
buffer = phaseDistorter.buffer;
modulator = new AudioBufferSourceNode(
	audioContext, {buffer: buffer, loop: true, loopEnd: buffer.duration}
);
frequency = highFrequency;
modulator.playbackRate.value = phaseDistorter.getPlaybackRate(frequency);
amp = new GainNode(audioContext);
modulator.connect(amp);
gain = new GainNode(audioContext, {gain: frequency});
amp.connect(gain);
offset = new ConstantSourceNode(audioContext, {offset: 0});
offset.start();
offset.connect(gain);
gain.connect(carrier.frequency);
carrier.connect(audioContext.destination);

t1 = audioContext.currentTime + 0.1;
modulator.start(t1);
offset.offset.setValueAtTime(phaseDistorter.centre, t1);

/*
t2 = audioContext.currentTime + 0.001 + 128 / 48000;
t2 = t1 + Math.ceil((t2 - t1) * frequency) / frequency;
t3 = t2 + 0.5;
amp.gain.setValueAtTime(1, t2);
offset.offset.setValueAtTime(phaseDistorter.centre, t2);
amp.gain.linearRampToValueAtTime(0, t3);
offset.offset.linearRampToValueAtTime(phaseDistorter.decayLevel, t3);
*/
