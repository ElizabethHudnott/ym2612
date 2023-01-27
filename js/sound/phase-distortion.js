class PhaseDistortion {

	static fromValues(sampleRate, frequency, xValues, yValues) {
		let period = sampleRate / frequency;
		let numPoints = xValues.length;
		const numCycles = xValues[numPoints - 1];
		let length = Math.trunc(period * numCycles);
		period = length / numCycles;
		frequency = numCycles / length * sampleRate;
		let nyquistThreshold = 0.5 * period;
		let i;

		// Scale values by the period.
		xValues = xValues.slice();
		yValues = yValues.slice();
		for (i = 0; i < numPoints; i++) {
			xValues[i] = Math.round(xValues[i] * period);
			yValues[i] *= period;
		}

		// Ensure we don't exceed the Nyquist limit.
		let prevX = 0, prevY = 0;
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

		// Remove duplicate points.
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
		return new PhaseDistortion(buffer, frequency, centreFrequency, commonDivisor, allFactors);
	}

	constructor(buffer, buildFrequency, centre, frequencyMultiplier, factors) {
		this.buffer = buffer;
		this.buildFrequency = buildFrequency;
		this.centre = centre;
		this.baseFrequency = buildFrequency * frequencyMultiplier;
		this.factors = factors;
	}

	getPlaybackRate(frequency) {
		return frequency / this.baseFrequency;
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
	48000, highFrequency,
	[0.3, 0.37, 0.93, 1],
	[0, 0.5, 0.5, 1]
);
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
offset.offset.linearRampToValueAtTime(1, t3);
*/
