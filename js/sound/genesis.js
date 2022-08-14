import {ClockRate} from './common.js';
import Synth from './fm-synth.js';
import {PSG} from './psg.js';

export default class GenesisSound {

	constructor(
		context, numFMChannels = 6, numPulseChannels = 3, masterClockRate = ClockRate.NTSC,
		fps = 60, fmClockDivider1 = 7, fmClockDivider2 = 144, psgClockRate = masterClockRate / 15,
		output = context.destination
	) {

		this.compressRelease = 250;
		const compressor = new DynamicsCompressorNode(context, {attack: 0, knee: 0});
		this.compressor = compressor;
		compressor.connect(output);

		this.fm = new Synth(context, numFMChannels, compressor, masterClockRate, fmClockDivider1, fmClockDivider2);
		this.psg = new PSG(context, numPulseChannels, compressor, psgClockRate, 1, fps);
		this.setCompression(1.44, 10);
	}

	start(time) {
		this.fm.start(time);
		this.psg.start(time);
	}

	stop(time = 0) {
		this.fm.stop(time);
		this.psg.stop(time);
	}

	setCompression(preGain, ratio = 20, time = 0) {
		const compressor = this.compressor;
		const maxDB = 20 * Math.log10(preGain);
		const threshold = -maxDB / (ratio - 1);
		this.fm.setChannelGain(preGain, time);
		compressor.ratio.setValueAtTime(ratio, time);
		compressor.threshold.setValueAtTime(threshold, time);
		this.preGain = preGain;
		this.compressRatio = ratio;
	}

	getPreGain() {
		return this.preGain;
	}

	getCompressorRatio() {
		return this.compressRatio;
	}

	setCompressorRelease(milliseconds, time = 0) {
		this.compressor.release.setValueAtTime(milliseconds / 1000, time);
		this.compressRelease = milliseconds;
	}

	getCompressorRelease() {
		return this.compressRelease;
	}

}
