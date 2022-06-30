import {VIBRATO_RANGES} from './common.js';

class Effect {

	clone() {
		const clone = Object.create(this.constructor);
		Object.assign(clone, this);
		return clone;
	}

	/** Applies the effect.
	 */
	apply(trackState, channel, time) {
		// Override in the subclass
		throw new Error("Effect hasn't implemented the apply method.");
	}

	/**
	 * @return {String[]} List of types.
	 */
	get binaryFormat() {
		return ['UInt8'];
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
 * Special values: 0 = reuse previous (maps to undefined)
 */
class Glide extends Effect {

	constructor(data) {
		super();
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
 * Special values: -32768 = reuse previous (maps to undefined)
 */
class Vibrato extends Effect {

	constructor(data) {
		super();
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

/**Set Gate Length effect
 * Special values:
 * 	193 reuse the last value applied that was 72 or less
 * 	194 reuse the last value that was between 72 and 127
 * 	195 reuse the last value that 127 or more
 * 	196-255 invalid
 *
 * Regular values:
 * 192	 1/1
 * 144	 1/2	dotted
 * 128	 1/1	triplet
 * 96		 1/2
 * 72		 1/4	dotted
 * 64		 1/2	triplet
 * 48		 1/4
 * 36		 1/8	dotted
 * 32		 1/4	triplet
 * 24		 1/8
 * 18		1/16	dotted
 * 16		 1/8	triplet
 * 12		1/16
 * 9		1/32	dotted
 * 8		1/16	triplet
 * 6		1/32
 * 4		1/32	triplet
 * 3		1/64
 * 2		1/64	triplet
 * 1		1/128	triplet
 */
class GateLength extends Effect {

	constructor(data) {
		super();
		const value = data[0];
		if (value > 192) {
			// Refers to a preset, not a fixed amount.
			this.preset = value - 193;
			this.length = undefined;
		} else {
			if (value < 72) {
				this.preset = 0;
			} else if (value < 128) {
				this.preset = 1;
			} else {
				this.preset = 2;
			}
			this.length = data[0] / 192;
		}
	}

	apply(trackState, channel, time) {
		const length = this.length;
		if (length === undefined) {
			trackState.gateLength = trackState.gateLengthPresets[this.preset];
		} else {
			trackState.gateLength = length;
			trackState.gateLengthPresets[this.preset] = length;
		}
	}

}

class Retrigger extends Effect {

	constructor(data) {
		super();
		this.ticks = data[0];
		// -127 = reduce by 50%, +127 = double
		this.velocityMultiple = 1 + data[1] / (data[1] >= 0 ? 127 : 254);
	}

	get binaryFormat() {
		return ['Int8'];
	}

	apply(trackState, channel, time) {
		trackState.retrigger = this;
	}

}

const Effects = {};
const EffectNumbers = {};
// 0x0n	Pitch
Effects[0x01] = Glide;
// 0x1n	Volume
// 0x2n	Pan
// 0x3n	Modulation
Effects[0x32] = Vibrato;
// 0x4n	Articulation
Effects[0x40] = GateLength;
Effects[0x41] = Retrigger;
EffectNumbers.RETRIGGER = 0x41;
// 0x5n	Samples

export {EffectNumbers, Effects};
