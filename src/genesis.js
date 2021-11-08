import {PMSynth, CLOCK_RATE} from './opn2.js';
import {PSG, CLOCK_RATIO} from './psg.js';

export default class GenesisSound {

	constructor(context, output = context.destination, ymClockRate = CLOCK_RATE.PAL, psgClockRate = ymClockRate / CLOCK_RATIO) {
		const filter = new BiquadFilterNode(context, {frequency: 10000});
		filter.connect(output);
		this.filter = filter;
		this.fm = new PMSynth(context, filter, 6, ymClockRate);
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
	}

	getFilterCutoff() {
		return this.filter.frequency.value;
	}

	setFilterResonance(decibels, time = 0, method = 'setValueAtTime') {
		this.filter.Q[method](decibels, time);
	}

	getFilterResonance() {
		return this.filter.Q.value;
	}

}
