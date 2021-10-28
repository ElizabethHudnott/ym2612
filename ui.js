import YM2612 from './ym2612.js';
let context;

document.getElementById('btn-init').addEventListener('click', function (event) {
	this.disabled = true;
	context = new AudioContext();
	const chip = new YM2612(context);
	chip.start(context.currentTime + 0.01);
	const synth = chip.synth;
	window.audioContext = context;
	window.chip = chip;
	window.synth = synth;
	window.chan = synth.getChannel(1);
});

document.getElementById('btn-note').addEventListener('mousedown', function (event) {
	chan.keyOn(context.currentTime + 0.1);
});

document.getElementById('btn-note').addEventListener('mouseup', function (event) {
	chan.keyOff(context.currentTime + 0.1);
});

document.getElementById('btn-sound-off').addEventListener('click', function (event) {
	chan.soundOff();
});
