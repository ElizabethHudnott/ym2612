import {ClockRate} from './common.js';
import Synth from './fm-synth.js';
import {PSG} from './psg.js';

export default class GenesisSound {

	constructor(context, numFMChannels = 6, numPulseChannels = 3, masterClockRate = ClockRate.PAL, psgClockRate = undefined, output = context.destination) {
		this.cutoff = 4000;
		this.resonance = 0;
		const filter = new BiquadFilterNode(context, {frequency: this.cutoff, Q: this.resonance});
		filter.connect(output);
		this.filter = filter;

		if (psgClockRate === undefined) {
			psgClockRate = masterClockRate / 15;
		}
		this.fm = new Synth(context, numFMChannels, filter, masterClockRate / 7);
		this.psg = new PSG(context, numPulseChannels, filter, psgClockRate);
	}

	start(time) {
		this.fm.start(time);
		this.psg.start(time);
	}

	stop(time = 0) {
		this.fm.stop(time);
		this.psg.stop(time);
	}

	setFilterCutoff(frequency, time = 0, method = 'setValueAtTime') {
		this.filter.frequency[method](frequency, time);
		this.cutoff = frequency;
	}

	getFilterCutoff() {
		return this.cutoff;
	}

	applyFilter(time = 0) {
		this.filter.frequency.setValueAtTime(this.cutoff, time);
	}

	setFilterResonance(decibels, time = 0, method = 'setValueAtTime') {
		this.filter.Q[method](decibels, time);
		this.resonance = decibels;
	}

	getFilterResonance() {
		return this.resonance;
	}

}
