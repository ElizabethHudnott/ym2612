class PhaseDistortion {

	static fromValues(sampleRate, frequency, xValues, yValues, resolution) {
		let period = sampleRate / frequency;
		let numPoints = xValues.length;
		const numCycles = xValues[numPoints - 1];
		let length = Math.trunc(period * numCycles);
		period = length / numCycles;
		frequency = numCycles / length * sampleRate;
		let nyquistThreshold = 0.5 * period;	// Nyquist frequency / note frequency
		let i;

		let minFrequency = 0;
		if (resolution !== undefined && (xValues[0] !== numCycles || numPoints > 2)) {
			minFrequency = sampleRate / Math.ceil((xValues[0] + resolution) * period / xValues[0]);
		}

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
			if ((xDistance === 0 && yDistance !== 0) ||
				Math.abs(currentFrequency) > nyquistThreshold
			) {
				// Nudge this point forward on the x-axis.
				const absYDistance = Math.abs(yDistance);
				xDistance = absYDistance / nyquistThreshold;
				x = prevX + Math.ceil(xDistance);

				/* shorterDistance = absYDistance / newThreshold
				 * newThreshold = absYDistance / shorterDistance
				 * newThreshold = 0.5 * sampleRate / newFrequency
				 * 0.5 * sampleRate / newFrequency = absYDistance / shorterDistance
				 * newFrequency = 0.5 * sampleRate * shorterDistance / absYDistance
				*/
				let shorterDistance = Math.trunc(xDistance);
				if (shorterDistance === xDistance) {
					shorterDistance--;
				}
				if (shorterDistance > 0) {
					minFrequency = Math.max(
						minFrequency,
						0.5 * sampleRate * shorterDistance / absYDistance
					);
				} else {
					minFrequency = Math.max(minFrequency, 0.5 * frequency);
				}
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
			if (
				(xDistance === 0 && yDistance !== 0) ||
				Math.abs(currentFrequency) > nyquistThreshold
			) {
				// Nudge this point backward on the x-axis.
				const absYDistance = Math.abs(yDistance);
				xDistance = absYDistance / nyquistThreshold;
				x = prevX - Math.ceil(xDistance);

				let shorterDistance = Math.trunc(xDistance);
				if (shorterDistance === xDistance) {
					shorterDistance--;
				}
				if (shorterDistance > 0) {
					minFrequency = Math.max(
						minFrequency,
						0.5 * sampleRate * shorterDistance / absYDistance
					);
				} else {
					minFrequency = Math.max(minFrequency, 0.5 * frequency);
				}
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
		prevX = 0;
		prevY = 0;
		for (i = 0; i < numPoints; i++) {
			const x = xValues[i];
			const y = yValues[i];
			const xDistance = x - prevX;
			frequencies[i] = (y - prevY) / xDistance;
			prevX = x;
			prevY = y;
		}

		// Might be able to employ the same sample to also do phase distortion at a few higher
		// fundamental frequencies without loss of temporal resolution (sharpness) or aliasing.
		let commonDivisor = 1;
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

			commonDivisor = Math.min(commonDivisor, Math.trunc(maxFrequencyRatio));
			length /= commonDivisor;
			nyquistThreshold = length / (2 * numCycles);
			for (i = 0; i < numPoints; i++) {
				xValues[i] /= commonDivisor;
			}
		}

		// Render the phase distortion pattern into an AudioBuffer.
		const buffer = new AudioBuffer({length: length, sampleRate: sampleRate});
		const data = buffer.getChannelData(0);
		prevX = 0, prevY = 0;

		let total = 0;
		prevX = 0;
		for (i = 0; i < numPoints; i++) {
			const x = xValues[i];
			data.fill(frequencies[i], prevX, x);
			total += data[prevX] * ((x - prevX) * commonDivisor);
			prevX = x;
		}

		// Correct for rounding errors.
		const error = total - yValues[numPoints - 1];
		i = length - 1;
		while (i > 0 && Math.abs(data[i] - error) > nyquistThreshold) {
			i--;
		}
		data[i] -= error;
		return new PhaseDistortion(buffer, minFrequency, frequency, commonDivisor);
	}

	constructor(buffer, minFrequency, frequency, commonDivisor) {
		this.buffer = buffer;
		this.minFrequency = minFrequency;
		this.frequency = frequency;
		this.commonDivisor = commonDivisor;
	}

}

function gcd(a, b) {
	while (b !== 0) {
		[a, b] = [b, a % b];
	}
	return a;
}

cosine = new PeriodicWave(audioContext, {real: [0, 1], imag: [0, 0]});
carrier = new OscillatorNode(audioContext, {frequency: 0, periodicWave: cosine});
//carrier = new OscillatorNode(audioContext, {frequency: 0});
carrier.start();
highFrequency = 440;
phaseDistorter = PhaseDistortion.fromValues(
	48000, highFrequency,
	[0.3, 0.37, 0.93, 1],
	[0, 0.5, 0.5, 1],
	0.01
);
/*
buffer = phaseDistorter.buffer;
modulator = new AudioBufferSourceNode(
	audioContext, {buffer: buffer, loop: true, loopEnd: buffer.duration}
);
frequency = highFrequency;
ratio = frequency / (phaseDistorter.frequency * phaseDistorter.commonDivisor);
modulator.playbackRate.value = ratio;
gain = new GainNode(audioContext, {gain: frequency});
modulator.connect(gain);
gain.connect(carrier.frequency);
carrier.connect(audioContext.destination);
modulator.start();
*/
