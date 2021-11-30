window.drawWaveforms = function () {
	const height = 32;
	const width = 4 * Math.round(height * Math.PI / 2);

	const sine = new Array(1024);
	const saw = new Array(1024);
	for (let x = 0; x < 1024; x++) {
		sine[x] = Math.sin(2 * Math.PI * (x + 0.5) / 1024);
		saw[x] = x / 512 - 1;
	}

	const waveforms = [sine];
	const cycles = [2];

	// Half Sine
	waveforms.push(synth.waveforms[1].getChannelData(0));
	cycles.push(2);
	// Absolute Sine
	waveforms.push(synth.waveforms[2].getChannelData(0));
	cycles.push(4);
	// Pulse Sine
	waveforms.push(synth.waveforms[3].getChannelData(0));
	cycles.push(4);
	// Sine, even periods only
	waveforms.push(synth.waveforms[4].getChannelData(0));
	cycles.push(1);
	// Absolute Sine, even periods only
	waveforms.push(synth.waveforms[5].getChannelData(0));
	cycles.push(1);

	const square = new Array(1024)
	square.fill(1, 0, 512);
	square.fill(-1, 512);
	waveforms.push(square);
	cycles.push(2);

	waveforms.push(saw);
	cycles.push(2);

	const triangle = new Array(1024);
	for (let x = 0; x < 512; x++) {
		const fraction = x / 256;
		triangle[(x + 768) % 1024] = fraction - 1;
		triangle[x + 256] = 1 - fraction;
	}
	waveforms.push(triangle);
	cycles.push(2);

	for (let i = 0; i < waveforms.length; i++) {
		const canvas = document.createElement('CANVAS');
		canvas.width = width;
		canvas.height = height;
		const canvasContext = canvas.getContext('2d');
		drawWaveform(waveforms[i], canvasContext, cycles[i]);
		document.body.appendChild(canvas);
		document.body.appendChild(document.createElement('BR'));
	}
}
