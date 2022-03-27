import {LFO_FREQUENCIES, VIBRATO_PRESETS} from './sound/common.js';
import GenesisSound from './sound/genesis.js';
import YM2612 from './sound/ym2612.js';
import {logToLinear, linearToLog, OscillatorConfig} from './sound/opn2.js';
import {PitchBend} from './sound/bend.js';

function initialize() {
	if (window.audioContext !== undefined) {
		return;
	}
	const context = new AudioContext();
	window.audioContext = context;
	const soundSystem = new GenesisSound(context);
	window.soundSystem = soundSystem;
	window.synth = soundSystem.fm;
	window.channel = synth.getChannel(1);
	window.psg = soundSystem.psg;
	window.ym2612 = new YM2612(soundSystem.fm, context);
	window.OscillatorConfig = OscillatorConfig;
	window.PitchBend = PitchBend;

	soundSystem.start(context.currentTime + 0.02);
	synth.setChannelGain(6);
}

document.body.addEventListener('keydown', function (event) {
	initialize();
	if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.activeElement.type === 'number') {
		return;
	}
	channel.keyOn(audioContext);
	soundSystem.applyFilter();
});

document.body.addEventListener('keyup', function (event) {
	initialize();
	channel.keyOff(audioContext.currentTime + 0.02);
});

let filterFrequency, filterQ;

document.getElementById('filter-enable').addEventListener('input', function (event) {
	initialize();
	if (this.checked) {
		soundSystem.setFilterCutoff(filterFrequency);
		soundSystem.setFilterResonance(filterQ);
	} else {
		filterFrequency = soundSystem.getFilterCutoff();
		soundSystem.setFilterCutoff(21050);
		filterQ = soundSystem.getFilterResonance();
		soundSystem.setFilterResonance(0);
	}
});

document.getElementById('filter-cutoff-slider').addEventListener('input', function (event) {
	initialize();
	filterFrequency = parseInt(this.value);
	const box = document.getElementById('filter-cutoff');
	box.value = filterFrequency;
	soundSystem.setFilterCutoff(filterFrequency);
});

document.getElementById('filter-cutoff').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	if (value >= 0) {
		document.getElementById('filter-cutoff-slider').value = value;
		soundSystem.setFilterCutoff(value);
		filterFrequency = value;
	}
});

document.getElementById('filter-q-slider').addEventListener('input', function (event) {
	initialize();
	filterQ = parseFloat(this.value);
	const box = document.getElementById('filter-q');
	box.value = filterQ;
	soundSystem.setFilterResonance(filterQ);
});

document.getElementById('filter-q').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	if (value >= -770.63678 && value <= 770.63678) {
		document.getElementById('filter-q-slider').value = value;
		soundSystem.setFilterResonance(value);
		filterQ = value;
	}
});

function updateAlgorithmDetails() {
	for (let i = 1; i <= 3; i++) {
		for (let j = i + 1; j <= 4; j++) {
			const depth = channel.getModulationDepth(i, j);
			const box = document.getElementById('modulation-' + i + '-' + j);
			box.value = depth * 100;
		}
	}
	let total = 0;
	for (let i = 1; i <= 4; i++) {
		const operator = channel.getOperator(i);
		if (!operator.disabled) {
			const outputLevel = operator.getVolume();
			total += outputLevel;
			const box = document.getElementById('output-level-' + i);
			box.value = Math.round(linearToLog(outputLevel) / 1.023) / 10;
		}
	}
	const overdrive = Math.trunc(Math.max(total - 1, 0) * 10) / 10;
	document.getElementById('overdrive').value = overdrive;
}

function algorithmRadio(event) {
	initialize();
	for (let i = 1; i <=4; i++) {
		const checkbox = document.getElementById('op' + i + '-enabled');
		if (!checkbox.checked) {
			checkbox.click();
		}
	}
	const algorithmNumber = parseInt(this.id.slice(-1));
	channel.useAlgorithm(algorithmNumber);
	setTimeout(updateAlgorithmDetails, 20);
}

for (let i = 0; i <= 8; i++) {
	document.getElementById('algorithm-' + i).addEventListener('click', algorithmRadio);
}

function modulationDepth(event) {
	const value = parseFloat(this.value) / 100;
	if (Number.isFinite(value)) {
		const id = this.id;
		const from = parseInt(id.slice(-3));
		const to = parseInt(id.slice(-1));
		channel.setModulationDepth(from, to, value);
	}
}

for (let i = 1; i <= 3; i++) {
	for (let j = i + 1; j <= 4; j++) {
		document.getElementById('modulation-' + i + '-' + j).addEventListener('input', modulationDepth);
	}
}

function outputLevel() {
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		const opNum = parseInt(this.id.slice(-1));
		const volume = logToLinear(value * 10.23);
		channel.getOperator(opNum).setVolume(volume);
	}
}

for (let i = 1; i <= 4; i++) {
	document.getElementById('output-level-' + i).addEventListener('input', outputLevel);
}

function normalizeLevels(overdrive = 0) {
	initialize();
	const operators = new Array(4);
	const currentLevels = new Array(4);
	let total = 0;
	for (let i = 0; i < 4; i++) {
		const operator = channel.getOperator(i + 1);
		operators[i] = operator;
		if (!operator.disabled) {
			const outputLevel = operator.getVolume();
			currentLevels[i] = outputLevel;
			total += Math.abs(outputLevel);
		}
	}
	if (total === 0) {
		total = 1;
	}
	total *= 1 + Math.abs(channel.getPan());

	for (let i = 0; i < 4; i++) {
		const operator = operators[i];
		if (!operator.disabled) {
			const outputLevel = (overdrive + 1) * currentLevels[i] / total;
			operator.setVolume(outputLevel);
			const box = document.getElementById('output-level-' + String(i + 1));
			box.value = Math.trunc(linearToLog(outputLevel) / 1.023) / 10;
		}
	}
}

document.getElementById('overdrive').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 0) {
		normalizeLevels(value);
	}
});

document.getElementById('btn-normalize-levels').addEventListener('click', function (event) {
	normalizeLevels();
	document.getElementById('overdrive').value = 0;
});

document.getElementById('lfo-rate-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	const fast = document.getElementById('fast-lfo').checked;
	const free = document.getElementById('lfo-rate-free').checked;
	let frequency;
	if (free) {
		frequency = value;
	} else {
		frequency = value === 0 ? 0 : LFO_FREQUENCIES[value - 1] * synth.lfoRateMultiplier;
	}
	channel.setLFORate(audioContext, frequency);
	document.getElementById('lfo-rate').value = Math.round(frequency * 100) / 100;
});

function configureLFOFreqSlider(fast, free) {
	const slider = document.getElementById('lfo-rate-slider');
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

document.getElementById('lfo-rate').addEventListener('input', function (event) {
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
		document.getElementById('lfo-rate-slider').value = value;
		channel.setLFORate(audioContext, value);
	}
});

document.getElementById('fast-lfo').addEventListener('input', function (event) {
	initialize();
	const slider = document.getElementById('lfo-rate-slider');
	const box = document.getElementById('lfo-rate');
	const fast = this.checked;
	const free = document.getElementById('lfo-rate-free').checked;
	configureLFOFreqSlider(fast, free);
	if (fast) {
		slider.value = slider.min;
	} else {
		slider.value = slider.max;
	}
	const frequency = free ? parseFloat(slider.value) : LFO_FREQUENCIES[5] * synth.lfoRateMultiplier;
	box.value = Math.round(frequency * 100) / 100;
	channel.setLFORate(audioContext, frequency);
});

document.getElementById('lfo-rate-free').addEventListener('input', function (event) {
	initialize();
	const slider = document.getElementById('lfo-rate-slider');
	const box = document.getElementById('lfo-rate');
	const value = channel.getLFORate();
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
		channel.useLFOPreset(audioContext, presetNum);
	}
});

document.getElementById('lfo-delay-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	document.getElementById('lfo-delay').value = value;
	channel.setLFODelay(value);
});

document.getElementById('lfo-delay').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	if (value >= 0) {
		document.getElementById('lfo-delay-slider').value = value;
		channel.setLFODelay(value);
	}
});

document.getElementById('lfo-attack-slider').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	document.getElementById('lfo-attack').value = value;
	channel.setLFOAttack(value);
});

document.getElementById('lfo-attack').addEventListener('input', function (event) {
	initialize();
	const value = parseFloat(this.value);
	if (value >= 0) {
		document.getElementById('lfo-attack-slider').value = value;
		channel.setLFOAttack(value);
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
		const sign = channel.getVibratoDepth() < 0 ? -1 : 1;
		cents = sign * vibratoPresetToCents(value);
	} else {
		cents = VIBRATO_PRESETS[value];
	}
	box.value = Math.round(cents * 10) / 10;
	channel.setVibratoDepth(cents);
});

document.getElementById('vibrato-free').addEventListener('input', function (event) {
	initialize();
	const slider = document.getElementById('vibrato-slider');
	const box = document.getElementById('vibrato');
	const free = this.checked;
	box.disabled = !free;
	if (free) {
		slider.step = 0.02;
	} else {
		let cents = Math.abs(channel.getVibratoDepth());
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
		channel.setVibratoDepth(cents);
	}
});

document.getElementById('vibrato').addEventListener('input', function (event) {
	const cents = parseFloat(this.value);
	if (!Number.isFinite(cents)) {
		return;
	}
	document.getElementById('vibrato-slider').value = centsToVibratoPreset(cents);
	channel.setVibratoDepth(cents);
});

function getOperator(element) {
	while (element !== null) {
		if ('operator' in element.dataset) {
			return parseInt(element.dataset.operator);
		}
		element = element.parentElement;
	}
}

function waveformNumber(event) {
	initialize();
	const opNum = getOperator(this);
	const dropDown = document.getElementById('btn-op' + opNum + '-waveform');
	const dropDownImage = dropDown.children[0];
	const dropDownText = dropDown.children[1];
	const value = parseInt(this.value);
	const option = this.parentElement;
	const imageLabel = option.children[1];
	if (imageLabel) {
		dropDownText.innerHTML = '';
		dropDownImage.src = imageLabel.src;
		dropDownImage.classList.remove('d-none');
	} else {
		dropDownImage.classList.add('d-none');
		dropDownText.innerHTML = option.textContent.trim();
	}
	channel.getOperator(opNum).setWaveformNumber(audioContext, value, audioContext.currentTime + 0.02);
}

function frequencyMultipleSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum;
	let value = parseFloat(this.value);
	if (value === 0) {
		const free = document.getElementById(opStr + '-multiple-free').checked;
		if (!free) {
			value = 0.5;
		}
	}
	document.getElementById(opStr + '-freq-unfixed').checked = true;
	document.getElementById(opStr + '-multiple').value = value;
	channel.fixFrequency(opNum, false);
	channel.setFrequencyMultiple(opNum, value, 0)
}

function frequencyMultiple(event) {
	const opNum = getOperator(this);
	const valueStr = this.value;
	let numerator = parseFloat(valueStr);
	if (!(numerator >= 0)) {
		return;
	}
	let denominator = 1;
	const slashIndex = valueStr.indexOf('/');
	if (slashIndex !== -1) {
		denominator = parseInt(valueStr.slice(slashIndex + 1));
		if (!(denominator > 0)) {
			return;
		}
	}
	const value = numerator / denominator;
	document.getElementById('op' + opNum + '-freq-unfixed').checked = true;
	document.getElementById('op' + opNum + '-multiple-slider').value = value;
	channel.fixFrequency(opNum, false);
	channel.setFrequencyMultiple(opNum, value, 0);
}

function frequencyFreeMultiple(event) {
	initialize();
	const opNum = getOperator(this);
	const slider = document.getElementById('op' + opNum + '-multiple-slider');
	const box = document.getElementById('op' + opNum + '-multiple');
	let value = channel.getFrequencyMultiple(opNum);
	box.disabled = !this.checked;
	if (this.checked) {
		slider.step = 0.1;
		if (value < 1) {
			slider.value = value; // 0..1 on the slider represent those exact values.
		}
		return;
	}
	slider.step = 1;
	if (value < 0.75) {
		value = 0.5;
	} else if (value > 15) {
		value = 15;
	} else {
		value = Math.round(value);
	}
	slider.value = value === 0.5 ? 0 : value;	// 0 on the slider represents 0.5.
	box.value = value;
	if (document.getElementById('op' + opNum + '-freq-unfixed').checked) {
		channel.setFrequencyMultiple(opNum, value, 0);
	}
}

function frequency(event) {
	initialize();
	const opNum = getOperator(this);
	document.getElementById('op' + opNum + '-freq-fixed').checked = true;
	const block = parseInt(document.getElementById('op' + opNum + '-block').value);
	let freqNum = parseInt(document.getElementById('op' + opNum + '-freq-num').value);
	if (!(freqNum >= 0 && freqNum <= 2047)) {
		freqNum = channel.getOperator(opNum).getFrequencyNumber();
	}
	channel.fixFrequency(opNum, true);
	channel.setOperatorFrequency(opNum, block, freqNum);
}

function rateScaleSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-rate-scale').value = value;
	channel.getOperator(opNum).setRateScaling(value);
}

function rateScale(event) {
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		document.getElementById('op' + opNum + '-rate-scale-slider').value = value;
		channel.getOperator(opNum).setRateScaling(value);
	}
}

function rateScaleFree(event) {
	initialize();
	const opNum = getOperator(this);
	const slider = document.getElementById('op' + opNum + '-rate-scale-slider');
	const box = document.getElementById('op' + opNum + '-rate-scale');
	const free = this.checked;
	box.disabled = !free;
	if (free) {
		slider.step = 0.05;
	} else {
		let scaling = Math.round(channel.getOperator(opNum).getRateScaling());
		if (scaling > 3) {
			scaling = 3;
		} else if (scaling < 0) {
			scaling = 0;
		}
		slider.step = 1;
		slider.value = scaling;
		box.value = scaling;
		channel.getOperator(opNum).setRateScaling(scaling);
	}
}

function attackSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-attack').value = value;
	channel.getOperator(opNum).setAttack(value);
}

function decaySlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-decay').value = value;
	channel.getOperator(opNum).setDecay(value);
}

function sustainSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-sustain').value = value;
	channel.getOperator(opNum).setSustain(value);
}

function sustain(event) {
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	if (value >= 0 && value <= 16) {
		document.getElementById('op' + opNum + '-sustain-slider').value = value;
		channel.getOperator(opNum).setSustain(value);
	}
}

function sustainRateSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-sustain-rate').value = value;
	channel.getOperator(opNum).setSustainRate(value);
}

function sustainFree(event) {
	initialize();
	const opNum = getOperator(this);
	const slider = document.getElementById('op' + opNum + '-sustain-slider');
	const box = document.getElementById('op' + opNum + '-sustain');
	const free = this.checked;
	box.disabled = !free;
	if (free) {
		slider.step = 0.04;
	} else {
		const sustain = Math.round(channel.getOperator(opNum).getSustain());
		slider.step = 1;
		slider.value = sustain;
		box.value = sustain;
		channel.getOperator(opNum).setSustain(sustain);
	}
}

function releaseSlider(event) {
	initialize();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-release').value = value;
	channel.getOperator(opNum).setRelease(value);
}

function releaseFree(event) {
	initialize();
	const opNum = getOperator(this);
	const slider = document.getElementById('op' + opNum + '-release-slider');
	const box = document.getElementById('op' + opNum + '-release');
	const free = this.checked;
	if (free) {
		slider.step = 0.5;
	} else {
		slider.step = 1;
		const value = parseInt(slider.value);
		box.value = value;
		channel.getOperator(opNum).setRelease(value);
	}
}

let domParser = new DOMParser();

function createOperatorPage(n) {
	const li = document.createElement('LI');
	li.className = 'nav-item operator-' + n;
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
	const opStr = 'op' + n;
	doc.getElementById(opStr + '-multiple-slider').addEventListener('input', frequencyMultipleSlider);
	doc.getElementById(opStr + '-multiple').addEventListener('input', frequencyMultiple);
	doc.getElementById(opStr + '-multiple-free').addEventListener('input', frequencyFreeMultiple);
	doc.getElementById(opStr + '-block').addEventListener('input', frequency);
	doc.getElementById(opStr + '-freq-num').addEventListener('input', frequency);
	doc.getElementById(opStr + '-rate-scale-slider').addEventListener('input', rateScaleSlider);
	doc.getElementById(opStr + '-rate-scale').addEventListener('input', rateScale);
	doc.getElementById(opStr + '-rate-scale-free').addEventListener('input', rateScaleFree);
	doc.getElementById(opStr + '-attack-slider').addEventListener('input', attackSlider);
	doc.getElementById(opStr + '-decay-slider').addEventListener('input', decaySlider);
	doc.getElementById(opStr + '-sustain-slider').addEventListener('input', sustainSlider);
	doc.getElementById(opStr + '-sustain').addEventListener('input', sustain);
	doc.getElementById(opStr + '-sustain-free').addEventListener('input', sustainFree);
	doc.getElementById(opStr + '-sustain-rate-slider').addEventListener('input', sustainRateSlider);
	doc.getElementById(opStr + '-release-slider').addEventListener('input', releaseSlider);
	doc.getElementById(opStr + '-release-free').addEventListener('input', releaseFree);

	for (let element of doc.querySelectorAll(`input[name="${opStr}-waveform"]`)) {
		element.addEventListener('input', waveformNumber);
	}

	document.getElementById('instrument-tabs').append(doc.body.children[0]);
}

createOperatorPage(1);
createOperatorPage(2);
createOperatorPage(3);
createOperatorPage(4);
domParser = undefined;

function enableOperator(event) {
	const opNum = parseInt(this.id[2]);
	for (let i = opNum + 1; i <= 4; i++) {
		document.getElementById('modulation-' + opNum + '-' + i).value = 0;
	}
	for (let elem of document.getElementsByClassName('operator-' + opNum)) {
		elem.hidden = false;
	}
	const volumeBox = document.getElementById('output-level-' + opNum);
	const volume = logToLinear(parseFloat(volumeBox.value) * 10.23) || 1;
	channel.enableOperator(opNum, volume);
	setTimeout(updateAlgorithmDetails, 20);
}

function disableOperator(event) {
	initialize();
	const opNum = parseInt(this.id[2]);
	channel.disableOperator(opNum);
	for (let elem of document.getElementsByClassName('operator-' + opNum)) {
		elem.hidden = true;
	}
	setTimeout(updateAlgorithmDetails, 20);
}

for (let i = 1; i <=4; i++) {
	document.getElementById('op' + i + '-enabled').addEventListener('input', enableOperator);
	document.getElementById('op' + i + '-disabled').addEventListener('input', disableOperator);
}


window.drawWaveform = function (waveform, canvasContext, numCycles = 1) {
	const width = canvasContext.canvas.width;
	const height = canvasContext.canvas.height;
	const imageData = canvasContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	const sampleLength = waveform.length;
	const length = sampleLength * numCycles;
	const halfHeight = (height - 1) / 2 - 1;
	let x = 0, total = 0, numSamples = 0, prevY;

	const brightness = 64;
	const shadowBrightness = 0;

	function fillPixel(x, y) {
		let offset = 4 * (y * width + x);
		pixels[offset] = 255;
		pixels[offset + 1] = brightness;
		pixels[offset + 2] = brightness;
		pixels[offset + 3] = 255;
	}

	for (let i = 0; i < length; i++) {
		const newX = Math.trunc(i / length * width);
		if (newX >= x + 1) {
			const average = total / numSamples;
			const pixelY = height - Math.round(average * halfHeight + halfHeight + 1.5);
			if (x > 0) {
				const dir = Math.sign(pixelY - prevY);
				for (let y = prevY; y != pixelY; y += dir) {
					fillPixel(x - 1, y);
				}
			}
			fillPixel(x, pixelY);

			total = 0;
			numSamples = 0;
			x = newX;
			prevY = pixelY;
		}
		total += waveform[i % sampleLength];
		numSamples++;
	}
	canvasContext.putImageData(imageData, 0, 0);
}
