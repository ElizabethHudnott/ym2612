import {PROCESSING_TIME, LFO_FREQUENCIES, VIBRATO_PRESETS} from './sound/common.js';
import GenesisSound from './sound/genesis.js';
import YM2612 from './sound/ym2612.js';
import {OscillatorConfig, Waveform} from './sound/waveforms.js';
import {PitchBend, VolumeAutomation} from './sound/bend.js';
import MusicInput from './sound/input.js';
const NUM_CHANNELS = 6;
window.MUSIC_INPUT = new MusicInput();
for (let i = 2; i <= NUM_CHANNELS; i++) {
	MUSIC_INPUT.armChannel(i);
}
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
window.eachChannel = eachChannel;
window.OscillatorConfig = OscillatorConfig;
window.PitchBend = PitchBend;
window.VolumeAutomation = VolumeAutomation;

const VIBRATO_RANGES = [5, 10, 20, 50, 100, 400, 700]
let vibratoRange = 100;
let tremoloRangeNum = 1;
let glideRate = 0;

MUSIC_INPUT.pitchChange = function (timeStamp, channelNum, note, velocity, glide, glideFrom) {
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	const channel = synth.getChannel(channelNum);
	if (glide) {
		if (glideFrom !== undefined) {
			// Polyphonic glide from last overall note, not last note played on the particular channel.
			channel.setMIDINote(glideFrom, time, 0);
		}
		channel.setMIDINote(note, time, glideRate);
	} else {
		channel.setMIDINote(note, time, 0);
	}

	if (velocity > 0) {
		channel.keyOn(audioContext, velocity, time);
		soundSystem.applyFilter();
	}
};

MUSIC_INPUT.noteOff = function (timeStamp, channelNum) {
	synth.getChannel(channelNum).keyOff(audioContext);
};

MUSIC_INPUT.controlChange = function (timeStamp, controller, value) {
	let computedValue;
	switch (controller) {
	case 5:	// Portamento time
		glideRate = Math.min(value, 99);
		break;
	case 10:	// Pan
		const pan = (value - 64) / (value <= 64 ? 64 : 63);
		eachChannel(channel => channel.setPan(pan));
		break;
	case 71:
		eachChannel(channel => channel.useFeedbackPreset(value * 6 / 127));
		break;
	case 92:
		computedValue = compoundTremoloDepth(value);
		eachChannel(channel => channel.setTremoloDepth(computedValue));
		break;
	}
}

function compoundTremoloDepth(depth) {
	let scaledDepth = depth;
	if (scaledDepth > 0 && tremoloRangeNum < 3) {
		scaledDepth += 0.5;
	}
	scaledDepth *= 2 ** (tremoloRangeNum - 1);
	scaledDepth = -scaledDepth;
	return scaledDepth;
}

document.getElementById('btn-enable-midi').addEventListener('click', function (event) {
	const midiPanel = this.parentElement.parentElement;
	switch (MIDI.status) {
	case MIDI.Status.UNSUPPORTED:
		alert('Your browser doesn\'t support MIDI.');
		return;
	case MIDI.Status.PENDING:
		alert('You need to grant the page permission to use MIDI.')
		return;
	case MIDI.Status.GRANTED:
		$(midiPanel).find('.midi-controls').collapse('hide');
		document.getElementById('midi-led').classList.remove('on');
		MIDI.close();
		return;
	}
	function midiGranted() {
		document.getElementById('midi-led').classList.add('on');
		$(midiPanel).find('.midi-controls').collapse('show');
	}
	function midiRejected(error) {
		console.error(error);
		alert('The browser blocked access to MIDI.')
	}
	MIDI.requestAccess(midiGranted, midiRejected);

});

function midiOctaveShift(event) {
	MIDI.octaveShift += parseInt(this.value);
}

document.getElementById('btn-midi-octave-down').addEventListener('click', midiOctaveShift);
document.getElementById('btn-midi-octave-up').addEventListener('click', midiOctaveShift);

function processRecording(blob) {
	const player = document.getElementById('recording');
	if (player.src !== '') {
		URL.revokeObjectURL(player.src);
	}
	player.src = URL.createObjectURL(blob);
}
recorder.ondatarecorded = processRecording;

document.getElementById('btn-record-audio').addEventListener('click', function (event) {
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
	box.value = filterQ.toFixed(1);
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
	if (Math.abs(value) <= 158.5) {
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
	const free = document.getElementById('lfo-rate-free').checked;
	let frequency;
	if (free) {
		frequency = value;
	} else {
		frequency = LFO_FREQUENCIES[value] * synth.lfoRateMultiplier;
	}
	eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
	const precision = document.getElementById('fast-lfo').checked ? 1 : 2;
	document.getElementById('lfo-rate').value = frequency.toFixed(precision);
});

function configureLFOFreqSlider(fast, free) {
	const slider = document.getElementById('lfo-rate-slider');
	if (fast) {
		// Enable faster rates
		if (free) {
			slider.min = Math.round(LFO_FREQUENCIES[6] * synth.lfoRateMultiplier * 10) / 10;
			slider.max = Math.round(LFO_FREQUENCIES[8] * synth.lfoRateMultiplier * 10) / 10;
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
			slider.max = Math.round(LFO_FREQUENCIES[6] * synth.lfoRateMultiplier * 100) / 100;
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
		const fastThreshold = Math.ceil(LFO_FREQUENCIES[6] * synth.lfoRateMultiplier * 10) / 10;
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
	let precision;
	if (fast) {
		slider.value = slider.min;
		precision = 1;
	} else {
		slider.value = slider.max;
		precision = 2;
	}
	const frequency = free ? parseFloat(slider.value) : LFO_FREQUENCIES[6] * synth.lfoRateMultiplier;
	box.value = frequency.toFixed(precision);
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
		let delta = Number.MAX_VALUE;
		let presetNum;
		for (let i = 8; i >= 0; i--) {
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
		slider.value = presetNum;
		const frequency = LFO_FREQUENCIES[presetNum] * synth.lfoRateMultiplier;
		const precision = fast ? 1 : 2;
		box.value = frequency.toFixed(precision);
		eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
	}
});

/**The DX21 manual says that a value of 99 results in a delay of "approximately 15 seconds" and
 * a value of 70 takes 6.5 seconds. The rest is a leap of conjecture based on the fact that
 * non-linear relationships in Yamaha synths generally rely on exponentiation of 2 and some bit
 * shifting. An exponent of x/25 fits perfectly and 99/25 is very close to 127/32. I'm unsure
 * how the scale 1..99 gets mapped onto an internal scale of 1..127 in this case though. It
 * seems different from the calculation used for the operator output levels.
 */
function lfoDelayToSeconds(x) {
	return Math.sign(x) * (2 ** (Math.abs(x) / 32) - 0.5);
}

function lfoDelayToYamaha(time) {
	return time === 0 ? 0 : Math.log2(time + 0.5) * 32;
}

document.getElementById('lfo-delay-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const time = 7 / 13 * lfoDelayToSeconds(parseFloat(this.value));
	document.getElementById('lfo-delay').value = time.toFixed(2);
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
	document.getElementById('lfo-fade').value = time.toFixed(2);
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
	document.getElementById('lfo-fade').value = time.toFixed(2);
	eachChannel(channel => channel.setLFOFade(time));
}

document.getElementById('lfo-fade-in').addEventListener('input', lfoFadeDirection);
document.getElementById('lfo-fade-out').addEventListener('input', lfoFadeDirection);

document.getElementById('vibrato-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	const free = document.getElementById('vibrato-free').checked;
	const box = document.getElementById('vibrato');
	let cents;
	if (free) {
		const sign = firstChannel.getVibratoDepth() < 0 ? -1 : 1;
		cents = sign * value / 127 * vibratoRange;
		const precision = vibratoRange < 20 ? 1 : 0;
		box.value = cents.toFixed(precision);
	} else {
		cents = VIBRATO_PRESETS[value];
		box.value = cents;
	}
	eachChannel(channel => channel.setVibratoDepth(cents));
});

document.getElementById('vibrato-free').addEventListener('input', function (event) {
	audioContext.resume();
	const slider = document.getElementById('vibrato-slider');
	const box = document.getElementById('vibrato');
	const free = this.checked;
	const rangeSlider = document.getElementById('vibrato-range');
	const label = document.getElementById('vibrato-max');
	box.disabled = !free;
	if (free) {
		const cents = VIBRATO_PRESETS[parseInt(slider.value)];
		let rangeNum;
		if (cents === 0) {
			rangeNum = 4;
		} else {
			rangeNum = -1;
			do {
				rangeNum++;
				vibratoRange = VIBRATO_RANGES[rangeNum];
			} while (vibratoRange <= cents);
		}
		slider.max = 127;
		slider.value = cents / vibratoRange * 127;
		rangeSlider.value = rangeNum + 1;
		label.innerHTML = vibratoRange;
		rangeSlider.parentElement.classList.add('show');
		label.parentElement.classList.add('show');
	} else {
		let cents = Math.abs(firstChannel.getVibratoDepth());
		let presetNum = -1, presetValue;
		do {
			presetNum++;
			presetValue = VIBRATO_PRESETS[presetNum];
		} while (cents > presetValue && presetNum < VIBRATO_PRESETS.length - 1);
		if (presetNum > 0) {
			const lowerCents = VIBRATO_PRESETS[presetNum - 1];
			const upperCents = VIBRATO_PRESETS[presetNum];
			if (cents - lowerCents < upperCents - cents) {
				presetNum--;
			}
		}
		cents = VIBRATO_PRESETS[presetNum];
		slider.max = VIBRATO_PRESETS.length - 1;
		slider.value = presetNum;
		box.value = cents;
		rangeSlider.parentElement.classList.remove('show');
		label.parentElement.classList.remove('show');
		eachChannel(channel => channel.setVibratoDepth(cents));
		vibratoRange = 100;
	}
});

document.getElementById('vibrato').addEventListener('input', function (event) {
	const cents = parseFloat(this.value);
	if (Number.isFinite(cents)) {
		const absCents = Math.abs(cents);
		let rangeNum = -1;
		do {
			rangeNum++;
			vibratoRange = VIBRATO_RANGES[rangeNum];
		} while (vibratoRange <= absCents);
		document.getElementById('vibrato-slider').value = absCents / vibratoRange * 127;
		document.getElementById('vibrato-range').value = rangeNum + 1
		eachChannel(channel => channel.setVibratoDepth(cents));
	}
});

document.getElementById('vibrato-range').addEventListener('input', function (event) {
	let cents = firstChannel.getVibratoDepth();
	vibratoRange = VIBRATO_RANGES[parseInt(this.value) - 1];
	document.getElementById('vibrato-max').innerHTML = vibratoRange;
	const slider = document.getElementById('vibrato-slider');
	if (Math.abs(cents) > vibratoRange) {
		slider.value = 127;
		cents = Math.sign(cents) * vibratoRange;
		document.getElementById('vibrato').value = cents;
		eachChannel(channel => channel.setVibratoDepth(cents));
	} else {
		slider.value = cents / vibratoRange * 127;
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
		freqNum = firstChannel.getOperator(opNum).getFrequencyNumber();
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
	const precision = document.getElementById('op' + opNum + '-rates-free').checked ? 1 : 0;
	document.getElementById('op' + opNum + '-attack').value = value.toFixed(precision);
	eachChannel(channel => channel.getOperator(opNum).setAttack(value));
}

function decaySlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	const precision = document.getElementById('op' + opNum + '-rates-free').checked ? 1 : 0;
	document.getElementById('op' + opNum + '-decay').value = value.toFixed(precision);
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
	const precision = document.getElementById('op' + opNum + '-rates-free').checked ? 1 : 0;
	document.getElementById('op' + opNum + '-sustain-rate').value = value.toFixed(precision);
	eachChannel(channel => channel.getOperator(opNum).setSustainRate(value));
}

function releaseSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const value = parseFloat(this.value);
	const precision = document.getElementById('op' + opNum + '-rates-free').checked ? 2 : 0;
	document.getElementById('op' + opNum + '-release').value = value.toFixed(precision);
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
