/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
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
		// Normally overridden in the subclass
	}

	/**
	 * @return {String[]} List of types.
	 */
	get binaryFormat() {
		return ['UInt8'];
	}

}

/**Portamento or Glide effect
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

/**Set Pan effect
 * Range: [-127, +127]
 */
class SetPan extends Effect {

	constructor(data) {
		super();
		this.pan = data[0];
	}

	get binaryFormat() {
		return ['Int8'];
	}

	apply(trackState, channel, time) {
		channel.setPan(this.pan / 127, time);
	}

}

/**Ramp Pan effect
 * Range: [-127, +127]
 */
class RampPan extends Effect {

	constructor(data) {
		super();
		this.pan = data[0];
	}

	get binaryFormat() {
		return ['Int8'];
	}

	apply(trackState, channel, time) {
		channel.rampPan(this.pan / 127, time);
	}

}

/**Set Vibrato Depth.
 * This effect has a memory.
 * Stored in files as a 16 bit signed multiple of 5/128 cent.
 * Special values: -32768 = reuse previous (maps to undefined in the class' properties)
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

/**Set Tremolo Depth (or ring modulation).
 * This effect has a memory.
 * Stored in files as a 16 bit signed value in the range [-2046, 2046], representing
 * [-1023, 1023] in increments of 0.5
 * Special values: -32768 = reuse previous (maps to undefined in the class' properties)
 */
class Tremolo extends Effect {

	constructor(data) {
		super();
		const value = data[0];
		if (value === -32768) {
			this.depth = undefined;
		} else {
			this.depth = value / 2;
		}
	}

	get binaryFormat() {
		return ['Int16'];
	}

	apply(trackState, channel, time) {
		let depth = this.depth;
		if (depth === undefined) {
			depth = trackState.tremolo;
		} else if (depth !== 0) {
			trackState.tremolo = depth;
		}
		channel.setTremoloDepth(depth, time);
	}

}

/**Set Gate Length effect
 * Special values:
 * 	193 reuse the last value applied that was 72 or less (initial value: 48)
 * 	194 reuse the last value that was between 72 and 127 (initial value: 96)
 * 	195 reuse the last value that 127 or more (initial value: 144)
 * 	196-255 invalid
 *
 * Examples of regular values (x/192 for x in [1, 192]):
 * 192	32/32		1/1
 * 186	31/32
 * 180	30/31
 * 174	29/32
 * 168	28/32		7/8
 * 162	27/32
 * 160				5/6
 * 156	26/32
 * 150	25/32
 * 144	24/32		3/4
 * 138	23/32
 * 132	22/32
 * 128				2/3
 * 126	21/32
 * 120	20/32		5/8
 * 114	19/32
 * 108	18/32
 * 102	17/32
 * 96		16/32		1/2
 * 90		15/32
 * 84		14/32
 * 78		13/32
 * 72		12/32		3/8
 * 66		11/32
 * 64					1/3
 * 60		10/32
 * 54		 9/32
 * 48		 8/32		1/4
 * 42		 7/32
 * 36		 6/32		3/16
 * 32					1/6
 * 30		 5/32
 * 24		 4/32		1/8
 * 18		 3/32
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

/**Retrigger effect
 *
 * The first parameter is the spacing between consecutive triggers, measured in ticks.
 *
 * The second parameter specifies an optional velocity change between each note:
 * +127	298.4375%
 * + 64	200%
 * + 32	150%
 * + 21	133%
 * + 16	125%
 * +  8	112.5%
 * +  4	106.25%
 * +  2  103.125%
 * +  1	101.5625%
 *    0	100%
 * -  1	 99.4792%
 * -  6	 96.875% 	(- 3.125%)
 * - 12	 93.75% 		(- 6.25%)
 * - 24	 87.5%		(-12.5%)
 * - 38	 80.2083%
 * - 48	 75%			(-25%)
 * - 64	 66.6667%	(-33.333%)
 * - 96	 50%			(-50%)
 * -128	 33.3333%
 *
 * Given an increase in velocity expressed as a parameter value (1..127), to find the value
 * required to generate a corresponding decrease in velocity (reciprocal multiplier):
 * 	y = ROUND( 192 * (1 / (1 + x / 64) - 1) )
 *
 * And given a decrease in velocity expressed as a parameter value (-1..-127), to find value
 * required to generate a corresponding increase in velocity:
 * 	x = ROUND( 64 * (1 / (1 + y / 192) - 1) )
 *
 * To convert a percentage value of 100% or more to a parameter value:
 * 	v = ROUND( 64 * (p / 100 - 1) )
 *
 * To convert a percentage value less than 100% to a parameter value:
 * 	v = ROUND( 192 * (p / 100 - 1) )
 *
 * To increase the velocity to p% over the course of n notes (p > 100%):
 * 	v = ROUND( 64 * ((p / 100) ** (n - 1) - 1) )
 *
 * To decrease the velocity to p% over the course of n notes:
 * 	v = ROUND( 192 *  ((p / 100) ** (n - 1) - 1) )
 */
class Retrigger extends Effect {

	constructor(data) {
		super();
		this.ticks = data[0];
		if (data[1] >= 0) {
			this.velocityMultiple = 1 + data[1] / 64;
		} else {
			this.velocityMultiple = 1 +  data[1] / 192;
		}
	}

	get binaryFormat() {
		return ['Int8'];
	}

}

class TicksPerRow extends Effect {

	constructor(data) {
		super();
		this.ticks = data[0] + 1;
	}

}

const Effects = {};
const EffectNumbers = {};

// 0x0n	Note
Effects[0x01] = Glide;

// 0x1n	Volume

// 0x2n	Pan
Effects[0x20] = SetPan;
Effects[0x21] = RampPan;

// 0x3n	Modulation
Effects[0x32] = Vibrato;
Effects[0x33] = Tremolo;

// 0x4n	Articulation
Effects[0x40] = GateLength;
Effects[0x41] = Retrigger;
EffectNumbers.RETRIGGER = 0x41;
Effects[0x42] = TicksPerRow;
EffectNumbers.TICKS_PER_ROW = 0x42;

// 0x5n	Samples

export {EffectNumbers, Effects};
