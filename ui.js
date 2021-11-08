import GenesisSound from './src/genesis.js';
import YM2612 from './src/ym2612.js';
let context;

document.getElementById('btn-init').addEventListener('click', function (event) {
	this.disabled = true;

	context = new AudioContext();
	window.audioContext = context;
	const soundSystem = new GenesisSound(context);
	window.soundSystem = soundSystem;
	window.synth = soundSystem.fm;
	window.chan = synth.getChannel(1);
	window.psg = soundSystem.psg;
	window.ym2612 = new YM2612(soundSystem.fm);

	soundSystem.start(context.currentTime + 0.01);
	soundSystem.setFilterCutoff(20000);
	synth.setChannelGain(6);

});

document.getElementById('btn-note').addEventListener('mousedown', function (event) {
	chan.keyOn(context, context.currentTime + 0.1);
});

document.getElementById('btn-note').addEventListener('mouseup', function (event) {
	chan.keyOff(context.currentTime + 0.1);
});

document.getElementById('btn-sound-off').addEventListener('click', function (event) {
	chan.soundOff();
});
