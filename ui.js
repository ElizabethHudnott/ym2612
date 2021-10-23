import {FMSynth} from './opn2.js';
let context;


document.getElementById('btn-init').addEventListener('click', function (event) {
	context = new AudioContext();
	const synth = new FMSynth(context, 1);
	synth.start(context.currentTime + 0.1);
	window.chan = synth.channels[0];
});

document.getElementById('btn-note-on').addEventListener('click', function (event) {
	chan.keyOn(context.currentTime);
});

document.getElementById('btn-sound-off').addEventListener('click', function (event) {
	chan.soundOff();
});
