import {VIBRATO_RANGES} from './common.js';

class Effect {

	/** Applies the effect.
	 */
	apply(trackState, channel, time) {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the apply method.");
	}

	clone() {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the clone method.");
	}

	/**
	 * @return {String[]} List of types.
	 */
	get binaryFormat() {
		return 'UInt8';
	}

	/**
	 * @param {Object[]} data As it's recorded in a module file.
	 */
	set(data) {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the set method.");
	}

}

/**
 * Applies glide to a note, and optionally changes the glide rate.
 * Special values: 0 = reuse previous
 */
class Glide extends Effect {

	constructor() {
		super();
		this.rate = undefined;
	}

	clone() {
		const clone = new Glide();
		clone.rate = this.rate;
		return clone;
	}

	set(data) {
		const value = data[0];
		if (value === 0) {
			this.rate = undefined;
		} else {
			this.rate = data[0];
		}
	}

	apply(trackState, channel, time) {
		const rate = this.rate;
		if (rate !== undefined) {
			channel.setGlideRate(rate);
		}
		trackState.glide = true;
	}
}

/**Set Vibrato Depth effect.
 * This effect has a memory.
 * Stored in files as a 16 bit signed multiple of 5/128 cent.
 * Special values: -32768 = reuse previous
 */
class Vibrato extends Effect {

	constructor() {
		super();
		this.cents = undefined;
	}

	clone() {
		const clone = new Vibrato();
		clone.cents = this.cents;
		return clone;
	}

	set(data) {
		const value = data[0];
		if (value === -32768) {
			this.cents = undefined;
		} else {
			this.cents = value * VIBRATO_RANGES[0] / 128;
		}
	}

	get binaryFormat() {
		return ['Int16'];
	}

	apply(trackState, channel, time) {
		let cents = this.cents;
		if (cents === undefined) {
			cents = trackState.vibrato;
		} else if (cents !== 0) {
			trackState.vibrato = cents;
		}
		channel.setVibratoDepth(cents, time);
	}

}

const Effects = {};
// 0x0n	Pitch
Effects[0x01] = Glide;
// 0x1n	Volume
// 0x2n	Pan
// 0x3n	Modulation
Effects[0x33] = Vibrato;
// 0x4n	Articulation
// 0x5n	Samples

export default Effects;
