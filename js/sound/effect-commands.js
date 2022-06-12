import {VIBRATO_RANGES} from './common.js';

class Effect {

	/** Applies the effect.
	 */
	apply(channel, time) {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the apply method.");
	}

	clone() {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the clone method.");
	}

	get binaryFormat() {
		return 'UInt8';
	}

	/**
	 * @param {number} value The value as it's recorded in a module file.
	 */
	set(value) {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the set method.");
	}

}

/**
 * Stored in files as a 16 bit signed multiple of 5/128 cent.
 */
class Vibrato {

	constructor() {
		this.cents = 0;
	}

	clone() {
		const clone = new Vibrato();
		clone.cents = this.cents;
	}

	set(value) {
		this.cents = value * VIBRATO_RANGES[0] / 128;
	}

	get binaryFormat() {
		return 'Int16';
	}

	apply(channel, time) {
		channel.setVibratoDepth(this.cents, time);
	}

}

const Effects = {};
// 0x0n	Pitch
// 0x1n	Volume
// 0x2n	Pan
// 0x3n	Modulation
Effects[0x33] = Vibrato;
// 0x4n	Articulation
// 0x5n	Samples

export default Effects;
