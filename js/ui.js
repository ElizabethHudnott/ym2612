import {PROCESSING_TIME, LFO_FREQUENCIES, VIBRATO_PRESETS} from './sound/common.js';
import GenesisSound from './sound/genesis.js';
import YM2612 from './sound/ym2612.js';
import {OscillatorConfig, Waveform} from './sound/waveforms.js';
import {PitchBend, VolumeAutomation} from './sound/bend.js';
import MusicInput from './sound/input.js'
window.MUSIC_INPUT = new MusicInput(6);
MUSIC_INPUT.setChannelRange(1, 6);
import './sound/keyboard.js';
import MIDI from './sound/midi.js';
import Recorder from './sound/recorder.js';

const audioContext = new AudioContext({latencyHint: 'interactive'});
const soundSystem = new GenesisSound(audioContext);
soundSystem.start(audioContext.currentTime + PROCESSING_TIME);
const synth = soundSystem.fm;
const psg = soundSystem.psg;
const recorder = new Recorder(audioContext);
recorder.connectIn(soundSystem.filter);

const firstChannel = synth.getChannel(1);

function eachChannel(callback) {
	synth.channels.forEach(callback);
}

eachChannel(channel => channel.useAlgorithm(4));
disableOperator(3);
disableOperator(4);

window.audioContext = audioContext;
window.soundSystem = soundSystem;
window.recorder = recorder;
window.synth = synth;
window.psg = psg;
window.ym2612 = new YM2612(soundSystem.fm, audioContext);
window.OscillatorConfig = OscillatorConfig;
window.PitchBend = PitchBend;
window.VolumeAutomation = VolumeAutomation;

let portamentoRate = 0;	// in seconds per note

MUSIC_INPUT.pitchChange = function (timeStamp, channelNum, fromNote, toNote, velocity) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const channel = synth.getChannel(channelNum);
	if (fromNote === undefined || portamentoRate === 0) {
		channel.setMIDINote(toNote);
	} else if (fromNote !== toNote) {
		const portamentoTime = Math.abs(toNote - fromNote) * portamentoRate;
		channel.setMIDINote(fromNote, time);
		channel.setMIDINote(toNote, time + portamentoTime, 'exponentialRampToValueAtTime');
	}
	if (velocity > 0) {
		channel.keyOn(audioContext, velocity, time);
		soundSystem.applyFilter();
	}
};

MUSIC_INPUT.noteOff = function (timeStamp, channelNum) {
	synth.getChannel(channelNum).keyOff(audioContext);
};


document.getElementById('btn-enable-midi').addEventListener('click', function (event) {
	switch (MIDI.status) {
	case MIDI.Status.UNSUPPORTED:
		alert('Your browser doesn\'t support MIDI.');
		return;
	case MIDI.Status.PENDING:
		alert('You need to grant the page permission to use MIDI.')
		return;
	case MIDI.Status.GRANTED:
		document.getElementById('midi-led').classList.remove('on');
		MIDI.close();
		return;
	}
	function midiGranted() {
		document.getElementById('midi-led').classList.add('on');
	}
	function midiRejected(error) {
		console.error(error);
		alert('The browser blocked access to MIDI.')
	}
	MIDI.requestAccess(midiGranted, midiRejected);

});

function processRecording(blob) {
	const player = document.getElementById('recording');
	if (player.src !== '') {
		URL.revokeObjectURL(player.src);
	}
	player.src = URL.createObjectURL(blob);
}
recorder.ondatarecorded = processRecording;

document.getElementById('btn-record').addEventListener('click', function (event) {
	audioContext.resume();
	switch (recorder.state) {
	case 'inactive':
		recorder.start();
		break;
	case 'recording':
		recorder.pause();
		recorder.requestAudio();
		break;
	case 'paused':
		recorder.resume();
		break;
	}
});

let filterFrequency, filterQ;

document.getElementById('filter-enable').addEventListener('input', function (event) {
	audioContext.resume();
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
	audioContext.resume();
	filterFrequency = parseInt(this.value);
	const box = document.getElementById('filter-cutoff');
	box.value = filterFrequency;
	soundSystem.setFilterCutoff(filterFrequency);
});

document.getElementById('filter-cutoff').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseFloat(this.value);
	if (value >= 0) {
		document.getElementById('filter-cutoff-slider').value = value;
		soundSystem.setFilterCutoff(value);
		filterFrequency = value;
	}
});

document.getElementById('filter-q-slider').addEventListener('input', function (event) {
	audioContext.resume();
	filterQ = parseFloat(this.value);
	const box = document.getElementById('filter-q');
	box.value = filterQ;
	soundSystem.setFilterResonance(filterQ);
});

document.getElementById('filter-q').addEventListener('input', function (event) {
	audioContext.resume();
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
			const depth = firstChannel.getModulationDepth(i, j);
			document.getElementById('modulation-' + i + '-' + j).value = depth;
		}
	}
	let total = 0;
	for (let i = 1; i <= 4; i++) {
		const operator = firstChannel.getOperator(i);
		if (!operator.disabled) {
			const gain = operator.getGain();
			total += Math.abs(gain);
			const box = document.getElementById('output-level-' + i);
			box.value = Math.round(operator.getOutputLevel() * 2) / 2;
		}
	}
	total *= 1 + Math.abs(firstChannel.getPan());
	let distortion = 20 * Math.log10(Math.max(total, 1));
	distortion = Math.trunc(distortion * 10) / 10;
	document.getElementById('distortion').value = distortion;
}

function algorithmRadio(event) {
	audioContext.resume();
	for (let i = 1; i <=4; i++) {
		const checkbox = document.getElementById('op' + i + '-enabled');
		if (!checkbox.checked) {
			checkbox.click();
		}
	}
	const algorithmNumber = parseInt(this.id.slice(-1));
	eachChannel(channel => {
		channel.useAlgorithm(algorithmNumber);
		channel.normalizeLevels()
	});
	updateAlgorithmDetails();
}

for (let i = 0; i <= 8; i++) {
	document.getElementById('algorithm-' + i).addEventListener('click', algorithmRadio);
}

function modulationDepth(event) {
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		const id = this.id;
		const from = parseInt(id.slice(-3));
		const to = parseInt(id.slice(-1));
		eachChannel(channel => channel.setModulationDepth(from, to, value));
	}
}

for (let i = 1; i <= 3; i++) {
	for (let j = i + 1; j <= 4; j++) {
		document.getElementById('modulation-' + i + '-' + j).addEventListener('input', modulationDepth);
	}
}

function outputLevel() {
	audioContext.resume();
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		const opNum = parseInt(this.id.slice(-1));
		eachChannel(channel => channel.getOperator(opNum).setOutputLevel(value));
	}
	updateAlgorithmDetails();
}

for (let i = 1; i <= 4; i++) {
	document.getElementById('output-level-' + i).addEventListener('input', outputLevel);
}

function normalizeLevels(distortion = 0) {
	audioContext.resume();
	eachChannel(channel => channel.normalizeLevels(distortion));

	for (let i = 1; i <= 4; i++) {
		const box = document.getElementById('output-level-' + i);
		box.value = Math.round(firstChannel.getOperator(i).getOutputLevel() * 2) / 2;
	}
}

document.getElementById('distortion').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 0) {
		normalizeLevels(value);
	}
});

document.getElementById('btn-normalize-levels').addEventListener('click', function (event) {
	normalizeLevels();
	document.getElementById('distortion').value = 0;
});

document.getElementById('lfo-rate-slider').addEventListener('input', function (event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const value = parseFloat(this.value);
	const fast = document.getElementById('fast-lfo').checked;
	const free = document.getElementById('lfo-rate-free').checked;
	let frequency;
	if (free) {
		frequency = value;
	} else {
		frequency = value === 0 ? 0 : LFO_FREQUENCIES[value - 1] * synth.lfoRateMultiplier;
	}
	eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
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
	const time = audioContext.currentTime + PROCESSING_TIME;
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
		eachChannel(channel => channel.setLFORate(audioContext, value, time));
	}
});

document.getElementById('fast-lfo').addEventListener('input', function (event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
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
	eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
});

document.getElementById('lfo-rate-free').addEventListener('input', function (event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const slider = document.getElementById('lfo-rate-slider');
	const box = document.getElementById('lfo-rate');
	const value = firstChannel.getLFORate();
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
		eachChannel(channel => channel.useLFOPreset(audioContext, presetNum, time));
	}
});

// From the DX21
const LFO_DELAY_CONSTANT = 25;

function lfoDelayToSeconds(x) {
	return Math.sign(x) * (2 ** (Math.abs(x) / LFO_DELAY_CONSTANT) - 0.5);
}

function lfoDelayToYamaha(time) {
	return time === 0 ? 0 : Math.log2(time + 0.5) * LFO_DELAY_CONSTANT;
}

document.getElementById('lfo-delay-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const time = 7 / 13 * lfoDelayToSeconds(parseFloat(this.value));
	document.getElementById('lfo-delay').value = Math.round(time * 100) / 100;
	eachChannel(channel => channel.setLFODelay(time));
});

document.getElementById('lfo-delay').addEventListener('input', function (event) {
	audioContext.resume();
	const time = parseFloat(this.value);
	if (time >= 0) {
		const sliderValue = lfoDelayToYamaha(time * 13 / 7);
		document.getElementById('lfo-delay-slider').value = sliderValue;
		eachChannel(channel => channel.setLFODelay(time));
	}
});

document.getElementById('lfo-fade-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const direction = document.getElementById('lfo-fade-in').checked ? 1 : -1;
	const time = direction * 6 / 13 * lfoDelayToSeconds(parseFloat(this.value));
	document.getElementById('lfo-fade').value = Math.round(time * 100) / 100;
	eachChannel(channel => channel.setLFOFade(time));
});

document.getElementById('lfo-fade').addEventListener('input', function (event) {
	audioContext.resume();
	const time = parseFloat(this.value);
	if (Number.isFinite(time)) {
		const sliderValue = lfoDelayToYamaha(Math.abs(time) * 13 / 6);
		document.getElementById('lfo-fade-slider').value = sliderValue;
		if (time > 0) {
			document.getElementById('lfo-fade-in').checked = true;
		} else if (time < 0) {
			document.getElementById('lfo-fade-out').checked = true;
		}
		eachChannel(channel => channel.setLFOFade(time));
	}
});

function lfoFadeDirection(event) {
	const duration = Math.abs(firstChannel.getLFOFade());
	const time = parseInt(this.value) * duration;
	document.getElementById('lfo-fade').value = Math.round(time * 100) / 100;
	document.getElementById('lfo-fade-slider').value = lfoDelayToYamaha(duration * 13 / 6);
	eachChannel(channel => channel.setLFOFade(time));
}

document.getElementById('lfo-fade-in').addEventListener('input', lfoFadeDirection);
document.getElementById('lfo-fade-out').addEventListener('input', lfoFadeDirection);

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
	audioContext.resume();
	const value = parseFloat(this.value);
	const free = document.getElementById('vibrato-free').checked;
	const box = document.getElementById('vibrato');
	let cents;
	if (free) {
		const sign = firstChannel.getVibratoDepth() < 0 ? -1 : 1;
		cents = sign * vibratoPresetToCents(value);
	} else {
		cents = VIBRATO_PRESETS[value];
	}
	box.value = Math.round(cents * 10) / 10;
	eachChannel(channel => channel.setVibratoDepth(cents));
});

document.getElementById('vibrato-free').addEventListener('input', function (event) {
	audioContext.resume();
	const slider = document.getElementById('vibrato-slider');
	const box = document.getElementById('vibrato');
	const free = this.checked;
	box.disabled = !free;
	if (free) {
		slider.step = 0.02;
	} else {
		let cents = Math.abs(firstChannel.getVibratoDepth());
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
		eachChannel(channel => channel.setVibratoDepth(cents));
	}
});

document.getElementById('vibrato').addEventListener('input', function (event) {
	const cents = parseFloat(this.value);
	if (Number.isFinite(cents)) {
		document.getElementById('vibrato-slider').value = centsToVibratoPreset(cents);
		eachChannel(channel => channel.setVibratoDepth(cents));
	}
});

function getOperator(element) {
	while (element !== null) {
		if ('operator' in element.dataset) {
			return parseInt(element.dataset.operator);
		}
		element = element.parentElement;
	}
}

function waveform(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const opNum = getOperator(this);
	const dropDown = document.getElementById('btn-op' + opNum + '-waveform');
	const dropDownImage = dropDown.children[0];
	const dropDownText = dropDown.children[1];
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
	const value = this.value.toUpperCase();
	const waveform = Waveform[value];
	eachChannel(channel => {
		const operator = channel.getOperator(opNum);
		operator.setWaveform(audioContext, waveform, time);
	});
}

function unfixFrequency(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const opNum = getOperator(this);
	document.getElementById('op' + opNum + '-freq-unfixed').checked = true;
	eachChannel(channel => channel.fixFrequency(opNum, false, time));
}

function frequencyMultipleSlider(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
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
	eachChannel(channel => {
		channel.setFrequencyMultiple(opNum, value, time);
		channel.fixFrequency(opNum, false, time);
	});
}

function frequencyMultiple(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
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
	eachChannel(channel => {
		channel.setFrequencyMultiple(opNum, value, time);
		channel.fixFrequency(opNum, false, time);
	});
}

function frequencyFreeMultiple(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const opNum = getOperator(this);
	const slider = document.getElementById('op' + opNum + '-multiple-slider');
	const box = document.getElementById('op' + opNum + '-multiple');
	let value = firstChannel.getFrequencyMultiple(opNum);
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
		eachChannel(channel => channel.setFrequencyMultiple(opNum, value, time));
	}
}

function frequency(event) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const opNum = getOperator(this);
	document.getElementById('op' + opNum + '-freq-fixed').checked = true;
	const block = parseInt(document.getElementById('op' + opNum + '-block').value);
	let freqNum = parseInt(document.getElementById('op' + opNum + '-freq-num').value);
	if (!(freqNum >= 0 && freqNum <= 2047)) {
		freqNum = channel.getOperator(opNum).getFrequencyNumber();
	}
	eachChannel(channel => {
		channel.fixFrequency(opNum, true, 0);
		channel.setOperatorFrequency(opNum, block, freqNum);
	});
}

function rateScaling(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseInt(this.value);
	document.getElementById('op' + opNum + '-rate-scale').value = value;
	eachChannel(channel => channel.getOperator(opNum).setRateScaling(value));
}

function attackSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-attack').value = value;
	eachChannel(channel => channel.getOperator(opNum).setAttack(value));
}

function decaySlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-decay').value = value;
	eachChannel(channel => channel.getOperator(opNum).setDecay(value));
}

function sustainSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-sustain').value = value;
	eachChannel(channel => channel.getOperator(opNum).setSustain(value));
}

function sustain(event) {
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	if (value >= 0 && value <= 16) {
		document.getElementById('op' + opNum + '-sustain-slider').value = value;
		eachChannel(channel => channel.getOperator(opNum).setSustain(value));
	}
}

function sustainRateSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-sustain-rate').value = value;
	eachChannel(channel => channel.getOperator(opNum).setSustainRate(value));
}

function releaseSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	document.getElementById('op' + opNum + '-release').value = value;
	eachChannel(channel => channel.getOperator(opNum).setRelease(value));
}

function ratesFree(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const idParts = ['attack', 'decay', 'sustain-rate', 'release'];
	const methods = ['setAttack', 'setDecay', 'setSustainRate', 'setRelease'];
	const precision = [0.5, 0.5, 0.5, 0.25];
	const free = this.checked;
	if (free) {
		for (let i = 0; i < idParts.length; i++) {
			const slider = document.getElementById('op' + opNum + '-' + idParts[i] +'-slider');
			slider.step = precision[i];
		}
	} else {
		for (let i = 0; i < methods.length; i++) {
			const id = 'op' + opNum + '-' + idParts[i];
			const box = document.getElementById(id);
			const slider = document.getElementById(id + '-slider');
			slider.step = 1;
			const value = parseInt(slider.value);
			box.value = value;
			eachChannel(channel => channel.getOperator(opNum)[methods[i]](value));
		}
	}
}

function levelsFree(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const free = this.checked;

	const tlSlider = document.getElementById('op' + opNum + '-total-level-slider');
	const tlBox = document.getElementById('op' + opNum + '-total-level');
	tlBox.disabled = !free;

	const sustainSlider = document.getElementById('op' + opNum + '-sustain-slider');
	const sustainBox = document.getElementById('op' + opNum + '-sustain');
	sustainBox.disabled = !free;

	if (free) {
		tlSlider.step = 0.5;
		sustainSlider.step = 1 / 16;
	} else {
		const totalLevel = Math.round(firstChannel.getOperator(opNum).getTotalLevel());
		tlSlider.step = 1;
		tlSlider.value = totalLevel > 127 ? totalLevel - 128 : totalLevel;
		tlBox.value = totalLevel;
		eachChannel(channel => channel.getOperator(opNum).setTotalLevel(totalLevel));

		const sustain = Math.round(firstChannel.getOperator(opNum).getSustain());
		sustainSlider.step = 1;
		sustainSlider.value = sustain;
		sustainBox.value = sustain;
		eachChannel(channel => channel.getOperator(opNum).setSustain(sustain));
	}
}

let domParser = new DOMParser();

function createOperatorPage(n) {
	const li = document.createElement('LI');
	li.className = 'nav-item operator-' + n;
	li.hidden = n > 2;
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
	doc.getElementById(opStr + '-freq-fixed').addEventListener('input', frequency);
	doc.getElementById(opStr + '-freq-unfixed').addEventListener('input', unfixFrequency);
	doc.getElementById(opStr + '-multiple-slider').addEventListener('input', frequencyMultipleSlider);
	doc.getElementById(opStr + '-multiple').addEventListener('input', frequencyMultiple);
	doc.getElementById(opStr + '-multiple-free').addEventListener('input', frequencyFreeMultiple);
	doc.getElementById(opStr + '-block').addEventListener('input', frequency);
	doc.getElementById(opStr + '-freq-num').addEventListener('input', frequency);
	doc.getElementById(opStr + '-rate-scale-slider').addEventListener('input', rateScaling);
	doc.getElementById(opStr + '-attack-slider').addEventListener('input', attackSlider);
	doc.getElementById(opStr + '-decay-slider').addEventListener('input', decaySlider);
	doc.getElementById(opStr + '-sustain-slider').addEventListener('input', sustainSlider);
	doc.getElementById(opStr + '-sustain').addEventListener('input', sustain);
	doc.getElementById(opStr + '-sustain-rate-slider').addEventListener('input', sustainRateSlider);
	doc.getElementById(opStr + '-release-slider').addEventListener('input', releaseSlider);
	doc.getElementById(opStr + '-rates-free').addEventListener('input', ratesFree);
	doc.getElementById(opStr + '-levels-free').addEventListener('input', levelsFree);

	for (let element of doc.querySelectorAll(`input[name="${opStr}-waveform"]`)) {
		element.addEventListener('input', waveform);
	}

	document.getElementById('instrument-tabs').append(doc.body.children[0]);
}

createOperatorPage(1);
createOperatorPage(2);
createOperatorPage(3);
createOperatorPage(4);
domParser = undefined;

function enableOperator(opNum) {
	for (let elem of document.getElementsByClassName('operator-' + opNum)) {
		elem.hidden = false;
	}
	eachChannel(channel => channel.enableOperator(opNum));
	updateAlgorithmDetails();
}

function disableOperator(opNum) {
	eachChannel(channel => channel.disableOperator(opNum));
	for (let elem of document.getElementsByClassName('operator-' + opNum)) {
		elem.hidden = true;
	}
	updateAlgorithmDetails();
}

function enableOperatorClick(event) {
	audioContext.resume();
	const opNum = parseInt(this.id.slice(2, 3));
	enableOperator(opNum);
}

function disableOperatorClick(event) {
	audioContext.resume();
	const opNum = parseInt(this.id.slice(2, 3));
	disableOperator(opNum);
}

for (let i = 1; i <=4; i++) {
	document.getElementById('op' + i + '-enabled').addEventListener('input', enableOperatorClick);
	document.getElementById('op' + i + '-disabled').addEventListener('input', disableOperatorClick);
}
