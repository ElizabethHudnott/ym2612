/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2023. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
import {cancelAndHoldAtTime, ClockRate} from './common.js';

const OPL_ENVELOPE_TICK = 72 / (ClockRate.NTSC / 15);

export default class Envelope {

	// For calculating decay, sustain and release
	static incrementMultiple = [
		0, 3, 4, 4,		// 0-3
		4, 4, 6, 6,		// 4-7
		4, 5, 6, 7,		// 8-11
		4, 5, 6, 7,		// 12-15
		4, 5, 6, 7,		// 16-19
		4, 5, 6, 7,		// 20-23
		4, 5, 6, 7,		// 24-27
		4, 5, 6, 7,		// 28-31
		4, 5, 6, 7,		// 32-35
		4, 5, 6, 7,		// 36-39
		4, 5, 6, 7,		// 40-43
		4, 5, 6, 7,		// 44-47
		4, 5, 6, 7,		// 48-51
		4, 5, 6, 7,		// 52-55
		4, 5, 6, 7,		// 56-59
		4, 4, 4, 4		// 60-63
	];

	static increment = new Array(64);

	/**Creates an envelope.
	 * @param {GainNode} output The GainNode to be controlled by the envelope.
	 */
	constructor(channel, context, output, dbCurve) {
		this.channel = channel;
		output.gain.value = 0;
		const gainNode = new ConstantSourceNode(context, {offset: 0});
		this.gainNode = gainNode;
		this.gain = gainNode.offset;

		const totalLevelNode = new ConstantSourceNode(context, {offset: 0});
		this.totalLevelNode = totalLevelNode;
		this.totalLevelParam = totalLevelNode.offset;
		const shaper = new WaveShaperNode(context, {curve: dbCurve});
		this.shaper = shaper;
		gainNode.connect(shaper);
		totalLevelNode.connect(shaper);
		shaper.connect(output.gain);

		this.totalLevel = 0;		// Converted to an attenuation value, 0..1023
		this.rateScaling = 1;
		this.attackRate = 31;
		this.decayRate = 0;
		this.sustainRate = 0;
		this.releaseRate = 31;
		this.sustain = 1023;		// Converted into an attenuation value.
		this.envelopeRate = 1;
		this.reset = false;		// Rapidly fade level to zero before retriggering

		// Default to no velocity sensitivity.
		this.velocitySensitivity = 0;
		// Default to velocity sensitivity applying to the whole range of velocity inputs.
		this.velocityOffset = 0;
		this.rateSensitivity = 0;

		this.inverted = false;
		this.jump = false;	// Jump to high level at end of envelope (or low if inverted)
		this.looping = false;

		// Values stored during key on.
		this.wasInverted = false;
		this.keyOnLevel = 0;		// Equal to beginLevel unless a dampening phase is included
		this.beginLevel = 0;		// Level at beginning of attack phase
		this.hasAttack = true;
		this.beginDampen = Infinity;
		this.beginAttack = Infinity;
		this.prevAttackRate = 0;
		this.prevSustainTC = 0;
		this.endAttack = 0;
		this.endDecay = 0;
		this.endSustain = 0;
		this.beginRelease = 0;
		this.releaseLevel = 0;
		this.endRelease = 0;

		this.sampleNode = undefined;
		this.ssgSample = undefined;
		this.ssgBaseRate = undefined;
		this.loopDecay = undefined;
		this.loopSustain = undefined;
		this.loopSustainRate = undefined;
		this.loopInverted = undefined;
		this.loopJump = undefined;
		this.ssgPlaybackRate = 0;
	}

	copyTo(envelope) {
		envelope.rateScaling = this.rateScaling;
		envelope.attackRate = this.attackRate;
		envelope.decayRate = this.decayRate;
		envelope.sustain = this.sustain;
		envelope.sustainRate = this.sustainRate;
		envelope.releaseRate = this.releaseRate;
		envelope.reset = this.reset;
		envelope.velocitySensitivity = this.velocitySensitivity;
		envelope.velocityOffset = this.velocityOffset;
		envelope.rateSensitivity = this.rateSensitivity;
		envelope.inverted = this.inverted;
		envelope.jump = this.jump;
		envelope.looping = this.looping;
	}

	start(time = 0) {
		this.gainNode.start(time);
		this.totalLevelNode.start(time);
	}

	stop(time = 0) {
		this.gainNode.stop(time);
		this.totalLevelNode.stop(time);
		this.gainNode = undefined;
		this.gain = undefined;
		this.totalLevelNode = undefined;
		this.totalLevelParam = undefined;
	}

	getScaledAttack(velocity) {
		if (this.rateSensitivity === 0) {
			return this.attackRate;
		}
		const attack = this.attackRate +
			Math.round((velocity >> 3) / 15 * this.rateSensitivity);
		return Math.min(Math.max(attack, 2), 31);
	}

	rateAdjustment(keyCode) {
		let scaling = this.rateScaling;
		if (scaling === 0) {
			return 0;
		}
		if (scaling < 0) {
			keyCode = 31 - keyCode;
			scaling = -scaling;
		}
		return keyCode >> (4 - scaling);
	}

	dampenTime(from, to, rateAdjust) {
			// OPL has 512 levels instead of 1024
			const distance = Math.ceil((from - to) / 2);
			const rate = Math.min(48 + rateAdjust, 63);
			const gradient = Envelope.increment[rate];
			return OPL_ENVELOPE_TICK * Math.ceil(distance / gradient);
	}

	/**
	 * Don't call with rate = 0, because that means infinite time.
	 */
	decayTime(from, to, basicRate, rateAdjust) {
		const rate = Math.min(2 * basicRate + rateAdjust, 63);
		const gradient = Envelope.increment[rate];
		return this.channel.synth.envelopeTick * Math.ceil((from - to) / gradient);
	}

	/**Opens the envelope at a specified time.
	 */
	keyOn(context, velocity, operator, time) {
		const rateAdjust = this.rateAdjustment(operator.keyCode);
		const tickRate = this.channel.synth.envelopeTick;
		const gain = this.gain;
		const invert = this.inverted;
		const envelopeRate = this.envelopeRate;
		this.wasInverted = invert;

		let beginLevel = 0;
		let postAttackLevel = 1023;
		this.beginDampen = time;
		let endDampen = time;
		const endRelease = this.endRelease;

		const oldTotalLevel = this.totalLevel;
		this.#setVelocity(velocity, time);
		const newTotalLevel = this.totalLevel;

		if (invert) {
			// Special case 1: Jump to maximum level
			this.keyOnLevel = 1023;
			beginLevel = 1023;
			postAttackLevel = 0;
		} else if (endRelease > 0) {
			//I.e. it's not the first time the envelope ran.
			if (time < endRelease) {
				// Still in the release phase
				const beginRelease = this.beginRelease;
				const timeProportion = (time - beginRelease) / (endRelease - beginRelease);
				beginLevel = this.releaseLevel * (1 - timeProportion);
			}
			beginLevel = Math.max(beginLevel - oldTotalLevel, 0) + newTotalLevel;
			this.keyOnLevel = beginLevel;	// Level before dampening
			if (beginLevel > 1023) {
				// Special case 2: Current output is louder than maximum amplitude for the new
				// lower velocity.
				cancelAndHoldAtTime(gain, beginLevel / 1023, time);
				endDampen += this.dampenTime(beginLevel, 1023, rateAdjust);
				gain.linearRampToValueAtTime(1, endDampen);
				beginLevel = 1023;	// Level after dampening
			} else if (this.reset && beginLevel > newTotalLevel) {
				// Special case 3: Quickly fade to zero and then climb from zero.
				cancelAndHoldAtTime(gain, beginLevel / 1023, time);
				endDampen += this.dampenTime(beginLevel, newTotalLevel, rateAdjust);
				gain.linearRampToValueAtTime(newTotalLevel / 1023, endDampen);
				beginLevel = newTotalLevel;	// Level after dampening
			}
		}

		this.beginLevel = beginLevel;
		this.beginAttack = endDampen;
		this.hasAttack = true;
		let endAttack = endDampen;
		let attackRate = this.getScaledAttack(velocity);
		if (attackRate > 0) {
			attackRate = Math.min(2 * attackRate + rateAdjust, 63);
		}
		if (attackRate <= 1) {
			// Level never changes
			if (beginLevel === newTotalLevel) {
				this.endSustain = endDampen;
				this.channel.scheduleSoundOff(operator, endDampen);
			} else {
				cancelAndHoldAtTime(gain, beginLevel / 1023, endDampen);
				this.hasAttack = false;
				this.endAttack = endDampen;
				this.endDecay = Infinity;
				this.endSustain = Infinity;
			}
			return;
		} else if (attackRate < 62 && beginLevel !== postAttackLevel) {
			// Non-infinite attack
			cancelAndHoldAtTime(gain, beginLevel / 1023, endDampen);
			let target = Envelope.attackTarget[attackRate - 2];
			if (invert) {
				target = 1023 - target;
			}
			const timeConstant = Envelope.attackConstant[attackRate - 2] * tickRate;
			gain.setTargetAtTime(target / 1023, endDampen, timeConstant);
			const attackTime = -timeConstant *
				Math.log((postAttackLevel - target) / (beginLevel - target));
			endAttack += attackTime;
			this.prevAttackRate = attackRate;
		}
		cancelAndHoldAtTime(gain, postAttackLevel / 1023, endAttack);
		this.endAttack = endAttack;

		if (this.looping && this.decayRate > 0 && (this.sustainRate > 0 || this.sustain === 0)) {
			const decayInc = Envelope.increment[2 * this.decayRate];
			const scaledDecayRate = Math.min(2 * this.decayRate + rateAdjust, 63);
			const scaledDecayInc = Envelope.increment[scaledDecayRate];
			const decayMult = scaledDecayInc / decayInc;
			let scaleFactor;

			if (this.sustainRate === 0) {
				scaleFactor = decayMult;
			} else {
				const sustainInc = Envelope.increment[2 * this.sustainRate];
				const scaledSustainRate = Math.min(2 * this.sustainRate + rateAdjust, 63);
				const scaledSustainInc = Envelope.increment[scaledSustainRate];
				const sustainMult = scaledSustainInc / sustainInc;
				const proportion = this.sustain / 1023;
				scaleFactor = decayMult * (1 - proportion) + sustainMult * proportion;
			}

			const me = this;
			function playSample(args) {
				const buffer = args[0];
				const baseRate = args[1];
				let playbackRate = baseRate * scaleFactor * buffer.sampleRate * me.channel.synth.envelopeTick * me.envelopeRate / 4;
				const sampleNode = new AudioBufferSourceNode(context,
					{buffer: buffer, loop: true, playbackRate: playbackRate}
				);
				sampleNode.connect(me.shaper);
				sampleNode.start(endAttack);
				gain.setValueAtTime(0, endAttack);
				me.sampleNode = sampleNode;
				me.ssgSample = buffer;
				me.ssgBaseRate = baseRate;
				me.ssgPlaybackRate = playbackRate;
			}

			if (
				this.decayRate !== this.loopDecay ||
				this.sustain !== this.loopSustain ||
				this.sustainRate !== this.loopSustainRate ||
				invert != this.loopInverted ||
				this.jump !== this.loopJump
			) {
				Envelope.makeSSGSample(
					2 * this.decayRate, this.sustain, 2 * this.sustainRate, invert, !this.jump,
					context.sampleRate
				)
				.then(playSample);
				this.loopDecay = this.decayRate;
				this.loopSustain = this.sustain;
				this.loopSustainRate = this.sustainRate;
				this.loopInverted = invert;
				this.loopJump = this.jump;
			} else {
				playSample([this.ssgSample, this.ssgBaseRate]);
			}
			return;
		}	// End looping envelope

		let endDecay = endAttack;
		const sustain = invert ? 1023 - this.sustain : this.sustain;

		if (this.sustain < 1023) {
			if (this.decayRate === 0) {
				let endTime;
				if (invert) {
					endTime = endAttack;
					this.channel.scheduleSoundOff(operator, endAttack);
				} else {
					endTime = Infinity;
				}
				this.endDecay = endTime;
				this.endSustain = endTime;
				return;
			}

			endDecay += this.decayTime(1023, this.sustain, this.decayRate, rateAdjust) / envelopeRate;
			gain.linearRampToValueAtTime(sustain / 1023, endDecay);
		}

		this.endDecay = endDecay;
		let finalValue = invert ? 1 : 0
		let endSustain = endDecay;
		if (this.sustainRate === 0) {

			// Infinite sustain or no sustain
			this.prevSustainTC = 0;
			if (sustain === 0) {
				this.endSustain = endDecay;
			} else {
				this.endSustain = Infinity;
				return;
			}

		} else {

			// Sustain phase
			const sustainRate = this.sustainRate;
			let sustainTime, timeConstant;
			if (sustainRate > 0) {
				sustainTime = this.decayTime(this.sustain, 0, sustainRate, rateAdjust) / envelopeRate;
				endSustain += sustainTime;
				timeConstant = 0;	// Doesn't apply
				gain.linearRampToValueAtTime(finalValue, endSustain);
			} else {
				// Inspired by Novation SuperNova
				sustainTime = this.decayTime(1023, this.sustain, -sustainRate, rateAdjust) / envelopeRate;
				endSustain = Infinity;
				finalValue = 1 - finalValue;
				timeConstant = sustainTime / 3;
				gain.setTargetAtTime(finalValue, endDecay, timeConstant);
			}
			this.prevSustainTC = timeConstant;

		}

		if (this.jump) {
			finalValue = 1 - finalValue;
			endSustain += tickRate;
			gain.linearRampToValueAtTime(finalValue, endSustain);
		}
		this.endSustain = endSustain;
		if (finalValue === 0) {
			this.channel.scheduleSoundOff(operator, endSustain);
		}
	}

	linearValueAtTime(time) {
		const beginLevel = this.beginLevel;
		const endAttack = this.endAttack;
		let linearValue;

		if (time < this.beginAttack) {
			const keyOnLevel = this.keyOnLevel;
			const dampenTime = (this.beginAttack - this.beginDampen);
			if (dampenTime === 0) {
				return keyOnLevel;
			}
			return keyOnLevel - (keyOnLevel - beginLevel) *
				(time - this.beginDampen) / dampenTime;

		} else if (!this.hasAttack) {

			// Attack rate was 0.
			return beginLevel;

		} else if (time <= this.endAttack) {

			if (time === this.beginAttack) {
				return beginLevel;
			}

			// In the attack phase.
			const attackRate = this.prevAttackRate;
			let target = Envelope.attackTarget[attackRate - 2];
			if (this.wasInverted) {
				target = 1023 - target;
			}
			const timeConstant = Envelope.attackConstant[attackRate - 2] * this.channel.synth.envelopeTick;
			const beginAttack = this.beginAttack;
			return target + (beginLevel - target) * Math.exp(-(time - beginAttack) / timeConstant);

		} else if (this.sampleNode) {

			// Looping envelope
			const sample = this.ssgSample;
			const loopOffset =
				Math.round((time - this.endAttack) * sample.sampleRate * this.ssgPlaybackRate) %
				sample.length;
			const data = sample.getChannelData(0);
			return 1023 * data[loopOffset];

		}

		const endDecay = this.endDecay;
		const endSustain = this.endSustain;

		if (time >= endSustain) {

			// Sustain decayed to zero
			if (this.prevSustainTC !== 0) {
				// Negative sustain rate
				linearValue = 1023;
			} else {
				linearValue = 0;
			}
			if (this.jump) {
				linearValue = 1023 - linearValue;
			}

		} else if (time >= endDecay) {

			// In the sustain phase.
			const timeConstant = this.prevSustainTC;
			if (timeConstant !== 0) {
				// Negative sustain rate
				linearValue = 1023 + (this.sustain - 1023) * Math.exp((endDecay - time) / timeConstant);
			} else if (this.endSustain === Infinity) {
				linearValue = this.sustain;
			} else {
				const timeProportion = (time - endDecay) / (endSustain - endDecay);
				linearValue = this.sustain * (1 - timeProportion);
			}

		} else {

			// In the decay phase.
			if (endDecay === Infinity) {
				linearValue = 1023;
			} else {
				const timeProportion = (time - endAttack) / (endDecay - endAttack);
				linearValue = 1023 -  timeProportion * (1023 - this.sustain);
			}

		}

		if (this.wasInverted) {
			linearValue = 1023 - linearValue;
		}
		return linearValue;
	}

	/**Closes the envelope at a specified time.
	 */
	keyOff(operator, time) {

		if (this.sampleNode) {
			this.sampleNode.stop(time);
			this.sampleNode = undefined;
		}
		const gain = this.gain;
		const currentValue = this.linearValueAtTime(time);
		cancelAndHoldAtTime(gain, currentValue / 1023, time);
		const totalLevel = this.totalLevel;
		const rateAdjust = this.rateAdjustment(operator.keyCode);
		const envelopeRate = this.envelopeRate;
		const releaseTime = this.decayTime(
			currentValue, 0, this.releaseRate, rateAdjust
		) / envelopeRate;
		const endRelease = time + releaseTime;
		gain.linearRampToValueAtTime(0, endRelease);

		this.channel.scheduleSoundOff(operator, endRelease);
		this.beginRelease = time;
		this.releaseLevel = currentValue;
		this.endRelease = endRelease;
	}

	/**Cuts audio output without going through the envelope's release phase.
	 * @param {number} time When to stop outputting audio. Defaults to ceasing sound production immediately.
	 */
	soundOff(time = 0) {
		cancelAndHoldAtTime(this.gain, 0, time);
		this.endRelease = time;
	}

	#setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.totalLevel = level * 8;
		this.totalLevelNode.offset[method](-this.totalLevel / 1023, time);
	}

	getTotalLevel() {
		return this.totalLevel / 8;
	}

	/**
	 * @param {number} sensitivity The maximum possible range is -157 to 157. But the MODX only
	 * supports -64 to 63.
	 */
	setVelocitySensitivity(sensitivity) {
		this.velocitySensitivity = sensitivity;
	}

	getVelocitySensitivity() {
		return this.velocitySensitivity;
	}

	/**
	 * @param {number} offset Between 0 and 127
	 */
	setVelocityOffset(offset) {
		this.velocityOffset = offset;
	}

	getVelocityOffset() {
		return this.velocityOffset;
	}

	#setVelocity(velocity, time) {
		let depth = this.velocitySensitivity;
		if (depth < 0) {
			velocity = 128 - velocity;
			depth = -depth;
		}
		const gradient = depth <= 32 ? depth / 32 : depth - 31;
		let level = 127 - (127 - this.velocityOffset - velocity) * gradient;
		level = Math.min(Math.max(level, 1), 127);
		this.#setTotalLevel(127 - level, time);
	}

	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.#setTotalLevel(level, time, method);
		this.velocitySensitivity = 0;
	}

	/**
	 * @param {number} sensitivity Yamaha use the range -12..12.
	 */
	setRateSensitivity(sensitivity) {
		if (sensitivity < 0) {
			this.attackRate = Math.max(this.attackRate, 2 + sensitivity);
		} else {
			this.attackRate = Math.min(this.attackRate, 31 - sensitivity);
		}
		this.rateSensitivity = sensitivity;
	}

	getRateSensitivity() {
		return this.rateSensitivity;
	}

	/**
	 * @param {number} amount 1..4 correspond to 0..3 on 4 operator Yamaha chips.
	 * For positive values the envelope runs faster for higher pitches and slower for lower ones.
	 * For negative values the envelope runs faster for lower pitches and slower for higher ones.
	 * Setting to 0 applies no rate scaling at all.
	 */
	setRateScaling(amount) {
		this.rateScaling = amount;
	}

	getRateScaling() {
		return this.rateScaling;
	}

	setAttack(rate) {
		this.attackRate = rate;
	}

	getAttack() {
		return this.attackRate;
	}

	setDecay(rate) {
		this.decayRate = rate;
	}

	getDecay() {
		return this.decayRate;
	}

	/**
	 * @param {number} level Between 0 and 16
	 */
	setSustain(level) {
		let gain = level === 0 ? 1023 : 1024 - level * 32;
		if (level > 14) {
			gain -= Math.min(level - 14, 1) * 512;
		}
		this.sustain = gain;
	}

	getSustain() {
		let gain = this.sustain;
		if (gain === 1023) {
			return 0;
		} else if (gain <= 32) {
			gain += 512;
		} else if (gain < 576) {
			gain += (576 - gain) * 512 / 544;
		}
		return (1024 - gain) / 32;
	}

	setSustainRate(rate) {
		this.sustainRate = rate;
	}

	getSustainRate() {
		return this.sustainRate;
	}

	setRelease(rate) {
		this.releaseRate = rate * 2 + 1;
	}

	getRelease() {
		return (this.releaseRate - 1) / 2;
	}

	setSSG(mode) {
		if (mode < 8) {
			// SSG disabled
			this.inverted = false;
			this.jump = false;
			this.looping = false;
			this.envelopeRate = 1;
		} else {
			mode -= 8;
			this.inverted = mode >= 4;
			this.jump = [0, 3, 4, 7].includes(mode);
			this.looping = mode % 2 === 0;
			this.envelopeRate = 4;
		}
	}

	getSSG() {
		const value =
			8 * (this.inverted || this.jump || this.looping || this.envelopeRate === 4) +
			4 * this.inverted +
			!this.looping +
			2 * (this.looping ^ this.jump);
		return value;
	}

	setEnvelopeRate(rate) {
		this.envelopeRate = rate;
	}

	getEnvelopeRate() {
		return this.envelopeRate;
	}

	static async makeSSGSample(decayRate, sustainLevel, sustainRate, invert, mirror, sampleRate) {
		let decayPower = Math.trunc(-decayRate / 4) + 14;
		let sustainPower = Math.trunc(-sustainRate / 4) + 14;
		// Subtract 3 because the deduction of 4, 5, 6 or 7 must be spread out over 8 steps.
		let commonPower = Math.min(decayPower, sustainPower) - 3;

		let decayMod = Envelope.incrementMultiple[decayRate];
		let sustainMod = Envelope.incrementMultiple[sustainRate];
		if (decayRate < 48 && sustainRate < 48) {
			const totalMod = decayMod + sustainMod;
			if (totalMod === 4 || totalMod === 8) {
				/* Instead of 4 steps out of every 8, change to 1 step out of every 2
				 * (repeating 01 pattern). totalMod equal to 4 implies decay to silence, no sustain.
				 */
				decayMod = 1;
				sustainMod = 1;
				commonPower += 2;
			} else if (totalMod === 6 || totalMod === 12) {
				/* Instead of 6 steps out of every 8, change to 3 steps out of every 4
				 * (repeating 0111 pattern).
				 */
				decayMod = 3;
				sustainMod = 3;
				commonPower++;
			}
		}

		decayPower -= commonPower;
		sustainPower -= commonPower;
		const playbackRate = 2 ** -commonPower;

		// SSG operates 4 times faster than the normal envelope.
		const decayGradient = (2 ** decayPower) / (4 * decayMod);
		const sustainGradient = (2 ** sustainPower) / (4 * sustainMod);
		const decaySteps = Math.ceil((1023 - sustainLevel) * decayGradient);
		// Handle case when the gradient is infinite.
		const sustainSteps = sustainLevel === 0 ? 0 : Math.ceil(sustainLevel * sustainGradient);
		const totalSteps = decaySteps + sustainSteps;

		const context = new OfflineAudioContext(1, totalSteps * (mirror ? 2 : 1), sampleRate);
		const constant = new ConstantSourceNode(context, {offset: invert ? 0 : 1});
		const offset = constant.offset;
		constant.connect(context.destination);
		constant.start();
		const decayTime = decaySteps / sampleRate;
		const endTime = totalSteps / sampleRate;
		const endSustain2 = (totalSteps + sustainSteps) / sampleRate;
		if (invert) {
			const invertedSustain = 1023 - sustainLevel;
			offset.linearRampToValueAtTime(invertedSustain / 1023, decayTime);
			offset.linearRampToValueAtTime(1, endTime);
			if (mirror) {
				offset.linearRampToValueAtTime(invertedSustain / 1023, endSustain2);
				offset.linearRampToValueAtTime(0, 2 * endTime);
			}
		} else {
			offset.linearRampToValueAtTime(sustainLevel / 1023, decayTime);
			offset.linearRampToValueAtTime(0, endTime);
			if (mirror) {
				offset.linearRampToValueAtTime(sustainLevel / 1023, endSustain2);
				offset.linearRampToValueAtTime(1, 2 * endTime);
			}
		}

		const buffer = await context.startRendering();
		return [buffer, playbackRate];
	}

	static attackTarget = [1031.35080816652, 1031.35080816652, 1031.35080816652,
		1031.35080816652, 1031.73435424707, 1031.73435424707, 1031.35080816652, 1032.58155562439,
		1031.73435424707, 1032.11316327778, 1031.35080816652, 1032.58155562439, 1031.73435424707,
		1032.11316327778, 1031.35080816652, 1032.58155562439, 1031.73435424707, 1032.11316327778,
		1031.35080816652, 1032.58155562439, 1031.73435424707, 1032.11316327778, 1031.35080816652,
		1032.58155562439, 1031.73435424707, 1032.11316327778, 1031.35080816652, 1032.58155562439,
		1031.73435424707, 1032.11316327778, 1031.35080816652, 1032.58155562439, 1031.73435424707,
		1032.11316327778, 1031.35080816652, 1032.58155562439, 1031.73435424707, 1032.11316327778,
		1031.35080816652, 1032.58155562439, 1031.73435424707, 1032.11316327778, 1031.35080816652,
		1032.58155562439, 1031.73435424707, 1032.11316327778, 1031.37736064289, 1031.0567507854,
		1029.12898814609, 1028.94703231102, 1027.67099790401, 1027.72580631523, 1026.45148465419,
		1026.50415386141, 1025.41163434871, 1027.86242754534, 1026.63986469481, 1027.890542526,
		1023.99999187562, 1023.99999187562];

	static attackConstant = [63342.1824, 63342.1824, 31671.0912, 31671.0912, 21030.516736,
		21030.516736, 15835.5456, 12800.061952, 10515.258368, 9093.285376, 7917.7728,
		6400.030976, 5257.629184, 4546.642688, 3958.8864, 3200.015488, 2628.814592, 2273.321344,
		1979.4432, 1600.007744, 1314.407296, 1136.660672, 989.7216, 800.003872, 657.203648,
		568.330336, 494.8608, 400.001936, 328.601824, 284.165168, 247.4304, 200.000968,
		164.300912, 142.082584, 123.7152, 100.000484, 82.150456, 71.041292, 61.8576, 50.000242,
		41.075228, 35.520646, 30.9288, 25.000121, 20.537614, 17.760323, 15.459874, 12.36647,
		10.149434, 8.732101, 7.41609, 6.131475, 4.916543, 4.225378, 3.469615, 2.988588,
		2.304106638424, 2.05685878677022, 1.44269335182259, 1.44269335182259];

}

for (let i = 0; i <= 63; i++) {
		Envelope.increment[i] = Envelope.incrementMultiple[i] * 2 ** ((i >> 2) - 14);
}
