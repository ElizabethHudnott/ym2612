/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
import {queryChecked, checkInput} from './util.js';
import {
	ClockRate, VIBRATO_RANGES, VIBRATO_PRESETS, MICRO_TUNINGS,
	nextQuantum, getOctave, getNoteName, roundMicrotuning
} from './sound/common.js';
import Synth from './sound/fm-synth.js';
import GenesisSound from './sound/genesis.js';
import YM2612 from './sound/ym2612.js';
import {KeySync, Direction, FadeParameter, Pan, AbstractChannel} from './sound/fm-channel.js';
import {OscillatorFactory, Waveform, OscillatorTimbreFrame, HarmonicTimbreFrame} from './sound/waveforms.js';
import {PitchBend, VolumeAutomation} from './sound/bend.js';
import {Effects} from './sound/effect-commands.js';
import MusicInput from './sound/input.js';
const NUM_CHANNELS = 8;
window.MUSIC_INPUT = new MusicInput();
for (let i = 2; i <= NUM_CHANNELS; i++) {
	MUSIC_INPUT.armChannel(i);
}
import './sound/keyboard.js';
import MIDI from './sound/midi.js';
import {Phrase, Transform, Pattern, Player} from './sound/sequencer.js';
import Recorder from './sound/recorder.js';
import {parsePattern} from './storage/csv.js';

const tuningPrecision = 1024 / 12;	// SY-77 accuracy (see roundMicrotuning)

// Use a sample rate of Synth.sampleRate(ClockRate.NTSC, 15, 64) to more closely emulate OPM or
// match modern systems for less latency.
const audioContext = new AudioContext({latencyHint: 'interactive', sampleRate: 48000});
const soundSystem = new GenesisSound(audioContext, NUM_CHANNELS, 3, 0.5, ClockRate.NTSC, 60, 15, 64);
soundSystem.start(nextQuantum(audioContext));
const synth = soundSystem.fm;
const player = new Player(audioContext, synth);
const recorder = new Recorder(audioContext);
recorder.connectIn(soundSystem.compressor);

const firstChannel = synth.getChannel(1);

function eachChannel(callback) {
	synth.channels.forEach(callback);
}

eachChannel(channel => {
	channel.useAlgorithm(4)
	for (let opNum = 1; opNum <= 4; opNum++) {
		const operator = channel.getOperator(opNum);
		operator.setVelocitySensitivity(32);
		operator.setVelocityOffset(96);
		channel.enableTremolo(opNum);
	}
});
disableOperator(3);
disableOperator(4);

window.audioContext = audioContext;
window.soundSystem = soundSystem;
window.player = player;
window.recorder = recorder;
window.synth = synth;
window.psg = soundSystem.psg;
window.ym2612 = new YM2612(soundSystem.fm, audioContext);
window.eachChannel = eachChannel;
window.OscillatorFactory = OscillatorFactory;
window.Waveform = Waveform;
window.OscillatorTimbreFrame = OscillatorTimbreFrame;
window.HarmonicTimbreFrame = HarmonicTimbreFrame;
window.PitchBend = PitchBend;
window.VolumeAutomation = VolumeAutomation;
window.Effects = Effects;
window.Phrase = Phrase;
window.Transform = Transform;
window.Pattern = Pattern;
window.Player = Player;

let vibratoRange = 100;
const TREMOLO_RANGES = [63.5, 127.5, 255, 510, 1020];
let tremoloRangeNum = 0;

class InputHook {
	constructor() {
		this.callback = undefined;
		this.onrevoke = undefined;
	}

	call(note, velocity) {
		if (this.callback) {
			this.callback(note, velocity);
		}
	}

	set(callback, onrevoke) {
		this.clear();
		this.callback = callback;
		this.onrevoke = onrevoke;
	}

	clear() {
		if (this.onrevoke) {
			this.onrevoke();
		}
		this.callback = undefined;
		this.onrevoke = undefined;
	}

}
const inputHook = new InputHook();

MUSIC_INPUT.pitchChange = function (timeStamp, channelNum, note, velocity, glide) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
	inputHook.call(note, velocity);

	const channel = synth.getChannel(channelNum);
	channel.setMIDINote(note, time, glide);

	if (velocity > 0) {
		channel.keyOn(audioContext, velocity, time);
	}

};

MUSIC_INPUT.noteOff = function (timeStamp, channelNum) {
	synth.getChannel(channelNum).keyOff(audioContext);
};

MUSIC_INPUT.controlChange = function (timeStamp, controller, value) {
	let amount, sign, freeCheckbox, precision;
	switch (controller) {
	case 5:	// Portamento time
		amount = Math.min(value, 99);
		eachChannel(channel => channel.setGlideRate(amount));
		document.getElementById('glide-slider').value = amount;
		document.getElementById('glide').value = amount;
		break;
	case 10:	// Pan
		const pan = (value - 64) / (value <= 64 ? 64 : 63);
		eachChannel(channel => channel.setPan(pan));
		break;
	case 71:
		amount = value * 7 / 127;
		eachChannel(channel => channel.useFeedbackPreset(amount));
		document.getElementById('modulation-1-1').value = Math.round(amount * 140) / 10;
		break;
	case 92:
		sign = firstChannel.getTremoloDepth() >= 0 ? 1 : -1;
		amount = sign * compoundTremoloDepth(value);
		eachChannel(channel => channel.setTremoloDepth(amount));
		freeCheckbox = document.getElementById('tremolo-free');
		if (!freeCheckbox.checked) {
			freeCheckbox.checked = true;
			document.getElementById('tremolo-slider').max = 127;
			document.getElementById('tremolo-range').parentElement.classList.add('show');
			document.getElementById('tremolo-max').parentElement.classList.add('show');
		}
		precision = tremoloRangeNum === 0 ? 1 : 0;
		document.getElementById('tremolo').value = (amount / 511.5 * 100).toFixed(precision);
		document.getElementById('tremolo-slider').value = value;
		break;
	}
}

function compoundTremoloDepth(depth) {
	let scaledDepth = depth;
	if (scaledDepth > 0 && tremoloRangeNum > 0) {
		scaledDepth += 0.5;
	}
	scaledDepth *= 2 ** (tremoloRangeNum - 1);
	return scaledDepth;
}

function tremoloSliderValue(depth) {
	let sliderValue = depth / 2 ** (tremoloRangeNum - 1);
	if (sliderValue > 0.5 && tremoloRangeNum > 0) {
		sliderValue -= 0.5;
	}
	return sliderValue;
}

document.getElementById('pregain-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const preGain = parseFloat(this.value);
	document.getElementById('pregain').value = preGain.toFixed(1);
	soundSystem.setCompression(preGain, soundSystem.getCompressorRatio());
});

document.getElementById('pregain').addEventListener('input', function (event) {
	audioContext.resume();
	const preGain = parseFloat(this.value);
	const max = parseFloat(document.getElementById('pregain-slider').max);
	if (preGain >= 1 && preGain <= 4) {
		document.getElementById('pregain-slider').value = preGain;
		soundSystem.setCompression(preGain, soundSystem.getCompressorRatio());
	}
});

document.getElementById('compress-ratio-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const ratio = parseFloat(this.value);
	document.getElementById('compress-ratio').value = ratio;
	soundSystem.setCompression(soundSystem.getPreGain(), ratio);
});

document.getElementById('compress-ratio').addEventListener('input', function (event) {
	audioContext.resume();
	const ratio = parseFloat(this.value);
	if (ratio > 1 && ratio <= 20) {
		document.getElementById('compress-ratio-slider').value = ratio;
		soundSystem.setCompression(soundSystem.getPreGain(), ratio);
	}
});

document.getElementById('compress-release-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	document.getElementById('compress-release').value = value;
	soundSystem.setCompressorRelease(value);
});

document.getElementById('compress-release').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	if (value >= 0 && value <= 1000) {
		const slider = document.getElementById('compress-release-slider');
		const checkbox = document.getElementById('long-compress-release');
		if (value > 100) {
			slider.min = 100;
			slider.max = 1000;
			slider.step = 5;
			this.step = 10;
			checkbox.checked = true;
		} else {
			slider.min = 0;
			slider.max = 100;
			slider.step = 1;
			this.step = 2;
			checkbox.checked = false;
		}
		slider.value = value;
		soundSystem.setCompressorRelease(value);
	}
});

document.getElementById('long-compress-release').addEventListener('input', function (event) {
	const slider = document.getElementById('compress-release-slider');
	const box = document.getElementById('compress-release');
	let release = soundSystem.getCompressorRelease();

	if (this.checked) {
		release = Math.max(release, 100);
		slider.min = 100;
		slider.max = 1000;
		slider.step = 5;
		box.step = 10;
	} else {
		release = Math.min(release, 100);
		slider.min = 0;
		slider.max = 100;
		slider.step = 1;
		box.step = 2;
	}
	slider.value = release;
	box.value = release;
	soundSystem.setCompressorRelease(release);
});

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

document.getElementById('upload').addEventListener('input', async function (event) {
	audioContext.resume();
	const file = this.files[0];
	const content = await file.text();
	window.pattern = parsePattern('', content, NUM_CHANNELS);
});

let chosenDistortion = 1;	// Default 1db

function updateAlgorithmDetails(updatedOpNum) {
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
			if (i !== updatedOpNum) {
				const box = document.getElementById('output-level-' + i);
				box.value = Math.round(operator.getOutputLevel() * 2) / 2;
			}
		}
	}
	if (total > 0) {
		let distortion = 20 * Math.log10(total);
		distortion = Math.round(distortion * 10) / 10;
		document.getElementById('distortion').value = distortion;
	}
}

function algorithmRadio(event) {
	audioContext.resume();
	for (let i = 1; i <= 4; i++) {
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

function feedback(event) {
	const opNum = parseInt(this.id.slice(-1));
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		// 0	1	2	3	4	5	6	7
		// 0	14	28	42	56	70	84	98
		eachChannel(channel => channel.useFeedbackPreset(value / 14, opNum));
	}
}

document.getElementById('modulation-1-1').addEventListener('input', feedback);
document.getElementById('modulation-3-3').addEventListener('input', feedback);

function outputLevel() {
	audioContext.resume();
	const value = parseFloat(this.value);
	if (Math.abs(value) <= 2146.9) {
		const opNum = parseInt(this.id.slice(-1));
		eachChannel(channel => channel.setOutputLevel(opNum, value));
		updateAlgorithmDetails(opNum);
	}
}

for (let i = 1; i <= 4; i++) {
	document.getElementById('output-level-' + i).addEventListener('input', outputLevel);
}

function normalizeLevels(distortion = 0) {
	audioContext.resume();
	const symmetry = (parseFloat(document.getElementById('symmetry').value) || 50) / 100;
	eachChannel(channel => {
		channel.setDistortion(distortion, symmetry);
		channel.normalizeLevels();
	});

	for (let i = 1; i <= 4; i++) {
		const box = document.getElementById('output-level-' + i);
		box.value = Math.round(firstChannel.getOperator(i).getOutputLevel() * 2) / 2;
	}
}

document.getElementById('distortion').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value <= 921) {
		normalizeLevels(value);
		if (value !== 0) {
			chosenDistortion = value;
		}
	}
});

document.getElementById('symmetry').addEventListener('input', function (event) {
	const symmetry = parseFloat(this.value) / 100;
	if (Number.isFinite(symmetry)) {
		const amount = firstChannel.getDistortionAmount();
		eachChannel(channel => channel.setDistortion(amount, symmetry))
	}
});

document.getElementById('btn-normalize-levels').addEventListener('click', function (event) {
	normalizeLevels();
	document.getElementById('distortion').value = 0;
});

document.getElementById('btn-distort').addEventListener('click', function (event) {
	normalizeLevels(chosenDistortion);
	document.getElementById('distortion').value = chosenDistortion;
});

const HARMONIC_SCALE_RATIOS = [
	1, 17/16, 18/16, 19/16, 20/16, 21/16, 22/16, 24/16, 26/16, 27/16, 28/16, 30/16, 2
];
let customOctave = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function tune(detune) {
	const tuningStep = 100 / tuningPrecision;
	detune = Math.round(detune / tuningStep) * tuningStep;
	const microTuning = document.getElementById('micro-tuning').value;
	const key = parseInt(document.getElementById('tuning-key').value);
	let hideKey = false;
	let hideEdit = false;
	let steps;
	switch (microTuning) {
	case '12EDO':
		firstChannel.tuneEqualTemperament(detune, 0.5);
		hideKey = true;
		break;
	case '24EDO':
		firstChannel.tuneEqualTemperament(detune, 0.5, 2, 24);
		hideKey = true;
		hideEdit = true;
		break;
	case 'HARMONIC':
		firstChannel.tuneRatios(detune, HARMONIC_SCALE_RATIOS, key, 0.5);
		break;
	case 'USER_OCTAVE':
		let lastValue = customOctave[key];
		detune += (lastValue - key) * 100;
		steps = [];
		let totalSteps = 0;
		for (let i = 1; i < 12; i++) {
			const index = (key + i) % 12;
			let value = customOctave[index];
			if (index === 0) {
				lastValue -= 12;
			}
			const step =  value - lastValue;
			steps[i - 1] = step;
			totalSteps += step;
			lastValue = value;
		}
		steps[11] = 12 - totalSteps;
		firstChannel.tuneEqualTemperament(detune, 0.5, 2, 12, steps);
		hideEdit = true;
		break;
	default:
		steps = roundMicrotuning(MICRO_TUNINGS[microTuning], tuningPrecision);
		firstChannel.tuneEqualTemperament(detune, 0.5, 2, 12, steps, key);
	}
	document.getElementById('btn-micro-tuning-init').hidden = hideEdit;
	const row = document.getElementById('micro-tuning-row');
	row.children[2].hidden = hideKey;
	row.children[3].hidden = hideKey;
	for (let i = 2; i <= NUM_CHANNELS; i++) {
		synth.copyTuning(1, i);
	}
}

document.getElementById('btn-micro-tuning-init').addEventListener('click', function (event) {
	const microTuning = document.getElementById('micro-tuning').value;
	const key = parseInt(document.getElementById('tuning-key').value);
	let steps;
	switch (microTuning) {
	case '12EDO':
		customOctave = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
		break;
	case 'HARMONIC':
		customOctave = new Array(12);
		for (let i = 0; i < 12; i++) {
			let semitones = 12 * Math.log2(HARMONIC_SCALE_RATIOS[i]);
			customOctave[i] = Math.round(semitones * tuningPrecision) / tuningPrecision;
		}
		break;
	default:
		steps = roundMicrotuning(MICRO_TUNINGS[microTuning], tuningPrecision);
	}
	this.hidden = true;
	if (steps !== undefined) {
		// Convert incremental to absolute
		customOctave[0] = 0;
		for (let i = 0; i < 12; i++) {
			customOctave[i + 1] = customOctave[i] + steps[i];
		}
	}
	const rows = document.getElementById('micro-tuning-table').children;

	$('#custom-micro-tuning').collapse('show');
	const row = document.getElementById('micro-tuning-row');
	row.children[2].hidden = false;
	row.children[3].hidden = false;
});

document.getElementById('transpose-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const transpose = parseInt(this.value);
	document.getElementById('transpose').value = transpose;
	const detune = parseFloat(document.getElementById('detune').value) || 0;
	tune(transpose * 100 + detune);
});

document.getElementById('detune-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const detune = parseInt(this.value);
	document.getElementById('detune').value = detune;
	const transpose = parseFloat(document.getElementById('transpose').value) || 0;
	tune(transpose * 100 + detune);
});

document.getElementById('transpose').addEventListener('input', function (event) {
	audioContext.resume();
	const transpose = parseFloat(this.value);
	if (Number.isFinite(transpose)) {
		document.getElementById('transpose-slider').value = transpose;
		const detune = parseFloat(document.getElementById('detune').value) || 0;
		tune(transpose * 100 + detune);
	}
});

document.getElementById('detune').addEventListener('input', function (event) {
	audioContext.resume();
	const detune = parseFloat(this.value);
	if (Number.isFinite(detune)) {
		document.getElementById('detune-slider').value = detune;
		const transpose = parseFloat(document.getElementById('transpose').value) || 0;
		tune(transpose * 100 + detune);
	}
});

function decomposeDetune() {
	let transpose = parseFloat(document.getElementById('transpose').value) || 0;
	let detune = (parseFloat(document.getElementById('detune').value) || 0) / 100;
	const intTranspose = Math.trunc(transpose);
	if (intTranspose !== transpose) {
		detune = transpose - intTranspose;
	}
	transpose = intTranspose;
	const intDetune = Math.trunc(detune);
	transpose += intDetune;
	detune -= intDetune;
	if (detune > 0.5) {
		transpose++;
		detune = detune - 1;
	}
	detune *= 100;
	document.getElementById('transpose-slider').value = transpose;
	document.getElementById('transpose').value = transpose;
	document.getElementById('detune-slider').value = detune;
	document.getElementById('detune').value = detune;
}

document.getElementById('transpose').addEventListener('change', decomposeDetune);
document.getElementById('detune').addEventListener('change', decomposeDetune);

function retune() {
	audioContext.resume();
	const transpose = parseFloat(document.getElementById('transpose').value) || 0;
	const detune = parseFloat(document.getElementById('detune').value) || 0;
	tune(transpose * 100 + detune);
}

document.getElementById('micro-tuning').addEventListener('input', function (event) {
	$('#custom-micro-tuning').collapse(this.value.startsWith('USER_') ? 'show' : 'hide');
	retune();
});
document.getElementById('tuning-key').addEventListener('input', retune);

let microTuningNote = 0;

function chooseMicroTuningNote(event) {
	const rows = this.parentElement.children;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i] === this) {
			const value = customOctave[i];
			const coarse = Math.round(value);
			const fine = (value - coarse) * 64;
			document.getElementById('micro-tuning-coarse').value = coarse;
			document.getElementById('micro-tuning-fine').value = fine;
			microTuningNote = i;
			return;
		}
	}
}

for (let row of document.getElementById('micro-tuning-table').children) {
	row.addEventListener('click', chooseMicroTuningNote);
}

function microTuneNote() {
	const coarse = parseInt(document.getElementById('micro-tuning-coarse').value);
	const fine = parseInt(document.getElementById('micro-tuning-fine').value);
	let value = coarse + fine / 64;
	customOctave[microTuningNote] = value;
	const row = document.getElementById('micro-tuning-table').children[microTuningNote];
	const cell = row.children[1];
	cell.innerHTML = (value * 100).toFixed(1);
	retune();
}

document.getElementById('micro-tuning-coarse').addEventListener('input', microTuneNote);
document.getElementById('micro-tuning-fine').addEventListener('input', microTuneNote);

document.getElementById('poly-switch').addEventListener('input', function (event) {
	audioContext.resume();
	if (this.checked) {
		for (let i = 2; i <= NUM_CHANNELS; i++) {
			MUSIC_INPUT.armChannel(i);
		}
		firstChannel.setGlideRate(0);
	} else {
		MUSIC_INPUT.solo(1);
		const glideRate = parseInt(document.getElementById('glide-slider').value);
		firstChannel.setGlideRate(glideRate);
	}
});

document.getElementById('glide-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const glideRate = parseInt(this.value);
	document.getElementById('glide').value = glideRate;
	firstChannel.setGlideRate(glideRate);
});

document.getElementById('glide').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	if (value >= 0 && value <= 99) {
		document.getElementById('glide-slider').value = value;
		firstChannel.setGlideRate(value);
	}
});

document.getElementById('fingered-glide').addEventListener('input', function (event) {
	audioContext.resume();
	MUSIC_INPUT.fingeredPortamento = this.checked;
});

document.getElementById('filter-cutoff-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	const [octave, note] = AbstractChannel.decomposeFilterSteps(value);
	const ratio = 2 ** octave * AbstractChannel.filterSteps[note];
	const description = AbstractChannel.filterStepNames[note].padEnd(2) + String(octave + 3);
	const box = document.getElementById('filter-cutoff');
	box.value = description;

	let str;
	const integer = Math.trunc(ratio);
	const decimal = ratio - integer;
	if (octave <= 3) {
		let denominator = 16;
		if (octave < 0) {
			denominator = 64;
			str = '   ';
		} else {
			str = String(integer).padStart(2) + ' ';
		}
		const numerator = decimal * denominator;
		str += String(numerator).padStart(2) + '&sol;' + denominator;
	} else {
		str = String(ratio).padEnd(8);
	}
	document.getElementById('filter-ratio').innerHTML = str;
	eachChannel(channel => channel.setFilterCutoff(value));
});

document.getElementById('filter-key-track-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const amount = parseInt(this.value) * 3.125;
	document.getElementById('filter-key-track').value = amount.toFixed(0);
	eachChannel(channel => channel.setFilterKeyTracking(amount));
});

document.getElementById('filter-key-track').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	if (value >= -201 && value <= 201) {
		document.getElementById('filter-key-track-slider').value = value / 3.125;
		eachChannel(channel => channel.setFilterKeyTracking(value));
	}
});

document.getElementById('filter-breakpoint-slider').addEventListener('input', function (event) {
	const midiNote = parseInt(this.value);
	const octave = getOctave(midiNote);
	const note = getNoteName(midiNote);
	document.getElementById('filter-breakpoint').value = note.padEnd(2) + octave;
	eachChannel(channel => channel.setFilterBreakpoint(midiNote));
});

document.getElementById('filter-resonance-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const resonance = parseFloat(this.value);
	const box = document.getElementById('filter-resonance');
	box.value = resonance.toFixed(2);
	eachChannel(channel => channel.setFilterResonance(resonance));
});

document.getElementById('filter-resonance').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseFloat(this.value);
	if (value >= -758.5 && value < 770.63678) {
		document.getElementById('filter-resonance-slider').value = value;
		eachChannel(channel => channel.setFilterResonance(value));
	}
});

function updateLFODelay() {
	const time = firstChannel.getEffectiveLFODelay();
	document.getElementById('lfo-delay').value = time.toFixed(2);
}

document.getElementById('lfo-rate-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
	const value = parseFloat(this.value);
	const free = document.getElementById('lfo-rate-free').checked;
	let frequency;
	if (free) {
		frequency = value;
	} else {
		frequency = synth.lfoPresetToFrequency(value);
	}
	const precision = document.getElementById('fast-lfo').checked ? 1 : 2;
	document.getElementById('lfo-rate').value = frequency.toFixed(precision);
	eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
	updateLFODelay();
});

function configureLFOFreqSlider(fast, free) {
	const slider = document.getElementById('lfo-rate-slider');
	if (fast) {
		// Enable faster rates
		if (free) {
			slider.min = Math.round(synth.lfoPresetToFrequency(6) * 10) / 10;
			slider.max = Math.round(synth.lfoPresetToFrequency(8) * 10) / 10;
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
			slider.max = Math.round(synth.lfoPresetToFrequency(6) * 100) / 100;
			slider.step = 0.01;
		} else {
			slider.min = 0;
			slider.max = 6;
			slider.step = 1;
		}
	}
}

document.getElementById('lfo-rate').addEventListener('input', function (event) {
	const time = nextQuantum(audioContext);
	const value = parseFloat(this.value);
	if (value >= 0) {
		const fastCheckbox = document.getElementById('fast-lfo');
		const fastThreshold = Math.ceil(synth.lfoPresetToFrequency(6) * 10) / 10;
		if (fastCheckbox.checked && value < fastThreshold) {
			fastCheckbox.checked = false;
			configureLFOFreqSlider(false, true);
		} else if (!fastCheckbox.checked && value > fastThreshold) {
			fastCheckbox.checked = true;
			configureLFOFreqSlider(true, true);
		}
		document.getElementById('lfo-rate-slider').value = value;
		eachChannel(channel => channel.setLFORate(audioContext, value, time));
		updateLFODelay();
	}
});

document.getElementById('fast-lfo').addEventListener('input', function (event) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
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
	const frequency = free ? parseFloat(slider.value) : synth.lfoPresetToFrequency(6);
	box.value = frequency.toFixed(precision);
	eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
	updateLFODelay();
});

document.getElementById('lfo-rate-free').addEventListener('input', function (event) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
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
			const presetFrequency = synth.lfoPresetToFrequency(i);
			const thisDelta = Math.abs(value - presetFrequency);
			if (thisDelta < delta) {
				delta = thisDelta;
				presetNum = i;
			}
			if (presetFrequency <= value) {
				break;
			}
		}
		slider.value = presetNum;
		const frequency = synth.lfoPresetToFrequency(presetNum);
		const precision = fast ? 1 : 2;
		box.value = frequency.toFixed(precision);
		eachChannel(channel => channel.setLFORate(audioContext, frequency, time));
		updateLFODelay();
	}
});

function lfoWaveform(event) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
	const dropDown = document.getElementById('btn-lfo-waveform');
	const dropDownImage = dropDown.children[0];
	const option = this.parentElement;
	const imageLabel = option.children[1];
	dropDownImage.src = imageLabel.src;
	const value = this.value;
	eachChannel(channel => channel.setLFOShape(audioContext, value, time));
}

for (let element of document.querySelectorAll('input[name="lfo-waveform"]')) {
	element.addEventListener('input', lfoWaveform);
}

document.getElementById('key-sync').addEventListener('input', function (event) {
	const value = KeySync[this.value.toUpperCase()];
	eachChannel(channel => channel.setLFOKeySync(audioContext, value));
	if (value === KeySync.OFF) {
		synth.syncFreeLFOs(audioContext);
	}
	updateLFODelay();
});

/**The DX21 manual says that a value of 99 results in a delay of "approximately 15 seconds" and
 * a value of 70 takes 6.5 seconds. The rest is a leap of conjecture based on the fact that
 * non-linear relationships in Yamaha synths generally rely on exponentiation of 2 and some bit
 * shifting. An exponent of x/25 fits perfectly and 99/25 is very close to 127/32. I'm unsure
 * how the scale 1..99 gets mapped onto an internal scale of 1..127 in this case though. It
 * seems different from the calculation used for the operator output levels.
 */
function lfoFadeToSeconds(x) {
	return x === 0 ? 0 : 2 ** (x / 32) - 0.5;
}

function lfoFadeToYamaha(time) {
	return time === 0 ? 0 : Math.log2(time + 0.5) * 32;
}

document.getElementById('lfo-delay-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const time = 7 / 13 * lfoFadeToSeconds(parseFloat(this.value));
	document.getElementById('lfo-delay').value = time.toFixed(2);
	eachChannel(channel => channel.setLFODelay(time));
	updateLFODelay();
});

document.getElementById('lfo-delay').addEventListener('input', function (event) {
	audioContext.resume();
	const time = parseFloat(this.value);
	if (time >= 0) {
		const sliderValue = lfoFadeToYamaha(time * 13 / 7);
		document.getElementById('lfo-delay-slider').value = sliderValue;
		eachChannel(channel => channel.setLFODelay(time));
		updateLFODelay();
	}
});

document.getElementById('lfo-fade-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const time = 6 / 13 * lfoFadeToSeconds(parseFloat(this.value));
	document.getElementById('lfo-fade').value = time.toFixed(2);
	eachChannel(channel => channel.setFadeTime(time));
	updateLFODelay();
});

document.getElementById('lfo-fade').addEventListener('input', function (event) {
	audioContext.resume();
	const time = parseFloat(this.value);
	if (time >= 0) {
		const sliderValue = lfoFadeToYamaha(time * 13 / 6);
		document.getElementById('lfo-fade-slider').value = sliderValue;
		eachChannel(channel => channel.setFadeTime(time));
		updateLFODelay();
	}
});

function lfoFadeDirection(event) {
	const direction = Direction[this.value.toUpperCase()];
	eachChannel(channel => channel.setFadeDirection(direction));
	updateLFODelay();
}

document.getElementById('lfo-fade-in').addEventListener('input', lfoFadeDirection);
document.getElementById('lfo-fade-out').addEventListener('input', lfoFadeDirection);

function lfoFadeParameter(event) {
	audioContext.resume();
	const parameterNum = FadeParameter[this.value.toUpperCase()];
	eachChannel(channel => channel.setFadeParameter(parameterNum));
	updateLFODelay();
}

document.getElementById('lfo-fade-depth').addEventListener('input', lfoFadeParameter);
document.getElementById('lfo-fade-rate').addEventListener('input', lfoFadeParameter);

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
		} while (vibratoRange < absCents && rangeNum < VIBRATO_RANGES.length - 1);
		document.getElementById('vibrato-slider').value = absCents / vibratoRange * 127;
		document.getElementById('vibrato-range').value = rangeNum + 1;
		document.getElementById('vibrato-max').innerHTML = vibratoRange;
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

document.getElementById('tremolo-slider').addEventListener('input', function (event) {
	audioContext.resume();
	const value = parseInt(this.value);
	const free = document.getElementById('tremolo-free').checked;
	const box = document.getElementById('tremolo');
	let percentage, precision;
	if (free) {
		const sign = firstChannel.getTremoloDepth() >= 0 ? 1 : -1;
		const depth = sign * compoundTremoloDepth(value);
		percentage = depth / 511.5 * 100;
		precision = tremoloRangeNum > 0 ? 0 : 1;
		eachChannel(channel => channel.setTremoloDepth(depth));
	} else {
		const scaledDepth = 2 * AbstractChannel.tremoloPresets[value];
		percentage = scaledDepth * 100;
		precision = 0;
		eachChannel(channel => channel.useTremoloPreset(value));
	}
	box.value = percentage.toFixed(precision);
});


document.getElementById('tremolo-free').addEventListener('input', function (event) {
	audioContext.resume();
	const slider = document.getElementById('tremolo-slider');
	const box = document.getElementById('tremolo');
	const free = this.checked;
	const rangeSlider = document.getElementById('tremolo-range');
	const label = document.getElementById('tremolo-max');
	box.disabled = !free;
	const depth = firstChannel.getTremoloDepth();
	if (free) {
		slider.max = 127;
		slider.value = 2 * Math.abs(depth);
		rangeSlider.value = 0;
		document.getElementById('tremolo-min').innerHTML = '0';
		label.innerHTML = (TREMOLO_RANGES[0] / 511.5 * 100).toFixed(0);
		rangeSlider.parentElement.classList.add('show');
		label.parentElement.classList.add('show');
	} else {
		let scaledDepth = 2 * Math.abs(depth) / 1023;
		let presetNum = -1, presetValue;
		do {
			presetNum++;
			presetValue = AbstractChannel.tremoloPresets[presetNum];
		} while (scaledDepth > presetValue && presetNum < AbstractChannel.tremoloPresets.length - 1);
		if (presetNum > 0) {
			const lowerDepth = AbstractChannel.tremoloPresets[presetNum - 1];
			const upperDepth = AbstractChannel.tremoloPresets[presetNum];
			if (scaledDepth - lowerDepth < upperDepth - scaledDepth) {
				presetNum--;
			}
		}
		scaledDepth = AbstractChannel.tremoloPresets[presetNum];
		slider.min = 0;
		slider.max = AbstractChannel.tremoloPresets.length - 1;
		slider.value = presetNum;
		box.value = (scaledDepth * 100).toFixed(0);
		rangeSlider.parentElement.classList.remove('show');
		label.parentElement.classList.remove('show');
		eachChannel(channel => channel.useTremoloPreset(presetNum));
		tremoloRangeNum = 0;
	}
});

document.getElementById('tremolo').addEventListener('input', function (event) {
	let depth = 511.5 * parseFloat(this.value) / 100;
	const sign = depth >= 0 ? 1 : -1;
	depth = Math.abs(depth);
	if (depth <= 1023) {
		const slider = document.getElementById('tremolo-slider');
		let tremoloRange;
		if (depth > 510) {
			tremoloRangeNum = TREMOLO_RANGES.length - 1;
			tremoloRange = TREMOLO_RANGES[tremoloRangeNum];
			slider.min = 63;
		} else {
			tremoloRangeNum = -1;
			do {
				tremoloRangeNum++;
				tremoloRange = TREMOLO_RANGES[tremoloRangeNum];
			} while (tremoloRange < depth);
			slider.min = 0;
		}
		slider.value = tremoloSliderValue(depth);
		document.getElementById('tremolo-range').value = tremoloRangeNum;
		document.getElementById('tremolo-min').innerHTML = tremoloRangeNum === 4 ? '99' : '0';
		document.getElementById('tremolo-max').innerHTML = (tremoloRange / 511.5 * 100).toFixed(0);
		eachChannel(channel => channel.setTremoloDepth(sign * depth));
	}
});

document.getElementById('tremolo-range').addEventListener('input', function (event) {
	let depth = firstChannel.getTremoloDepth();
	const sign = depth >= 0 ? 1 : -1;
	depth = Math.abs(depth);
	tremoloRangeNum = parseInt(this.value);
	const tremoloRange = TREMOLO_RANGES[tremoloRangeNum];
	const scaledTremoloRange = tremoloRange / 511.5 * 100;
	document.getElementById('tremolo-max').innerHTML = scaledTremoloRange.toFixed(0);
	const slider = document.getElementById('tremolo-slider');
	if (tremoloRangeNum === 4) {
		slider.min = 63;
		if (depth < 510) {
			document.getElementById('tremolo').value = sign * 99;
			eachChannel(channel => channel.setTremoloDepth(sign * 510));
		}
		document.getElementById('tremolo-min').innerHTML = '99';
	} else {
		slider.min = 0;
		document.getElementById('tremolo-min').innerHTML = '0';
	}
	if (depth > tremoloRange) {
		slider.value = 127;
		const precision = tremoloRangeNum > 0 ? 0 : 1;
		document.getElementById('tremolo').value = sign * scaledTremoloRange.toFixed(precision);
		eachChannel(channel => channel.setTremoloDepth(sign * tremoloRange));
	} else {
		slider.value = Math.trunc(tremoloSliderValue(depth));
	}
});

document.getElementById('pan-source').addEventListener('input', function (event) {
	audioContext.resume();
	const source = Pan[this.value.toUpperCase()];
	eachChannel(channel => channel.setPanModulationSource(source));
});

document.getElementById('pan-direction').addEventListener('input', function (event) {
	const direction = parseInt(this.value);
	eachChannel(channel => channel.setPanModulationDirection(direction));
});

document.getElementById('pan-width-slider').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	const stereoWidth = 2 * value / 99;
	document.getElementById('pan-width').value = value;
	eachChannel(channel => channel.setStereoWidth(stereoWidth));
});

document.getElementById('pan-width').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 0 && value <= 99) {
		const stereoWidth = 2 * value / 99;
		document.getElementById('pan-width-slider').value = value;
		eachChannel(channel => channel.setStereoWidth(stereoWidth));
	}
});

document.getElementById('btn-pan-centre').addEventListener('click', function (event) {
	const highlight = 'font-weight-bold';
	if (this.classList.contains(highlight)) {
		inputHook.clear();
		return;
	}
	const button = this;
	const callback = function (note, velocity) {
		button.classList.remove(highlight);
		const source = Pan[document.getElementById('pan-source').value.toUpperCase()];
		let value;
		if (source === Pan.NOTE) {
			value = note;
		} else {
			value = velocity;
		}
		eachChannel(channel => channel.setPanControllerCentre(value));
		inputHook.clear();
	};
	const deactivate = () => button.classList.remove(highlight);
	inputHook.set(callback, deactivate);
	button.classList.add(highlight);
});

document.getElementById('btn-pan-range').addEventListener('click', function (event) {
	const highlight = 'font-weight-bold';
	if (this.classList.contains(highlight)) {
		inputHook.clear();
		return;
	}
	const source = Pan[document.getElementById('pan-source').value.toUpperCase()];
	const button = this;
	const callback = function (note, velocity) {
		button.classList.remove(highlight);
		let value;
		if (source === Pan.NOTE) {
			value = note;
		} else {
			value = velocity;
		}
		const range = Math.abs(value - firstChannel.getPanControllerCentre());
		if (range === 0) {
			eachChannel(channel => {
				channel.setPanModulationSource(Pan.FIXED);
				channel.setPan(0);
			});
		} else {
			eachChannel(channel => {
				channel.setPanModulationSource(source);
				channel.setPanControllerRange(range);
			});
		}
		inputHook.clear();
	};
	const deactivate = () => button.classList.remove(highlight);
	inputHook.set(callback, deactivate);
	button.classList.add(highlight);
});

document.getElementById('delay-send-slider').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	document.getElementById('delay-send').value = value;
	eachChannel(channel => channel.setDelaySend(value));
});

document.getElementById('delay-invert').addEventListener('input', function (event) {
	const polarity = this.checked ? -1 : 1;
	const amount = firstChannel.getDelaySend();
	eachChannel(channel => channel.setDelaySend(amount, polarity));
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
	audioContext.resume();
	const time = nextQuantum(audioContext);
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
	audioContext.resume();
	const opNum = getOperator(this);
	document.getElementById('op' + opNum + '-freq-unfixed').checked = true;
	eachChannel(channel => channel.fixFrequency(opNum, false));
}

function frequencyMultipleSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	let value = parseFloat(this.value);
	if (value === 0) {
		const free = document.getElementById(opStr + 'multiple-free').checked;
		if (!free) {
			value = 0.5;
		}
	}
	document.getElementById(opStr + 'freq-unfixed').checked = true;
	document.getElementById(opStr + 'multiple').value = value;
	eachChannel(channel => {
		channel.setFrequencyMultiple(opNum, value);
		channel.fixFrequency(opNum, false);
	});
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
	eachChannel(channel => {
		channel.setFrequencyMultiple(opNum, value);
		channel.fixFrequency(opNum, false);
	});
}

function frequencyFreeMultiple(event) {
	audioContext.resume();
	const time = nextQuantum(audioContext);
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
	audioContext.resume();
	const opNum = getOperator(this);
	document.getElementById('op' + opNum + '-freq-fixed').checked = true;
	const block = parseInt(document.getElementById('op' + opNum + '-block').value);
	let freqNum = parseInt(document.getElementById('op' + opNum + '-freq-num').value);
	if (!(freqNum >= 0 && freqNum <= 2047)) {
		freqNum = firstChannel.getOperator(opNum).getFrequencyNumber();
	}
	eachChannel(channel => {
		channel.fixFrequency(opNum, true);
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

function velocityDepthSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	let value = parseInt(this.value);
	const sign = parseInt(queryChecked(document.getElementById(opStr + 'velocity-direction'), opStr + 'velocity-direction').value);
	value *= sign;
	document.getElementById(opStr + 'velocity-depth').value = value;
	eachChannel(channel => channel.getOperator(opNum).setVelocitySensitivity(value));
}

function velocityDepth(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	let value = parseInt(this.value);
	if (Number.isFinite(value)) {
		document.getElementById(opStr + 'velocity-depth-slider').value = Math.abs(value);
		if (value !== 0) {
			checkInput(document.getElementById(opStr + 'velocity-direction'), opStr + 'velocity-direction', Math.sign(value));
		}
		eachChannel(channel => channel.getOperator(opNum).setVelocitySensitivity(value));
	}
}

function velocityDirection(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	let value = parseInt(this.value);
	value *= Math.abs(firstChannel.getOperator(opNum).getVelocitySensitivity());
	document.getElementById(opStr + 'velocity-depth').value = value;
	eachChannel(channel => channel.getOperator(opNum).setVelocitySensitivity(value));
}

function velocityOffsetSlider(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	const value = parseInt(this.value);
	document.getElementById(opStr + 'velocity-offset').value = value;
	eachChannel(channel => channel.getOperator(opNum).setVelocityOffset(value));
}

function velocityOffset(event) {
	audioContext.resume();
	const opNum = getOperator(this);
	const opStr = 'op' + opNum + '-';
	const value = parseInt(this.value);
	if (value >= 0 && value <= 127) {
		document.getElementById(opStr + 'velocity-offset-slider').value = value;
		eachChannel(channel => channel.getOperator(opNum).setVelocityOffset(value));
	}
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

	const sustainSlider = document.getElementById('op' + opNum + '-sustain-slider');
	const sustainBox = document.getElementById('op' + opNum + '-sustain');
	sustainBox.disabled = !free;

	if (free) {
		sustainSlider.step = 1 / 16;
	} else {
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
	const opStr = 'op' + n + '-';
	doc.getElementById(opStr + 'freq-fixed').addEventListener('input', frequency);
	doc.getElementById(opStr + 'freq-unfixed').addEventListener('input', unfixFrequency);
	doc.getElementById(opStr + 'multiple-slider').addEventListener('input', frequencyMultipleSlider);
	doc.getElementById(opStr + 'multiple').addEventListener('input', frequencyMultiple);
	doc.getElementById(opStr + 'multiple-free').addEventListener('input', frequencyFreeMultiple);
	doc.getElementById(opStr + 'block').addEventListener('input', frequency);
	doc.getElementById(opStr + 'freq-num').addEventListener('input', frequency);

	doc.getElementById(opStr + 'rate-scale-slider').addEventListener('input', rateScaling);
	doc.getElementById(opStr + 'velocity-depth-slider').addEventListener('input', velocityDepthSlider);
	doc.getElementById(opStr + 'velocity-depth').addEventListener('input', velocityDepth);
	doc.getElementById(opStr + 'velocity-offset-slider').addEventListener('input', velocityOffsetSlider);
	doc.getElementById(opStr + 'velocity-offset').addEventListener('input', velocityOffset);
	for (let element of doc.querySelectorAll(`input[name="${opStr}velocity-direction"]`)) {
		element.addEventListener('input', velocityDirection);
	}


	doc.getElementById(opStr + 'attack-slider').addEventListener('input', attackSlider);
	doc.getElementById(opStr + 'decay-slider').addEventListener('input', decaySlider);
	doc.getElementById(opStr + 'sustain-slider').addEventListener('input', sustainSlider);
	doc.getElementById(opStr + 'sustain').addEventListener('input', sustain);
	doc.getElementById(opStr + 'sustain-rate-slider').addEventListener('input', sustainRateSlider);
	doc.getElementById(opStr + 'release-slider').addEventListener('input', releaseSlider);
	doc.getElementById(opStr + 'rates-free').addEventListener('input', ratesFree);
	doc.getElementById(opStr + 'levels-free').addEventListener('input', levelsFree);

	for (let element of doc.querySelectorAll(`input[name="${opStr}waveform"]`)) {
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
	const rule = document.getElementById('disabled-operator-styles').sheet.cssRules[opNum - 1];
	rule.style.removeProperty('display');
	eachChannel(channel => channel.enableOperator(opNum));
	updateAlgorithmDetails();
}

function disableOperator(opNum) {
	const rule = document.getElementById('disabled-operator-styles').sheet.cssRules[opNum - 1];
	rule.style.setProperty('display', 'none');
	eachChannel(channel => channel.disableOperator(opNum));
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
