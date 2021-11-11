import {LFO_FREQUENCIES} from './src/common.js';
import GenesisSound from './src/genesis.js';
import YM2612 from './src/ym2612.js';
let context, channels;

function initialize() {
	if (context !== undefined) {
		return;
	}
	context = new AudioContext();
	window.audioContext = context;
	const soundSystem = new GenesisSound(context);
	window.soundSystem = soundSystem;
	window.synth = soundSystem.fm;
	channels = synth.channels;
	window.chan = synth.getChannel(1);
	window.psg = soundSystem.psg;
	window.ym2612 = new YM2612(soundSystem.fm);

	soundSystem.start(context.currentTime + 0.01);
	soundSystem.setFilterCutoff(20000);
	synth.setChannelGain(6);
}

document.body.addEventListener('keydown', function (event) {
	initialize();
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.activeElement.type === 'number') {
		return;
	}
	channels[0].keyOn(context, context.currentTime + 0.1);
});

document.body.addEventListener('keyup', function (event) {
	initialize();
	channels[0].keyOff(context.currentTime + 0.1);
});

function algorithmRadio(event) {
	initialize();
	const algorithmNumber = parseInt(this.id.slice(-1));
	channels.map(c => c.useAlgorithm(algorithmNumber));
}

for (let i = 0; i <= 7; i++) {
	document.getElementById('algorithm-' + i).addEventListener('input', algorithmRadio);
}

document.getElementById('lfo-frequency-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	const fast = document.getElementById('fast-lfo').checked;
	const free = document.getElementById('lfo-frequency-free').checked;
	let frequency;
	if (free) {
		frequency = value;
	} else {
		frequency = value === 0 ? 0 : LFO_FREQUENCIES[value - 1] * synth.lfoRateMultiplier;
	}
	synth.setLFOFrequency(frequency);
	document.getElementById('lfo-frequency').value = Math.round(frequency * 100) / 100;
});

function configureLFOFreqSlider(fast, free) {
	const slider = document.getElementById('lfo-frequency-slider');
	if (fast) {
		// Enable faster rates
		if (free) {
			slider.min = Math.ceil(LFO_FREQUENCIES[5] * synth.lfoRateMultiplier * 10) / 10;
			slider.max = Math.ceil(LFO_FREQUENCIES[7] * synth.lfoRateMultiplier * 10) / 10;
			slider.step = 0.1;
		} else {
			slider.min = 6;
			slider.max = 8;
			slider.step = 1;
		}
	} else {
		// Slower rates
		if (free) {
			slider.min = 0;
			slider.max = Math.ceil(LFO_FREQUENCIES[5] * synth.lfoRateMultiplier * 10) / 10;
			slider.step = 0.01;
		} else {
			slider.min = 0;
			slider.max = 6;
			slider.step = 1;
		}
	}
}

document.getElementById('lfo-frequency').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 0) {
		const fastCheckbox = document.getElementById('fast-lfo');
		const fastThreshold = Math.ceil(LFO_FREQUENCIES[5] * synth.lfoRateMultiplier * 10) / 10;
		if (fastCheckbox.checked && value < fastThreshold) {
			fastCheckbox.checked = false;
			configureLFOFreqSlider(false, true);
		} else if (!fastCheckbox.checked && value > fastThreshold) {
			fastCheckbox.checked = true;
			configureLFOFreqSlider(true, true);
		}
		document.getElementById('lfo-frequency-slider').value = value;
		synth.setLFOFrequency(value);
	}
});

document.getElementById('fast-lfo').addEventListener('input', function (event) {
	initialize();
	const slider = document.getElementById('lfo-frequency-slider');
	const box = document.getElementById('lfo-frequency');
	const fast = this.checked;
	const free = document.getElementById('lfo-frequency-free').checked;
	configureLFOFreqSlider(fast, free);
	if (fast) {
		slider.value = slider.min;
	} else {
		slider.value = slider.max;
	}
	const frequency = free ? parseFloat(slider.value) : LFO_FREQUENCIES[5] * synth.lfoRateMultiplier;
	box.value = Math.round(frequency * 100) / 100;
	synth.setLFOFrequency(frequency);
});

document.getElementById('lfo-frequency-free').addEventListener('input', function (event) {
	initialize();
	const slider = document.getElementById('lfo-frequency-slider');
	const box = document.getElementById('lfo-frequency');
	const value = synth.getLFOFrequency();
	const fast = document.getElementById('fast-lfo').checked;
	const free = this.checked;
	box.disabled = !free;
	configureLFOFreqSlider(fast, free);
	if (free) {
		slider.value = value;
	} else {
		let delta = value;
		let presetNum = 8;
		for (let i = 7; i >= 0; i--) {
			const presetValue = LFO_FREQUENCIES[i] * synth.lfoRateMultiplier;
			const thisDelta = Math.abs(value - presetValue);
			if (thisDelta < delta) {
				delta = thisDelta;
				presetNum = i;
			}
			if (presetValue <= value) {
				break;
			}
		}
		slider.value = presetNum === 8 ? 0 : presetNum + 1;
		box.value = Math.round(LFO_FREQUENCIES[presetNum] * synth.lfoRateMultiplier * 100) / 100;
		synth.useLFOPreset(presetNum);
	}
});

document.getElementById('lfo-delay-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	document.getElementById('lfo-delay').value = value;
	channels.map(c => c.setLFOAttack(value));
});

document.getElementById('lfo-delay').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	if (value >= 0) {
		document.getElementById('lfo-delay-slider').value = value;
		channels.map(c => c.setLFOAttack(value));
	}
});
