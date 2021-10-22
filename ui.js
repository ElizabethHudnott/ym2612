import {FMSynth} from './opn2.js';
let context;


document.getElementById('btn-init').addEventListener('click', function (event) {
	context = new AudioContext();
	const synth = new FMSynth(context);
	synth.start(context.currentTime + 0.1);
	window.synth = synth;
});

document.getElementById('btn-note-on').addEventListener('click', function (event) {
	synth.channels[0].keyOn(context.currentTime);
});

document.getElementById('btn-sound-off').addEventListener('click', function (event) {
	synth.soundOff();
});
