
function phaseDistortByValues(sampleRate, frequency, xValues, yValues) {
	let period = sampleRate / frequency;
	let numPoints = xValues.length;
	const numCycles = xValues[numPoints - 1];
	const length = Math.trunc(period * numCycles);
	period = length / numCycles;
	frequency = numCycles / length * sampleRate;
	const nyquistThreshold = 0.5 * sampleRate / frequency;
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
				if (y === 0) {
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

	// Find the highest fundamental pitch that won't break the carrier oscillator.
	let maxFrequencyRatio = Infinity;
	prevX = 0;
	prevY = 0;
	i = 0;
	for (; i < numPoints; i++) {
		const x = xValues[i];
		const y = yValues[i];
		const currentFrequency = (y - prevY) / (x - prevX);
		maxFrequencyRatio = Math.min(
			maxFrequencyRatio,
			nyquistThreshold /  Math.abs(currentFrequency)
		);
		prevX = x;
		prevY = y;
	}
	const maxFrequency = Math.min(frequency * maxFrequencyRatio, 0.5 * sampleRate);

	// Render the phase distortion pattern into an AudioBuffer.
	const buffer = new AudioBuffer({length: length, sampleRate: sampleRate});
	const data = buffer.getChannelData(0);
	prevX = 0, prevY = 0;

	for (i = 0; i < numPoints; i++) {
		const x = xValues[i];
		const y = yValues[i];
		const currentFrequency = (y - prevY) / (x - prevX);
		for (let j = prevX; j < x; j++) {
			data[j] = currentFrequency;
		}
		prevX = x;
		prevY = y;
	}

	// Correct for rounding errors.
	let total = 0;
	for (i = 0; i < length; i++) {
		total += data[i];
	}
	const error = total - length;
	i = length - 1;
	while (i > 0 && Math.abs(data[i] - error) > nyquistThreshold) {
		i--;
	}
	data[i] -= error;
	return [buffer, frequency, maxFrequency];
}

cosine = new PeriodicWave(audioContext, {real: [0, 1], imag: [0, 0]});
carrier = new OscillatorNode(audioContext, {frequency: 0, periodicWave: cosine});
//carrier = new OscillatorNode(audioContext, {frequency: 0});
carrier.start();
maxFrequency = 440 * 2 ** ((108 - 69) / 12);
[buffer, maxFrequency] = phaseDistortByValues(48000, maxFrequency, [1, 1], [0.5, 1]);
modulator = new AudioBufferSourceNode(audioContext, {buffer: buffer, loop: true, loopEnd: buffer.duration});
frequency = 440;
ratio = frequency / maxFrequency;
modulator.playbackRate.value = ratio;
gain = new GainNode(audioContext, {gain: frequency});
modulator.connect(gain);
gain.connect(carrier.frequency);
carrier.connect(audioContext.destination);
modulator.start();
