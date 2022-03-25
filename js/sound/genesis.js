import {FMSynth, CLOCK_RATE} from './opn2.js';
import {PSG, CLOCK_RATIO} from './psg.js';

export default class GenesisSound {

	constructor(context, output = context.destination, ymClockRate = CLOCK_RATE.PAL, psgClockRate = ymClockRate / CLOCK_RATIO) {
		this.cutoff = 4000;
		this.resonance = 0;
		const filter = new BiquadFilterNode(context, {frequency: this.cutoff, Q: this.resonance});
		filter.connect(output);
		this.filter = filter;
		this.fm = new FMSynth(context, filter, 6, ymClockRate);
		this.psg = new PSG(context, filter, 3, psgClockRate);
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
