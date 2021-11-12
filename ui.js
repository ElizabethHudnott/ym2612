import {LFO_FREQUENCIES, VIBRATO_PRESETS} from './src/common.js';
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

function vibratoPresetToCents(x) {
	if (x === 0) {
		return 0;
	} else if (x <= 3) {
		return 3.3 * x + 0.1;
	} else if (x < 5) {
		return 10 * 2 ** ((x - 3) / 2);
	} else {
		return 10 * 2 ** (x - 4);
	}
}

function centsToVibratoPreset(cents) {
	cents = Math.abs(cents);
	if (cents <= 0.1) {
		return 0;
	} else if (cents <= 10) {
		return (cents - 0.1) / 3.3;
	} else if (cents < 20) {
		return Math.log2(cents / 10) * 2 + 3;
	} else {
		return Math.log2(cents / 10) + 4;
	}
}

document.getElementById('vibrato-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	const free = document.getElementById('vibrato-free').checked;
	const box = document.getElementById('vibrato');
	let cents;
	if (free) {
		const sign = channels[0].getVibratoDepth() < 0 ? -1 : 1;
		cents = sign * vibratoPresetToCents(value);
	} else {
		cents = VIBRATO_PRESETS[value];
	}
	box.value = Math.round(cents * 10) / 10;
	channels.map(c => c.setVibratoDepth(cents));
});

document.getElementById('vibrato-free').addEventListener('input', function (event) {
	const slider = document.getElementById('vibrato-slider');
	const box = document.getElementById('vibrato');
	const free = this.checked;
	box.disabled = !free;
	if (free) {
		slider.step = 0.02;
	} else {
		let cents = Math.abs(channels[0].getVibratoDepth());
		let presetNum = centsToVibratoPreset(cents);
		const lowerPresetNum = Math.trunc(presetNum);
		const upperPresetNum = Math.ceil(presetNum);
		const lowerCents = VIBRATO_PRESETS[lowerPresetNum];
		const upperCents = VIBRATO_PRESETS[upperPresetNum];
		const lowerDelta = cents - lowerCents;
		const upperDelta = upperCents - cents;
		if (upperDelta <= lowerDelta) {
			presetNum = upperPresetNum;
			cents = upperCents;
		} else {
			presetNum = lowerPresetNum;
			cents = lowerCents;
		}
		slider.step = 1;
		slider.value = presetNum;
		box.value = cents;
		channels.map(c => c.setVibratoDepth(cents));
	}
});

document.getElementById('vibrato').addEventListener('input', function (event) {
	const cents = parseFloat(this.value);
	if (!Number.isFinite(cents)) {
		return;
	}
	document.getElementById('vibrato-slider').value = centsToVibratoPreset(cents);
	channels.map(c => c.setVibratoDepth(cents));
});

function getOperator(element) {
	while (element !== null) {
		if ('operator' in element.dataset) {
			return parseInt(element.dataset.operator);
		}
		element = element.parentElement;
	}
}

function setFrequencyMultiple(event) {
	initialize();
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		const opNum = getOperator(this);
		channels.map(c => c.setFrequencyMultiple(opNum, value, 0));
	}
}

let domParser = new DOMParser();

function createOperatorPage(n) {
	const li = document.createElement('LI');
	li.className = 'nav-item';
	const anchor = document.createElement('A');
	anchor.innerHTML = 'Operator ' + n;
	anchor.className = 'nav-link';
	const id = 'operator-' + n + '-tab';
	anchor.id = id;
	anchor.dataset.toggle = 'tab';
	anchor.href = '#operator-' + n;
	li.appendChild(anchor);
	document.getElementById('instrument-tablist').appendChild(li);

	let html = document.getElementById('operator-template').innerHTML;
	html = html.replace(/\$/g, n);
	const doc = domParser.parseFromString(html, 'text/html');
	doc.getElementById('op' + n + '-multiple-preset').addEventListener('input', setFrequencyMultiple);
	document.getElementById('instrument-tabs').append(doc.body.children[0]);
}

createOperatorPage(1);
createOperatorPage(2);
createOperatorPage(3);
createOperatorPage(4);
domParser = undefined;
