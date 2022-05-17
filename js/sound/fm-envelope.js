import {cancelAndHoldAtTime} from './common.js';

const OPL_ENVELOPE_TICK = 72 / 3579545;

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

		this.totalLevel = 0;
		this.rateScaling = 1;
		this.attackRate = 31;
		this.decayRate = 0;
		this.sustainRate = 0;
		this.releaseRate = 31;
		this.sustain = 1023;	// Already converted into an attenuation value.
		this.envelopeRate = 1;
		this.reset = false;	// Rapidly fade level to zero before retriggering

		this.velocitySensitivity = 0;
		this.rateSensitivity = 0;
		this.velocity = 127;

		this.inverted = false;
		this.jump = false;	// Jump to high level at end of envelope (or low if inverted)
		this.looping = false;

		// Values stored during key on.
		this.wasInverted = false;
		this.beginLevel = 0;
		this.hasDampen = false;
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
		envelope.setTotalLevel(this.totalLevel);
		envelope.rateScaling = this.rateScaling;
		envelope.attackRate = this.attackRate;
		envelope.decayRate = this.decayRate;
		envelope.sustain = this.sustain;
		envelope.sustainRate = this.sustainRate;
		envelope.releaseRate = this.releaseRate;
		envelope.reset = this.reset;
		envelope.velocitySensitivity = this.velocitySensitivity;
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
		this.totalLevelNode = undefined;
	}

	getScaledAttack(velocity) {
		if (this.rateSensitivity === 0) {
			return this.attackRate;
		}
		const attack = this.attackRate +
			Math.round((this.velocity >> 3) / 15 * this.rateSensitivity);
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
		return Math.trunc(keyCode / 2 ** (4 - scaling));
	}

	dampenTime(from, rateAdjust) {
			const distance = Math.ceil(from / 2);	// OPL has 512 levels instead of 1024
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
		this.setVelocity(velocity, time);
		const rateAdjust = this.rateAdjustment(operator.keyCode);
		const tickRate = this.channel.synth.envelopeTick;
		const gain = this.gain;
		const invert = this.inverted;
		const envelopeRate = this.envelopeRate;
		this.wasInverted = invert;

		let beginLevel = 0;
		let postAttackLevel = 1023;
		this.beginDampen = time;
		this.hasDampen = false;
		let endDampen = time;
		const endRelease = this.endRelease;
		if (invert) {
			beginLevel = 1023;
			postAttackLevel = 0;
			this.beginLevel = 1023;
		} else if (endRelease > 0) {
			//I.e. it's not the first time the envelope ran.
			if (time < endRelease) {
				// Still in the release phase
				const beginRelease = this.beginRelease;
				const timeProportion = (time - beginRelease) / (endRelease - beginRelease);
				beginLevel = this.releaseLevel * (1 - timeProportion);
			}
			this.beginLevel = beginLevel;
			if (this.reset && beginLevel > 0) {
				cancelAndHoldAtTime(gain, beginLevel / 1023, time);
				endDampen += this.dampenTime(beginLevel, rateAdjust);
				gain.linearRampToValueAtTime(0 / 1023, endDampen);
				beginLevel = 0;
				this.hasDampen = true;
			}
		}

		this.beginAttack = endDampen;
		this.hasAttack = true;
		let endAttack = endDampen;
		let attackRate = this.getScaledAttack(velocity);
		if (attackRate > 0) {
			attackRate = Math.min(2 * attackRate + rateAdjust, 63);
		}
		if (attackRate <= 1) {
			// Level never changes
			if (beginLevel === 0) {
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
				let playbackRate = baseRate * scaleFactor * buffer.sampleRate * me.synth.envelopeTick * me.envelopeRate / 6;
				const sampleNode = new AudioBufferSourceNode(context,
					{buffer: buffer, loop: true, loopEnd: Number.MAX_VALUE, playbackRate: playbackRate}
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
		}

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

		const decay = this.decayTime(1023, this.sustain, this.decayRate, rateAdjust) / envelopeRate;
		const endDecay = endAttack + decay;
		const sustain = invert ? 1023 - this.sustain : this.sustain;
		let finalValue = invert ? 1 : 0
		gain.linearRampToValueAtTime(sustain / 1023, endDecay);
		this.endDecay = endDecay;
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
			const sustainTime = this.decayTime(this.sustain, 0, Math.abs(sustainRate), rateAdjust) / envelopeRate;
			let timeConstant;
			if (sustainRate > 0) {
				endSustain += sustainTime;
				timeConstant = 0;	// Doesn't apply
				gain.linearRampToValueAtTime(finalValue, endSustain);
			} else {
				endSustain = Infinity;
				finalValue = 1 - finalValue;
				timeConstant = sustainTime / 3;
				gain.setTargetAtTime(finalValue, endDecay, timeConstant)
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
		const endAttack = this.endAttack;
		let linearValue;

		if (time < this.beginAttack) {

			return this.beginLevel *
				(time - this.beginDampen) / (this.beginAttack - this.beginDampen);

		} else if (!this.hasAttack) {

			// Attack rate was 0.
			return this.hasDampen ? 0 : this.beginLevel;

		} else if (time <= this.endAttack) {

			const beginLevel = this.beginLevel;
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
		let currentValue;
		if (time < this.beginAttack) {
			// Continue release
			currentValue = this.beginLevel;
			time = this.beginAttack;
		} else {
			currentValue = this.linearValueAtTime(time);
		}

		if (this.sampleNode) {
			this.sampleNode.stop(time);
			this.sampleNode = undefined;
		}
		const rateAdjust = this.rateAdjustment(operator.keyCode);
		const envelopeRate = this.envelopeRate;
		const releaseTime = this.decayTime(currentValue, 0, this.releaseRate, rateAdjust) / envelopeRate;
		const gain = this.gain;
		cancelAndHoldAtTime(gain, currentValue / 1023, time);
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

	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.totalLevel = level;
		// Higher velocities result in less attenuation when a positive sensitivity setting is used.
		level = ((level << 7) - 2 * this.velocitySensitivity * this.velocity) >> 7;
		level = Math.min(Math.max(level, 0), 127);
		this.totalLevelNode.offset[method](-level / 128, time);
	}

	getTotalLevel() {
		return this.totalLevel;
	}

	/**
	 * @param {number} sensitivity Range -127..127. The SY77 has a range -7..7 and the YC88, etc.
	 * series of organs have a touch sensitivity depth range of 0..127 (see supplementary
	 * manual). To emulate the organs' touch sensitivity offset parameter, set totalLevel equal
	 * to 255 minus twice the offset.
	 */
	setVelocitySensitivity(sensitivity) {
		this.velocitySensitivity = sensitivity;
	}

	getVelocitySensitivity() {
		return this.velocitySensitivity;
	}

	setVelocity(velocity, time = 0, method = 'setValueAtTime') {
		this.velocity = velocity;
		this.setTotalLevel(this.totalLevel, time, method);
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
			gain -= 512;
		}
		this.sustain = gain;
	}

	getSustain() {
		let gain = this.sustain;
		if (gain === 1023) {
			return 0;
		} else if (gain < 512) {
			gain += 512;
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
			this.envelopeRate = 6;
		}
	}

	getSSG() {
		const value =
			8 * (this.inverted || this.jump || this.looping || this.envelopeRate === 6) +
			4 * this.inverted +
			!this.looping +
			2 * (this.looping ^ this.jump);
		return value;
	}

	setEnvelopeRate(rate) {
		this.envelopeRate = rate < 0 ? -1 / rate : rate;
	}

	getEnvelopeRate() {
		const rate = this.envelopeRate;
		return rate < 1 ? Math.round(-10 / rate) / 10 : rate;
	}

	static async makeSSGSample(decayRate, sustainLevel, sustainRate, invert, mirror, sampleRate) {
		let decayPower = Math.trunc(-decayRate / 4) + 14;
		let sustainPower = Math.trunc(-sustainRate / 4) + 14;
		// Subtract 3 because the deduction of 4, 5, 6 or 7 must be spread out over 8 steps.
		let commonPower = Math.min(decayPower, sustainPower) - 3;
		const playbackRate = 2 ** -commonPower;

		let decayMod = Envelope.incrementMultiple[decayRate];
		let sustainMod = Envelope.incrementMultiple[sustainRate];
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

		decayPower -= commonPower;
		sustainPower -= commonPower;

		// SSG operates 6 times faster than the normal envelope.
		const decayGradient = (2 ** decayPower) / (6 * decayMod);
		const sustainGradient = (2 ** sustainPower) / (6 * sustainMod);
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

	static attackTarget = [1032.48838867428, 1032.48838867428, 1032.48838867428,
	1032.48838867428, 1032.53583418919, 1032.53583418919, 1032.48838867428, 1032.47884850242,
	1032.53583418919, 1032.32194631456, 1032.48838867428, 1032.47884850242, 1032.53583418919,
	1032.32194631456, 1032.48838867428, 1032.47884850242, 1032.53583418919, 1032.32194631456,
	1032.48838867428, 1032.47884850242, 1032.53583418919, 1032.32194631456, 1032.48838867428,
	1032.47884850242, 1032.53583418919, 1032.32194631456, 1032.48838867428, 1032.47884850242,
	1032.53583418919, 1032.32194631456, 1032.48838867428, 1032.47884850242, 1032.53583418919,
	1032.32194631456, 1032.48838867428, 1032.47884850242, 1032.53583418919, 1032.32194631456,
	1032.48838867428, 1032.47884850242, 1032.53583418919, 1032.32194631456, 1032.48838867428,
	1032.47884850242, 1032.53583418919, 1032.32194631456, 1032.48840023324, 1031.31610973218,
	1031.52352501199, 1031.65420794345, 1033.03574873511, 1033.43041057801, 1033.37306598363,
	1035.4171820433, 1035.39653268357, 1034.15032097183, 1032.96478469666, 1029.17518847789,
	1030.84690128005, 1030.84690128005];

	static attackConstant = [63279.2004921133, 63279.2004921133, 31639.6002460567,
	31639.6002460567, 21091.98357754, 21091.98357754, 15819.8001230283, 12657.5084839186,
	10545.99178877, 9032.5441919039, 7909.90006151416, 6328.75424195932, 5272.995894385,
	4516.27209595195, 3954.95003075708, 3164.37712097966, 2636.4979471925, 2258.13604797597,
	1977.47501537854, 1582.18856048983, 1318.24897359625, 1129.06802398799, 988.73750768927,
	791.094280244915, 659.124486798125, 564.534011993994, 494.368753844635, 395.547140122458,
	329.562243399062, 282.267005996997, 247.184376922318, 197.773570061229, 164.781121699531,
	141.133502998498, 123.592188461159, 98.8867850306144, 82.3905608497656, 70.5667514992492,
	61.7960942305794, 49.4433925153072, 41.1952804248828, 35.2833757496246, 30.8980471152897,
	24.7216962576536, 20.5976402124414, 17.6416878748123, 15.4490240655454, 12.2013635004957,
	10.1012241857225, 8.60768940429353, 7.51608965104502, 5.82598001278768, 4.78058630318776,
	4.03544786153862, 3.49406413913649, 2.59733598774052, 2.05386854284152, 1.6949173421721,
	1.42848405503094, 1.42848405503094];

}

for (let i = 0; i <= 63; i++) {
		Envelope.increment[i] = Envelope.incrementMultiple[i] * 2 ** ((i >> 2) - 14);
}
