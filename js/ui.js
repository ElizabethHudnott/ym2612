import {PROCESSING_TIME, ClockRate, VIBRATO_RANGES, VIBRATO_PRESETS} from './sound/common.js';
import Synth from './sound/fm-synth.js';
import GenesisSound from './sound/genesis.js';
import YM2612 from './sound/ym2612.js';
import {Pan, AbstractChannel} from './sound/fm-channel.js';
import {OscillatorConfig, Waveform} from './sound/waveforms.js';
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

const audioContext = new AudioContext(
	{ latencyHint: 'interactive', sampleRate: Synth.sampleRate(ClockRate.NTSC, 15, 64) }
);
const soundSystem = new GenesisSound(audioContext, NUM_CHANNELS, 3, ClockRate.NTSC, 60, 15, 64);
soundSystem.start(audioContext.currentTime + PROCESSING_TIME);
const synth = soundSystem.fm;
const psg = soundSystem.psg;
const player = new Player(audioContext, synth);
const recorder = new Recorder(audioContext);
recorder.connectIn(soundSystem.filter);

const firstChannel = synth.getChannel(1);

function eachChannel(callback) {
	synth.channels.forEach(callback);
}

eachChannel(channel => {
	channel.useAlgorithm(4)
	for (let opNum = 1; opNum <= 4; opNum++) {
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
window.psg = psg;
window.ym2612 = new YM2612(soundSystem.fm, audioContext);
window.eachChannel = eachChannel;
window.OscillatorConfig = OscillatorConfig;
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
	const time = audioContext.currentTime + PROCESSING_TIME;
	audioContext.resume();
	inputHook.call(note, velocity);

	const channel = synth.getChannel(channelNum);
	channel.setMIDINote(note, time, glide);

	if (velocity > 0) {
		channel.keyOn(audioContext, velocity, time);
		soundSystem.applyFilter();
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
		soundSystem.setCompression(soundSystem.getpreGain(), ratio);
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
			box.value = Math.round(operator.getOutputLevel() * 100) / 100;
		}
	}
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

function feedback(event) {
	const opNum = parseInt(this.id.slice(-1));
	const value = parseFloat(this.value);
	if (Number.isFinite(value)) {
		// 0	1	2	3	4	5	6	7
		// 0	14	28	42	56	70	84	98
		eachChannel(channel => channel.useFeedbackPreset(value / 14));
	}
}

document.getElementById('modulation-1-1').addEventListener('input', feedback);
document.getElementById('modulation-3-3').addEventListener('input', feedback);

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
		frequency = synth.lfoPresetToFrequency(value);
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
	const time = audioContext.currentTime + PROCESSING_TIME;
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
	const frequency = free ? parseFloat(slider.value) : synth.lfoPresetToFrequency(6);
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
	}
});

document.getElementById('btn-key-sync').addEventListener('click', function (event) {
	if (!this.classList.contains('active')) {
		// Just clicked to make it active, CSS hasn't been updated yet.
		eachChannel(channel => channel.setLFOKeySync(audioContext, true));
	} else {
		synth.resetLFOs(audioContext);
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
		} while (vibratoRange < absCents);
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

document.getElementById('glide-slider').addEventListener('input', function (event) {
	const glideRate = parseInt(this.value);
	document.getElementById('glide').value = glideRate;
	eachChannel(channel => channel.setGlideRate(glideRate));
});

document.getElementById('fingered-glide').addEventListener('input', function (event) {
	MUSIC_INPUT.fingeredPortamento = this.checked;
});

document.getElementById('pan-source').addEventListener('input', function (event) {
	const source = parseInt(this.value);
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
		let value;
		if (firstChannel.getPanModulationSource() === Pan.NOTE) {
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
	const button = this;
	const callback = function (note, velocity) {
		button.classList.remove(highlight);
		let value;
		if (firstChannel.getPanModulationSource() === Pan.NOTE) {
			value = note;
		} else {
			value = velocity;
		}
		const range = Math.abs(value - firstChannel.getPanControllerCentre());
		if (range > 0) {
			eachChannel(channel => channel.setPanControllerRange(range));
		}
		inputHook.clear();
	};
	const deactivate = () => button.classList.remove(highlight);
	inputHook.set(callback, deactivate);
	button.classList.add(highlight);
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
	if (value > -770.63678 && value < 770.63678) {
		document.getElementById('filter-q-slider').value = value;
		soundSystem.setFilterResonance(value);
		filterQ = value;
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
