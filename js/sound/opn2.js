import {
	TIMER_IMPRECISION, NEVER, CLOCK_RATE, LFO_FREQUENCIES, VIBRATO_PRESETS
} from './common.js';

let supportsCancelAndHold;

function cancelAndHoldAtTime(param, holdValue, time) {
	if (supportsCancelAndHold) {
		param.cancelAndHoldAtTime(time);
	} else {
		param.cancelScheduledValues(time);
	}
	param.setValueAtTime(holdValue, time);
}

/** Approximately -48db converted to base 2.
 *  https://gendev.spritesmind.net/forum/viewtopic.php?f=24&t=386&p=6114&hilit=48db#p6114
 */
const ATTENUATION_BITS = 10;

/**
 * @param {number} x A number in the range 1023 (loudest) to 0 (silence) to -1023 (loudest, inverted
 * polarity).
 * @return {number} A number in the range 1 (loudest) to 0 (silence) to -1 (loudest, inverted
 * polarity).
 */
function logToLinear(x) {
	return Math.sign(x) * 2 ** (-ATTENUATION_BITS * (1023 - Math.abs(x)) / 1024);
}

/**
 * @param {number} y A number in the range 1 (loudest) to 0 (silence) to -1 (loudest, inverted
 * polarity).
 * @return {number} A number in the range 1023 (loudest) to 0 (silence) to -1023 (loudest, inverted
 * polarity).
 */
function linearToLog(y) {
	return y === 0 ? 0 : Math.sign(y) * (1023 + Math.log2(Math.abs(y)) * 1024 / ATTENUATION_BITS);
}

function calcKeyCode(blockNumber, frequencyNumber) {
	const f11 = frequencyNumber >= 1024;
	const lsb = frequencyNumber >= 1152 || (!f11 && frequencyNumber >= 896);
	return (blockNumber << 2) + (f11 << 1) + lsb;
}

function componentsToFullFreq(blockNumber, frequencyNumber) {
	return Math.trunc(0.5 * (frequencyNumber << blockNumber));
}

function fullFreqToComponents(fullFrequencyNumber) {
	let freqNum = fullFrequencyNumber;
	let block;
	if (freqNum < 1023.75) {
		block = 0;
		freqNum *= 2;
	} else {
		block = 1;
		while (freqNum >= 2047.5) {
			freqNum /= 2;
			block++;
		}
	}
	return [block, Math.round(freqNum)];
}

function frequencyToNote(block, frequencyNum, notes, detune) {
	let lb = 0;
	let ub = 127;
	while (lb < ub) {
		let mid = Math.trunc((lb + ub) / 2);
		const frequency = notes[mid] / detune;
		const [noteBlock, noteFreqNum] = fullFreqToComponents(frequency);
		if (block < noteBlock) {
			ub = mid - 1;
		} else if (block > noteBlock) {
			lb = mid + 1;
		} else if (frequencyNum < noteFreqNum) {
			ub = mid - 1;
		} else if (frequencyNum > noteFreqNum) {
			lb = mid + 1;
		} else {
			return mid;
		}
	}
	return lb;
}

const ENV_INCREMENT_MOD = [0, 0, 4, 4, 4, 4, 6, 6];
for (let i = 8; i < 60; i++) {
	ENV_INCREMENT_MOD[i] = (i % 4) + 4;
}
for (let i = 60; i <= 63; i++) {
	ENV_INCREMENT_MOD[i] = 4;
}

// For decay, sustain and release
const ENV_INCREMENT = new Array(64);
for (let i = 0; i <= 63; i++) {
	const power = Math.trunc(i / 4) - 14;
	ENV_INCREMENT[i] =  ENV_INCREMENT_MOD[i] * (2 ** power);
}

async function makeSSGSample(decayRate, sustainLevel, sustainRate, invert, mirror, sampleRate) {
	let decayPower = Math.trunc(-decayRate / 4) + 14;
	let sustainPower = Math.trunc(-sustainRate / 4) + 14;
	let commonPower;

	if (decayPower >= sustainPower) {
		// Subtract 3 because the deduction of 4, 5, 6 or 7 must be spread out over 8 steps.
		commonPower = sustainPower - 3;
	} else {
		commonPower = decayPower - 3;
	}
	const playbackRate = 2 ** -commonPower;

	let decayMod = ENV_INCREMENT_MOD[decayRate];
	let sustainMod = ENV_INCREMENT_MOD[sustainRate];
	const totalMod = decayMod + sustainMod;
	if (totalMod === 8) {
		/* Instead of 4 steps out of every 8, change to 1 step out of every 2
		 * (repeating 01 pattern).
		 */
		decayMod = 1;
		sustainMod = 1;
		commonPower += 2;
	} else if (totalMod === 12) {
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

class Envelope {

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
		const shaper = new WaveShaperNode(context, {curve: dbCurve});
		this.shaper = shaper;
		gainNode.connect(shaper);
		totalLevelNode.connect(shaper);
		shaper.connect(output.gain);

		this.totalLevel = 0;
		this.rateScaling = 0;
		this.attackRate = 16;
		this.decayRate = 0;
		this.sustainRate = 0;
		this.releaseRate = 17;
		this.sustain = 1023;	// Already converted into an attenuation value.

		// Values stored during key on.
		this.beginLevel = 0;
		this.hasAttack = true;
		this.beginAttack = Infinity;
		this.prevAttackRate = 0;
		this.endAttack = 0;
		this.endDecay = 0;
		this.endSustain = 0;
		this.beginRelease = 0;
		this.releaseLevel = 0;
		this.endRelease = 0;

		this.ssgEnabled = false;
		this.inverted = false;
		this.jump = false;	// Jump to high level at end of envelope (or low if inverted)
		this.looping = false;

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

	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.totalLevelNode.offset[method](-level / 128, time);
		this.totalLevel = level;
	}

	getTotalLevel() {
		return this.totalLevel;
	}

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
			this.ssgEnabled = false;
			this.inverted = false;
			this.jump = false;
			this.looping = false;
		} else {
			mode -= 8;
			this.ssgEnabled = true;
			this.inverted = mode >= 4;
			this.jump = [0, 3, 4, 7].includes(mode);
			this.looping = mode % 2 === 0;
		}
	}

	/**
	 * Don't call with rate = 0, because that means infinite time.
	 */
	decayTime(from, to, basicRate, rateAdjust) {
		const rate = Math.min(Math.round(2 * basicRate + rateAdjust), 63);
		const gradient = ENV_INCREMENT[rate];
		return this.channel.synth.envelopeTick * Math.ceil((from - to) / gradient);
	}

	/**Opens the envelope at a specified time.
	 */
	keyOn(context, operator, time) {
		const rateAdjust = Math.trunc(operator.keyCode / 2 ** (3 - this.rateScaling));
		const tickRate = this.channel.synth.envelopeTick;
		const gain = this.gain;
		const invert = this.inverted;
		const ssgScale = this.ssgEnabled ? 6 : 1;

		let beginLevel = 0;
		const endRelease = this.endRelease;
		if (endRelease > 0) {
			//I.e. it's not the first time the envelope ran.
			if (time < endRelease) {
				// Still in the release phase
				const beginRelease = this.beginRelease;
				const timeProportion = (time - beginRelease) / (endRelease - beginRelease);
				beginLevel = this.releaseLevel * (1 - timeProportion);
			}
			if (invert) {
				beginLevel = 1023 - beginLevel;
			}
		}

		this.beginAttack = time;
		this.beginLevel = beginLevel;
		this.hasAttack = true;
		let endAttack = time;
		if (invert) {
			cancelAndHoldAtTime(gain, 0, time);
		} else {
			let attackRate;
			if (this.attackRate === 0) {
				attackRate = 0;
			} else {
				attackRate = Math.min(Math.round(2 * this.attackRate) + rateAdjust, 63);
			}
			if (attackRate <= 1) {
				// Level never rises
				if (beginLevel === 0) {
					this.endSustain = time;
					channel.scheduleSoundOff(operator, time);
				} else {
					cancelAndHoldAtTime(gain, beginLevel, time);
					this.hasAttack = false;
					this.endAttack = time;
					this.endDecay = Infinity;
					this.endSustain = Infinity;
				}
				return;
			} else if (attackRate < 62 && beginLevel < 1023) {
				// Non-infinite attack
				cancelAndHoldAtTime(gain, beginLevel / 1023, time);
				const target = ATTACK_TARGET[attackRate - 2];
				const timeConstant = ATTACK_CONSTANT[attackRate - 2] * tickRate;
				gain.setTargetAtTime(target / 1023, time, timeConstant);
				this.prevAttackRate = attackRate;
				const attackTime = -timeConstant * Math.log((1023 - target) / (beginLevel - target));
				endAttack += attackTime;
			}
			cancelAndHoldAtTime(gain, 1, endAttack);
		}
		this.endAttack = endAttack;

		if (this.looping && this.decayRate > 0 && (this.sustainRate > 0 || this.sustain === 0)) {
			const decayInc = ENV_INCREMENT[2 * this.decayRate];
			const scaledDecayRate = Math.min(Math.round(2 * this.decayRate + rateAdjust), 63);
			const scaledDecayInc = ENV_INCREMENT[scaledDecayRate];
			const decayMult = scaledDecayInc / decayInc;
			let scaleFactor;

			if (this.sustainRate === 0) {
				scaleFactor = decayMult;
			} else {
				const sustainInc = ENV_INCREMENT[2 * this.sustainRate];
				const scaledSustainRate = Math.min(Math.round(2 * this.sustainRate + rateAdjust), 63);
				const scaledSustainInc = ENV_INCREMENT[scaledSustainRate];
				const sustainMult = scaledSustainInc / sustainInc;
				const proportion = this.sustain / 1023;
				scaleFactor = decayMult * (1 - proportion) + sustainMult * proportion;
			}

			const me = this;
			function playSample(args) {
				const buffer = args[0];
				const baseRate = args[1];
				let playbackRate = baseRate * scaleFactor * buffer.sampleRate * me.synth.envelopeTick;
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
				makeSSGSample(2 * this.decayRate, this.sustain, 2 * this.sustainRate, invert, !this.jump, context.sampleRate)
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
				endTime = time;
				channel.scheduleSoundOff(operator, time);
			} else {
				endTime = Infinity;
			}
			this.endDecay = endTime;
			this.endSustain = endTime;
			return;
		}

		const decay = this.decayTime(1023, this.sustain, this.decayRate, rateAdjust) / ssgScale;
		const endDecay = endAttack + decay;
		const sustain = invert ? 1023 - this.sustain : this.sustain;
		let finalValue = invert ? 1 : 0
		gain.linearRampToValueAtTime(sustain / 1023, endDecay);
		this.endDecay = endDecay;
		let endSustain = endDecay;
		if (this.sustainRate === 0) {

			// Infinite sustain or no sustain
			if (sustain === 0) {
				this.endSustain = endDecay;
			} else {
				this.endSustain = Infinity;
				return;
			}

		} else {

			// Sustain phase
			const sustainTime = this.decayTime(this.sustain, 0, this.sustainRate, rateAdjust) / ssgScale;
			endSustain += sustainTime;
			gain.linearRampToValueAtTime(finalValue, endSustain);

		}

		if (this.jump) {
			finalValue = 1 - finalValue;
			endSustain += tickRate;
			gain.linearRampToValueAtTime(finalValue, endSustain);
		}
		this.endSustain = endSustain;
		if (finalValue === 0) {
			channel.scheduleSoundOff(operator, endSustain);
		}
	}

	linearValueAtTime(time) {
		const endAttack = this.endAttack;
		let linearValue;

		if (!this.hasAttack) {

			// Attack rate was 0.
			return this.beginLevel;

		} else if (time <= this.endAttack) {

			// In the attack phase.
			const attackRate = this.prevAttackRate;
			const target = ATTACK_TARGET[attackRate - 2];
			const timeConstant = ATTACK_CONSTANT[attackRate - 2] * this.channel.synth.envelopeTick;
			const beginAttack = this.beginAttack;
			const beginLevel = this.beginLevel;
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
			linearValue = this.jump ? 1023 : 0;

		} else if (time >= endDecay) {

			// In the sustain phase.
			if (endSustain === Infinity) {
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

		if (this.inverted) {
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
		const rateAdjust = Math.trunc(operator.keyCode / 2 ** (3 - this.rateScaling));
		const ssgScale = this.ssgEnabled ? 6 : 1;
		const releaseTime = this.decayTime(currentValue, 0, this.releaseRate, rateAdjust) / ssgScale;
		const gain = this.gain;
		cancelAndHoldAtTime(gain, currentValue / 1023, time);
		const endRelease = time + releaseTime;
		gain.linearRampToValueAtTime(0, endRelease);
		channel.scheduleSoundOff(operator, endRelease);
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

}


/**The amount to detune each note by when the various detuning settings are applied. The
 * array is organized into four sequential blocks of 32 values each. The first block
 * represents the changes in frequency from the basic scale when an operator's detuning
 * parameter is set to 0 (should be 32 zeros!). The second block represents the increases
 * in frequency when the detuning parameter is set to 1 and the decreases in frequency
 * when the detuning parameter is set to 5, and so on. Each block of 32 values contains a
 * single entry for each of the YM2612's "key codes". To find a note's key code you
 * multiply its block number by 4 and place the two most significant bits of its frequency
 * number into the two least significant bits of the key code.
 * @type {Array<number}
 */
const DETUNE_AMOUNTS = [
/* Preset 0 */
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
/* Preset +-1 */
	0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
	2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8,
/* Preset +-2 */
	1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5,
	5, 6, 6, 7, 8, 8, 9,10,11,12,13,14,16,16,16,16,
/* Preset +-3 */
	2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7,
	8, 8, 9,10,11,12,13,14,16,17,19,20,22,22,22,22
];

const DETUNE2_PRESETS = [0, 600, 781, 950].map( x => 2 ** (x / 1200) );

/**Represents a single operator in the FM synthesizer. The synthesizer alters frequency
 * using phase modulation (PM). There are 4 operators per sound channel and 6 independent
 * channels by default.
 */
class Operator {

	/**Constructs an instance of an operator. Operators are normally created by
	 * invoking the {@link FMSynth} constructor.
	 * @param {AudioContext} context The Web Audio context.
	 * @param {AudioNode} lfo The signal used to control the operator's vibrato and tremolo effects.
	 * @param {AudioNode} output The destination to route the operator's audio output to.
	 *
	 */
	constructor(channel, context, lfo, output, dbCurve) {
		this.channel = channel;
		this.freqBlockNumber = 4;
		this.frequencyNumber = 1093;
		this.frequency =
			channel.synth.frequencyStep *
			componentsToFullFreq(this.freqBlockNumber, this.frequencyNumber);
		const frequencyNode = new ConstantSourceNode(context, {offset: this.frequency});

		this.frequencyNode = frequencyNode;
		this.frequencyParam = frequencyNode.offset;

		const tremolo = new GainNode(context);
		this.tremoloNode = tremolo;
		this.tremolo = tremolo.gain;
		const tremoloGain = new GainNode(context, {gain: 0});
		tremoloGain.connect(tremolo.gain);
		this.tremoloAmp = tremoloGain.gain;
		lfo.connect(tremoloGain);

		const envelopeGain = new GainNode(context);
		tremolo.connect(envelopeGain);
		this.envelope = new Envelope(channel, context, envelopeGain, dbCurve);
		this.envelopeGain = envelopeGain;

		const mixer = new GainNode(context);
		envelopeGain.connect(mixer);
		mixer.connect(output);
		this.mixer = mixer.gain;

		this.keyCode = calcKeyCode(4, 1093);
		this.frequencyMultiple = 1;
		this.detune = 0;		// Fine detune, YM2612 specific
		this.detune2 = 1;		// Arbitrary detuning
		this.keyIsOn = false;
		this.disabled = false;

		this.tremoloDepth = 0;
		this.volume = 1;
	}

	/**Starts the operator's oscillator.
	 * Operators are normally started by calling start() on an instance of {@link FMSynth}.
	 */
	start(time) {
		this.frequencyNode.start(time);
		this.envelope.start(time);
	}

	/**Stops the operator's oscillator so that the operator's system resources can be released.
	 * Operators are normally stopped by calling stop() on an instance of {@link FMSynth}.
	 */
	stop(time = 0) {
		this.stopOscillator(time);
		this.frequencyNode.stop(time);
		this.envelope.stop(time);
		this.frequencyNode = undefined;
		this.oscillator1 = undefined;
		this.oscillator2 = undefined;
	}

	/**Configures this operator to modulate an external source (usually another operator).
	 * This method is usually called by the {@link Channel} constructor.
	 * @param {AudioNode} destination The signal to modulate.
	 */
	connectOut(destination) {
		this.envelopeGain.connect(destination);
	}

	/**Changes the operator's frequency. This method is usually invoked by an instance of
	 * {@link Channel} (e.g. by its setFrequency() method) but it can also be useful to
	 * invoke this method directly for individual operators to create dissonant sounds.
	 * @param {number} blockNumber A kind of octave measurement.
	 * @param {number} frequencyNumber A linear frequency measurement.
	 * @param {number} [frequencyMultiple] After the basic frequency in Hertz is calculated
	 * from the block number and frequency number the result is then multiplied by this
	 * number. Defaults to 1.
	 * @param {number} [time] When to change frequency. Defaults to immediately.
	 * @param {string} [method] How to change from one frequency to another. One of
	 * 'setValueAtTime', 'linearRampToValueAtTime' or 'exponentialRampToValueAtTime'.
	 * Defaults to 'setValueAtTime'.
	 */
	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		const keyCode = calcKeyCode(blockNumber, frequencyNumber);
		const detuneSetting = this.detune;
		const detuneTableOffset = (detuneSetting & 3) << 5;
		const detuneSign = (-1) ** (detuneSetting >> 2);
		const detuneSteps = detuneSign * DETUNE_AMOUNTS[detuneTableOffset + Math.min(keyCode, 31)];

		let fullFreqNumber = componentsToFullFreq(blockNumber, frequencyNumber) + detuneSteps;
		if (fullFreqNumber < 0) {
			fullFreqNumber += 0x1FFFF;
		}
		const frequencyStep = this.channel.synth.frequencyStep;
		const frequency = fullFreqNumber * frequencyMultiple * frequencyStep * this.detune2;
		this.frequencyParam[method](frequency, time);
		this.frequency = frequency;
		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
		this.frequencyMultiple = frequencyMultiple;
		this.keyCode = keyCode;
	}


	/**Returns the block number associated with the operator's current frequency. */
	getFrequencyBlock() {
		return this.freqBlockNumber;
	}

	/**Returns the frequency number associated with the operator's current frequency. */
	getFrequencyNumber() {
		return this.frequencyNumber;
	}

	/** Configures the amount of detuning.
	 * @param {number} extent The amount of detuning. Zero means no detuning, 1 raises the
	 * pitch a little, 2 raises the pitch moderately, 3 raises the pitch a lot. 5 lowers
	 * the pitch a little, 6 lowers it moderately, 7 lowers it a lot.
	 * @param {number} [time] When to alter the detuning. Defaults to whenever
	 * setFrequency() is next called.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setDetune(extent, time = undefined, method = 'setValueAtTime') {
		this.detune = extent;
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time, method);
		}
	}

	/**Returns the most recently set detuning value. */
	getDetune() {
		return this.detune;
	}

	setDetune2(cents, time = undefined, method = 'setValueAtTime') {
		this.detune2 = 2 ** (cents / 1200);
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time, method);
		}
	}

	getDetune2() {
		return Math.round(Math.log2(this.detune2) * 1200);
	}

	useDetune2Preset(presetNum, time = undefined, method = 'setValueAtTime') {
		this.detune2 = DETUNE2_PRESETS[presetNum];
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time, method);
		}
	}

	getDetune2Preset() {
		return DETUNE2_PRESETS.indexOf(this.detune2);
	}

	/** Specifies the degree to which this operator's output undergoes amplitude
	 * modulation from the synthesizer's LFO. This method is usually invoked by an instance
	 * of {@link Channel}. Use its enableTremolo(), useTremoloPreset() and setTremoloDepth()
	 * methods to configure amplitude modulation for the operators. However, if you wish then
	 * you can manually initiate amplitude modulation by invoking this method directly. This
	 * allows different operators to have differing levels of amplitude modulation.
	 * @param {number} linearAmount The amount of amplitude modulation to apply between 0
	 * and 1.
	 * @param {number} [time] When to change the amplitude modulation depth. Defaults to immediately.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setTremoloDepth(linearAmount, time = 0, method = 'setValueAtTime') {
		this.tremoloAmp[method](linearAmount, time);
		this.tremolo[method](1 - Math.abs(linearAmount), time);
		this.tremoloDepth = linearAmount;
	}

	/**Gets the amount of amplitude modulation being applied to the operator on a 0..1 linear scale. */
	getTremoloDepth() {
		return this.tremoloDepth;
	}

	setVolume(level, time = 0, method = 'setValueAtTime') {
		this.mixer[method](level, time);
		this.volume = level;
	}

	getVolume() {
		return this.volume;
	}

	disable(time = 0) {
		this.stopOscillator(time);
		this.disabled = true;
		this.keyIsOn = false;
	}

	enable() {
		this.disabled = false;
	}

	isDisabled() {
		return this.disabled;
	}

	keyOn(context, time) {
		this.envelope.keyOn(context, this, time);
		this.keyIsOn = true;
	}

	keyOff(time) {
		if (this.keyIsOn) {
			this.envelope.keyOff(this, time);
			this.keyIsOn = false;
		}
	}

	soundOff(time = 0) {
		this.stopOscillator(time);
		this.envelope.soundOff(time);
		this.keyIsOn = false;
	}

	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.envelope.setTotalLevel(level, time, method);
	}

	getTotalLevel() {
		return this.envelope.getTotalLevel();
	}

	setRateScaling(amount) {
		this.envelope.setRateScaling(amount);
	}

	getRateScaling() {
		return this.envelope.getRateScaling();
	}

	setAttack(rate) {
		this.envelope.setAttack(rate);
	}

	getAttack() {
		return this.envelope.getAttack();
	}

	setDecay(rate) {
		this.envelope.setDecay(rate);
	}

	getDecay() {
		return this.envelope.getDecay();
	}

	setSustain(level) {
		this.envelope.setSustain(level);
	}

	getSustain() {
		return this.envelope.getSustain();
	}

	setSustainRate(rate) {
		this.envelope.setSustainRate(rate);
	}

	getSustainRate() {
		return this.envelope.getSustainRate();
	}

	setRelease(rate) {
		this.envelope.setRelease(rate);
	}

	getRelease() {
		return this.envelope.getRelease();
	}

	setSSG(mode) {
		this.envelope.setSSG(mode);
	}

}

class OscillatorConfig {
	/**
	 * @param {string} oscillator1Shape The waveform used for the carrier oscillator:
	 * 'sine', 'sawtooth', square' or 'triangle'.
	 * @param {boolean} waveShaping Inverts the negative portion of the carrier oscillator's
	 * waveform when true.
	 * @param {number} bias The amount of DC offset to add.
	 * @param {string} oscillator2Shape The waveform used for the modulator oscillator:
	 * 'sine', 'sawtooth', square', 'triangle' or undefined (no modulation).
	 * @param {number} oscillator2FrequencyMult The frequency of the modulator relative to the base
	 * frequency.
	 * @param {number} oscillator1FrequencyMult The frequency of the carrier relative to the base
	 * frequency, which is usually 1x but a few waveforms use 2x. If this parameter has a value
	 * other than 1 then the value of oscillator2FrequencyMult must be 1 (or 0).
	 * @param {number} modDepth How much amplitude modulation to apply [0..1].
	 * @param {boolean} ringMod Performs ring modulation if true, or amplitude modulation if false.
	 * @param {number} gain Scales the resulting wave by a constant.
	 * @param {boolean} additive Adds the modulator signal to the carrier before performing modulating.
	 */
	constructor(
		oscillator1Shape, waveShaping = false, bias = 0,
		oscillator2Shape = undefined, oscillator2FrequencyMult = 0, oscillator1FrequencyMult = 1,
		modDepth = 1, ringMod = false, gain = 1, additive = false
	) {
		this.oscillator1Shape = oscillator1Shape;
		this.waveShaping = waveShaping;
		this.bias = bias;
		this.oscillator2Shape = oscillator2Shape;
		this.oscillator2FrequencyMult = oscillator2FrequencyMult;
		this.modDepth = (ringMod ? 1 : 0.5) * modDepth;
		this.oscillator1FrequencyMult = oscillator1FrequencyMult;
		this.frequencyMultiplier = oscillator1FrequencyMult !== 1 ? oscillator1FrequencyMult : oscillator2FrequencyMult;
		this.gain = gain;
		this.additive = additive;
	}

	static mono(shape, waveShaping = false) {
		let bias;
		if (!waveShaping) {
			bias = 0;
		} else if (shape === 'sine') {
			bias = -2 / Math.PI;
		} else {
			bias = -0.5;	// Triangle or sawtooth
		}
		return new OscillatorConfig(shape, waveShaping, bias);
	}

	static am(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, modDepth = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, modDepth, false, gain);
	}

	static ringMod(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, modDepth = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, modDepth, true, gain);
	}

	static additive(
		oscillator1Shape, waveShaping, bias, oscillator2Shape,
		oscillator2FrequencyMult, oscillator1FrequencyMult = 1, gain = 1
	) {
		return new OscillatorConfig(oscillator1Shape, waveShaping, bias, oscillator2Shape, oscillator2FrequencyMult, oscillator1FrequencyMult, 0, false, 0.5 * gain, true);
	}

}

class FMOperator extends Operator {

	constructor(channel, context, lfo, output, dbCurve) {
		super(channel, context, lfo, output, dbCurve);

		const frequencyMultipler = new GainNode(context);
		this.frequencyNode.connect(frequencyMultipler);
		this.frequencyMultipler = frequencyMultipler;
		const shaper = new WaveShaperNode(context, {curve: [1, 0, 1]});
		this.shaper = shaper;

		const amMod = new GainNode(context);
		shaper.connect(amMod);
		amMod.connect(this.tremoloNode);
		this.amMod = amMod;
		const amModAmp = new GainNode(context);
		amModAmp.connect(amMod.gain);
		this.amModAmp = amModAmp;
		const bias = new GainNode(context, {gain: 0});
		channel.synth.dcOffset.connect(bias);
		bias.connect(this.tremoloNode);
		this.bias = bias.gain;

		this.oscillator1 = undefined;
		this.oscillator2 = undefined;
		this.oscillatorConfig = channel.synth.oscillatorConfigs[0];

		const fmModAmp = new GainNode(context, {gain: 440});
		fmModAmp.connect(this.frequencyParam);
		this.fmModAmp = fmModAmp;

		const vibratoGain = new GainNode(context, {gain: 0});
		lfo.connect(vibratoGain);
		vibratoGain.connect(fmModAmp);
		this.vibratoAmp = vibratoGain.gain;
		this.vibratoDepth = 0;
	}

	newOscillator(context, time = 0) {
		const config = this.oscillatorConfig;

		const oscillator1 = new OscillatorNode(
			context,
			{frequency: 0, type: config.oscillator1Shape}
		);

		if (config.oscillator1FrequencyMult === 1) {
			this.frequencyNode.connect(oscillator1.frequency);
		} else {
			this.frequencyMultipler.connect(oscillator1.frequency);
		}
		this.frequencyMultipler.gain.setValueAtTime(config.frequencyMultiplier, time);

		const gain = config.gain;	// Overall gain
		let oscillator2;
		if (config.oscillator2FrequencyMult !== 0) {
			oscillator2 = new OscillatorNode(context, {frequency: 0, type: config.oscillator2Shape});
			if (config.oscillator1FrequencyMult !== 1) {
				// Oscillator 1 has customized pitch, Oscillator 2 is the fundamental.
				this.frequencyNode.connect(oscillator2.frequency);
			} else {
				// Oscillator 2 can have pitch customized.
				this.frequencyMultipler.connect(oscillator2.frequency);
			}
			oscillator2.connect(this.amModAmp);
			if (config.additive) {
				oscillator2.connect(this.amMod);
			}

			// Amplitude of the modulator, before gain
			const amplitude = config.modDepth;
			this.amModAmp.gain.setValueAtTime(gain * amplitude, time);
			this.amMod.gain.setValueAtTime(gain * (1 - Math.abs(amplitude)), time);
			oscillator2.start(time);
		} else {
			this.amMod.gain.setValueAtTime(1, time);
		}
		oscillator1.start(time);
		this.stopOscillator(time);	// Stop old oscillator

		oscillator1.connect(config.waveShaping ? this.shaper : this.amMod);
		this.bias.setValueAtTime(gain * config.bias, time);
		this.oscillator1 = oscillator1;
		this.oscillator2 = oscillator2;
	}

	stopOscillator(time) {
		if (!this.oscillator1) {
			return;
		}

		this.oscillator1.stop(time);

		if (this.oscillator2) {
			this.oscillator2.stop(time);
		}
	}

	connectIn(source) {
		source.connect(this.fmModAmp);
	}

	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		super.setFrequency(blockNumber, frequencyNumber, frequencyMultiple, time, method);
		this.fmModAmp.gain[method](this.frequency, time);
	}

	setVibratoDepth(linearAmount, time = 0, method = 'setValueAtTime') {
		this.vibratoAmp[method](linearAmount, time);
		this.vibratoDepth = linearAmount;
	}

	getVibratoDepth() {
		return this.vibratoDepth;
	}

	keyOn(context, time) {
		if (!this.keyIsOn && !this.disabled) {
			if (this.oscillator1 && this.channel.oldStopTime > time) {
				this.stopOscillator(context.currentTime + NEVER);
			} else {
				this.newOscillator(context, time);
			}
			super.keyOn(context, time);
		}
	}

	setWaveform(context, oscillatorConfig, time = 0) {
		if (oscillatorConfig == undefined) throw new Error('Parameters: setWaveform(context, oscillatorConfig, time = 0)');
		this.oscillatorConfig = oscillatorConfig;
		this.newOscillator(context, time);
	}

	setWaveformNumber(context, waveformNumber, time = 0) {
		this.setWaveform(context, this.channel.synth.oscillatorConfigs[waveformNumber], time);
	}

	getWaveformNumber() {
		return this.channel.synth.oscillatorConfigs.indexOf(this.oscillatorConfig);
	}

}

const FOUR_OP_ALGORITHMS = [
	/*	[
			[op1To2Gain, op1To3Gain, op1To4Gain, op2To3Gain, op2To4Gain, op3To4Gain],
			[op1OutputGain, op2OutputGain, op3OutputGain, op4OutputGain]
		]
	 */

	// 1 -> 2 -> 3 -> 4
	[[1, 0, 0, 1, 0, 1], [0, 0, 0, 1]],

	// 1 \
	//    |--> 3 -> 4
	// 2 /
	[[0, 1, 0, 1, 0, 1], [0, 0, 0, 1]],

	// 1 -----\
	//         |--> 4
	// 2 -> 3 /
	[[0, 0, 1, 1, 0, 1], [0, 0, 0, 1]],


	// 1 -> 2 \
	//        |--> 4
	// 3 -----/
	[[1, 0, 0, 0, 1, 1], [0, 0, 0, 1]],

	// 1 -> 2
	// 3 -> 4
	[[1, 0, 0, 0, 0, 1], [0, 1, 0, 1]],

	//   /--> 2
	// 1 |--> 3
	//   \--> 4
	[[1, 1, 1, 0, 0, 0], [0, 1, 1, 1]],

	// 1 -> 2
	//      3
	//      4
	[[1, 0, 0, 0, 0, 0], [0, 1, 1, 1]],

	// No modulation
	[[0, 0, 0, 0, 0, 0], [1, 1, 1, 1]],

	//           1
	// 2 -> 3 -> 4
	[[0, 0, 0, 1, 0, 1], [1, 0, 0, 1]],
];

const TWO_OP_ALGORITHMS = [
	[1, [0, 1]], // FM
	[0, [1, 1]], // Additive
];

// 0db, 1.4db, 5.9db, 11.8db
const TREMOLO_PRESETS = [0, -15, -63, -126].map(x => x / 1023);

const ENVELOPE_TYPE = Object.freeze({
	'DELAY_ATTACK': 0,
	'HOLD_DECAY': 1,
});

function indexOfGain(modulatorOpNum, carrierOpNum) {
	if (modulatorOpNum === carrierOpNum) {
		switch (modulatorOpNum) {
		case 1: return 0;
		case 3: return 1;
		default: return - 1;
		}
	} else if (modulatorOpNum >= 4 || modulatorOpNum >= carrierOpNum) {
		return -1;
	}
	let index = 2;
	for (let i = modulatorOpNum - 1; i > 0; i--) {
		index += 4 - i;
	}
	index += carrierOpNum - modulatorOpNum - 1;
	return index;
}

class Channel {

	constructor(synth, context, output, dbCurve) {
		this.synth = synth;
		const shaper = new WaveShaperNode(context, {curve: [-1, 0, 1]});
		const volume = new GainNode(context);
		shaper.connect(volume);
		this.volumeControl = volume.gain;

		const panner = new StereoPannerNode(context);
		volume.connect(panner);
		this.panner = panner;
		const mute = new GainNode(context);
		panner.connect(mute);
		mute.connect(output);
		this.muteControl = mute.gain;

		this.lfoRate = 0;
		this.lfoShape = 'triangle';
		this.lfoKeySync = false;
		this.lfo = undefined;
		const lfoEnvelope = new GainNode(context);
		this.lfoEnvelope = lfoEnvelope;
		this.lfoDelay = 0;
		this.lfoFadeTime = 0;
		this.lfoEnvelopeType = ENVELOPE_TYPE.DELAY_ATTACK;

		const op1 = new FMOperator(this, context, lfoEnvelope, shaper, dbCurve);
		const op2 = new FMOperator(this, context, lfoEnvelope, shaper, dbCurve);
		const op3 = new FMOperator(this, context, lfoEnvelope, shaper, dbCurve);
		const op4 = new FMOperator(this, context, lfoEnvelope, shaper, dbCurve);
		this.operators = [op1, op2, op3, op4];

		const minDelay = 128 / context.sampleRate;
		const dcBlock = 48.5;
		const op1To1 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To1);
		const feedbackFilter1 = new BiquadFilterNode(context, {type: 'highpass', frequency: dcBlock, Q: 0});
		op1To1.connect(feedbackFilter1);
		const delay1To1 = new DelayNode(context, {delayTime: minDelay, maxDelayTime: minDelay});
		feedbackFilter1.connect(delay1To1);
		op1.connectIn(delay1To1);
		const op1To2 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To2);
		op2.connectIn(op1To2);
		const op1To3 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To3);
		op3.connectIn(op1To3);
		const op1To4 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To4);
		op4.connectIn(op1To4);

		const op2To3 = new GainNode(context, {gain: 0});
		op2.connectOut(op2To3);
		op3.connectIn(op2To3);
		const op2To4 = new GainNode(context, {gain: 0});
		op2.connectOut(op2To4);
		op4.connectIn(op2To4);

		const op3To3 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To3);
		const feedbackFilter3 = new BiquadFilterNode(context, {type: 'highpass', frequency: dcBlock, Q: 0});
		op3To3.connect(feedbackFilter3);
		const delay3To3 = new DelayNode(context, {delayTime: minDelay, maxDelayTime: minDelay});
		feedbackFilter3.connect(delay3To3);
		op3.connectIn(delay3To3);
		const op3To4 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To4);
		op4.connectIn(op3To4);

		this.dcBlock = [feedbackFilter1.frequency, feedbackFilter3.frequency];

		this.gains = [
			op1To1.gain, op3To3.gain,
			op1To2.gain, op1To3.gain, op1To4.gain,
			op2To3.gain, op2To4.gain,
			op3To4.gain
		];
		this.modulationDepths = new Array(this.gains.length);

		this.freqBlockNumbers = [4, 4, 4, 4];
		this.frequencyNumbers = [1093, 1093, 1093, 1093];
		this.frequencyMultiples = [1, 1, 1, 1];
		this.fixedFrequency = [false, false, false, false];
		this.detune = 1;	// 1:1 with non-detuned frequency

		this.tremoloDepth = 0;	// linear scale
		this.tremoloEnabled = [false, false, false, false];
		this.vibratoDepth = 0;
		this.vibratoEnabled = [true, true, true, true];
		this.keyVelocity = [1, 1, 1, 1];
		this.operatorDelay = [0, 0, 0, 0];
		this.stopTime = 0;
		this.oldStopTime = 0;	// Value before the key-on/off currently being processed.
		this.useAlgorithm(7);
	}

	start(time) {
		for (let operator of this.operators) {
			operator.start(time);
		}
	}

	stop(time = 0) {
		for (let operator of this.operators) {
			operator.stop(time);
		}
		if (this.lfo) {
			this.lfo.stop(time);
			this.lfo = undefined;
		}
	}

	getOperator(operatorNum) {
		return this.operators[operatorNum - 1];
	}

	/**Switches out of two operator mode and back into four operator mode. You'll still
	 * need to reinitialize the channel with a new instrument patch and frequency setting
	 * before the normal four operator behaviour is completely restored.
	 * Things not covered here: algorithm, frequency, tremolo, vibrato, DAC/PCM remains disabled
	 */
	activate(context, time = 0) {
		this.setVolume(1, time, method);
	}

	setAlgorithm(modulations, outputLevels, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 6; i++) {
			const depth = modulations[i];
			this.gains[i + 2][method](depth, time);
			this.modulationDepths[i + 2] = depth;
		}
		for (let i = 0; i < 4; i++) {
			const operator = this.operators[i];
			const outputLevel = outputLevels[i];
			operator.enable();
			operator.setVolume(outputLevel, time, method);
			this.keyVelocity[i] = outputLevel === 0 ? 0 : 1;
		}
	}

	useAlgorithm(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = FOUR_OP_ALGORITHMS[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
	}

	getAlgorithm() {
		algorithm: for (let i = 0; i < FOUR_OP_ALGORITHMS.length; i++) {
			const algorithm = FOUR_OP_ALGORITHMS[i];
			const modulations = algorithm[0];
			for (let j = 0; j < modulations.length; j++) {
				const algorithmModulates = modulations[j] !== 0;
				const thisModulates = this.modulationDepths[j + 2] !== 0;
				if (algorithmModulates !== thisModulates) {
					continue algorithm;
				}
			}
			const outputLevels = algorithm[1];
			for (let j = 0; j < 4; j++) {
				const algorithmOutputs = outputLevels[j] !== 0;
				const thisOutputs = this.operators[j].getVolume() !== 0;
				if (algorithmOutputs !== thisOutputs) {
					continue algorithm;
				}
			}
			return i;
		} // end for each algorithm
		return -1;
	}

	setModulationDepth(modulatorOpNum, carrierOpNum, amount, time = 0, method = 'setValueAtTime') {
		const index = indexOfGain(modulatorOpNum, carrierOpNum);
		this.gains[index][method](amount, time);
		this.modulationDepths[index] = amount;
	}

	getModulationDepth(modulatorOpNum, carrierOpNum) {
		const index = indexOfGain(modulatorOpNum, carrierOpNum);
		return index === -1 ? 0 : this.modulationDepths[index];
	}

	disableOperator(operatorNum, time = 0) {
		this.operators[operatorNum - 1].disable(time);
	}

	enableOperator(operatorNum) {
		this.operators[operatorNum - 1].enable();
	}

	fixFrequency(operatorNum, fixed, time = undefined, preserve = true, method = 'setValueAtTime') {
		const fixedFrequencyArr = this.fixedFrequency;
		const operator = this.operators[operatorNum - 1];
		const multiple = this.frequencyMultiples[operatorNum - 1];
		let block = this.freqBlockNumbers[3];
		let freqNum = this.frequencyNumbers[3];

		if (fixed) {
			if (preserve) {
				if (!fixedFrequencyArr[operatorNum - 1] &&
					(operatorNum !== 4 ||
						(fixedFrequencyArr[0] && fixedFrequencyArr[1] && fixedFrequencyArr[2])
					)
				) {
					// Turn a frequency multiple into a fixed frequency.
					const fullFreqNumber = componentsToFullFreq(block, freqNum) * multiple;
					[block, freqNum] = fullFreqToComponents(fullFreqNumber);
					this.freqBlockNumbers[operatorNum - 1] = block;
					this.frequencyNumbers[operatorNum - 1] = freqNum;
				}
			} else if (time !== undefined) {
				// Restore a fixed frequency from a register.
				block = this.freqBlockNumbers[operatorNum - 1];
				freqNum = this.frequencyNumbers[operatorNum - 1];
				operator.setFrequency(block, freqNum, 1, time, method);
			}
		} else if (time !== undefined) {
			// Restore a multiple of Operator 4's frequency.
			operator.setFrequency(block, freqNum, multiple, time, method);
		}
		fixedFrequencyArr[operatorNum - 1] = fixed;
	}

	isOperatorFixed(operatorNum) {
		return this.fixedFrequency[operatorNum - 1];
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 4; i++) {
			if (!this.fixedFrequency[i]) {
				const multiple = this.frequencyMultiples[i];
				this.operators[i].setFrequency(blockNumber, frequencyNumber, multiple, time, method);
			}
		}
		this.freqBlockNumbers[3] = blockNumber;
		this.frequencyNumbers[3] = frequencyNumber;
	}

	setOperatorFrequency(operatorNum, blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		if (this.fixedFrequency[operatorNum - 1]) {
			this.operators[operatorNum - 1].setFrequency(blockNumber, frequencyNumber, 1, time, method);
		}
		this.freqBlockNumbers[operatorNum - 1] = blockNumber;
		this.frequencyNumbers[operatorNum - 1] = frequencyNumber;
	}

	getFrequencyBlock(operatorNum = 4) {
		return this.freqBlockNumbers[operatorNum - 1];
	}

	getFrequencyNumber(operatorNum = 4) {
		return this.frequencyNumbers[operatorNum - 1];
	}

	setFrequencyMultiple(operatorNum, multiple, time = undefined, method = 'setValueAtTime') {
		this.frequencyMultiples[operatorNum - 1] = multiple;
		if (time !== undefined && !this.fixedFrequency[operatorNum - 1]) {
			const block = this.freqBlockNumbers[3];
			const freqNum = this.frequencyNumbers[3];
			const operator = this.operators[operatorNum - 1];
			operator.setFrequency(block, freqNum, multiple, time, method);
		}
	}

	getFrequencyMultiple(operatorNum) {
		return this.frequencyMultiples[operatorNum - 1];
	}

	setDetune(cents) {
		this.detune = 2 ** (cents / 1200);
	}

	getDetune() {
		return Math.round(Math.log2(this.detune) * 12000) / 10;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const frequency = this.synth.noteFrequencies[noteNumber] * this.detune;
		const [block, freqNum] = fullFreqToComponents(frequency);
		this.setFrequency(block, freqNum, time, method);
	}

	/**
	 * @param {PitchBend} bend The pitch bend to apply, relative to the last note set using
	 * setMIDINote() or setFrequency().
	 * @param {boolean} release True to apply the note off portion of the bend, or false to
	 * apply the note on portion.
	 * @param {number} time The time to begin pitch bending from.
	 * @param {Array<number>} timesPerStep Either the duration of a tracker line (fine changes, i.e.
	 * slower) or the duration of a tick, in seconds, or an absolute value if you don't want the
	 * effect tempo synced. Use multiple values to account for a groove or a tempo change and
	 * the system will rotate through them.
	 * @param {number} [maxSteps] The maximum number of bend steps to perform. Useful if you
	 * want to cut the bend short to trigger a new note.
	 * @param {number} [scaling=1] Scales the bend's values before applying them. Useful for
	 * making the effect velocity sensitive. Negative values are also supported, in case you
	 * need to force the bend to head in particular direction without knowing which direction
	 * that's going to be when you create the bend.
	 */
	pitchBend(bend, release, startTime, timesPerStep, maxSteps = bend.getLength(release), scaling = 1) {
		for (let i = 0; i < 4; i++) {
			if (!this.fixedFrequency[i]) {
				const operator = this.operators[i];
				bend.execute(
					operator.frequencyParam, release, startTime, timesPerStep, maxSteps,
					operator.frequency, scaling
				);
			}
		}
	}

	volumeAutomation(automation, startTime, timesPerStep, maxSteps = bend.getLength(false)) {
		automation.execute(this.volumeControl, false, startTime, timesPerStep, maxSteps);
	}

	setOperatorNote(operatorNum, noteNumber, time = 0, method = 'setValueAtTime') {
		this.fixedFrequency[operatorNum - 1] = true;
		const frequency = this.synth.noteFrequencies[noteNumber] * this.detune;
		const [block, freqNum] = fullFreqToComponents(frequency);
		this.setOperatorFrequency(operatorNum, block, freqNum, time, method);
	}

	getMIDINote(operatorNum = 4) {
		const block = this.freqBlockNumbers[operatorNum - 1];
		const freqNum = this.frequencyNumbers[operatorNum - 1];
		return frequencyToNote(block, freqNum, this.synth.noteFrequencies, this.detune);
	}

	setFeedback(amount, operatorNum = 1, time = 0, method = 'setValueAtTime') {
		const index = (operatorNum - 1) / 2;
		this.gains[index][method](amount, time);
		this.modulationDepths[index] = amount;
	}

	getFeedback(operatorNum = 1) {
		return this.modulationDepths[(operatorNum - 1) / 2];
	}

	useFeedbackPreset(n, operatorNum = 1, time = 0, method = 'setValueAtTime') {
		const amount = n === 0 ? 0 : 2 ** (n - 6);
		this.setFeedback(amount, operatorNum, time, method);
	}

	getFeedbackPreset(operatorNum = 1) {
		const amount = this.getFeedback(operatorNum);
		return amount === 0 ? 0 : Math.round(Math.log2(amount) + 6);
	}

	setFeedbackFilter(cutoff, operatorNum = 1, time = 0, method = 'setValueAtTime') {
		this.dcBlock[(operatorNum - 1) / 2][method](cutoff, time);
	}

	getFeedbackFilterFreq(operatorNum = 1) {
		return this.dcBlock[(operatorNum - 1) / 2].value;
	}

	/**
	 * @param {number} depth The amount of tremolo effect to apply, range -512 to 512.
	 */
	setTremoloDepth(depth, time = 0, method = 'setValueAtTime') {
		const linearAmount = (1020 * depth / 512) / 1023;
		for (let i = 0; i < 4; i++) {
			if (this.tremoloEnabled[i]) {
				this.operators[i].setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloDepth() {
		return Math.round(this.tremoloDepth * 1023 / 1020 * 512);
	}

	useTremoloPreset(presetNum, time = 0, method = 'setValueAtTime') {
		const linearAmount = TREMOLO_PRESETS[presetNum];
		for (let i = 0; i < 4; i++) {
			if (this.tremoloEnabled[i]) {
				this.operators[i].setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloPreset() {
		const depth = Math.round(this.tremoloDepth * 1023);
		return TREMOLO_PRESETS.indexOf(depth);
	}

	enableTremolo(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const operator = this.operators[operatorNum - 1];
		operator.setTremoloDepth(enabled ? this.tremoloDepth : 0, time, method);
		this.tremoloEnabled[operatorNum - 1] = enabled;
	}

	isTremoloEnabled(operatorNum) {
		return this.tremoloEnabled[operatorNum - 1];
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const linearAmount = Math.sign(cents) * (2 ** (Math.abs(cents) / 1200)) - 1;
		for (let i = 0; i < 4; i++) {
			if (this.vibratoEnabled[i]) {
				this.operators[i].setVibratoDepth(linearAmount, time, method);
			}
		}
		this.vibratoDepth = linearAmount;
	}

	getVibratoDepth() {
		return Math.round(Math.log2(this.vibratoDepth + 1) * 12000) / 10;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		const depth = Math.round(this.getVibratoDepth() * 10) / 10;
		return VIBRATO_PRESETS.indexOf(depth);
	}

	enableVibrato(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const operator = this.operators[operatorNum - 1];
		operator.setVibratoDepth(enabled ? this.vibratoDepth : 0, time, method);
		this.vibratoEnabled[operatorNum - 1] = enabled;
	}

	isVibratoEnabled(operatorNum) {
		return this.vibratoEnabled[operatorNum - 1];
	}

	setLFODelayOrHold(seconds) {
		this.lfoDelay = seconds;
	}

	getLFODelayOrHold() {
		return this.lfoDelay;
	}

	setLFOFadeTime(seconds) {
		this.lfoFadeTime = seconds;
	}

	getLFOFadeTime() {
		return this.lfoFadeTime;
	}

	setLFOEnvelopeType(type) {
		this.lfoEnvelopeType = type;
	}

	getLFOEnvelopeType() {
		return this.lfoEnvelopeType;
	}

	setLFORate(context, frequency, time = 0, method = 'setValueAtTime') {
		if (this.lfo) {
			this.lfo.frequency[method](frequency, time);
			if (frequency === 0) {
				this.lfo.stop(time);
				this.lfo = undefined;
			}
		} else if (frequency !== 0 && !this.lfoKeySync) {
			// Start LFO running in the background.
			const lfo = new OscillatorNode(context, {frequency: frequency, type: this.lfoShape});
			lfo.start(time);
			lfo.connect(this.lfoEnvelope);
			this.lfo = lfo;
		}
		this.lfoRate = frequency;
	}

	setLFOShape(context, shape, time = undefined) {
		if (shape === this.lfoShape) {
			return;
		}
		if (this.lfo && (time !== undefined || !this.lfoKeySync)) {
			// Change LFO shape immediately.
			// Frequency will never be 0 when this.lfo is defined.
			const lfo = new OscillatorNode(context, {frequency: this.lfoRate, type: shape});
			lfo.start(time);
			lfo.connect(this.lfoEnvelope);
			this.lfo.stop(time);
			this.lfo = lfo;
		}
		this.lfoShape = shape;
	}

	setLFOKeySync(context, enabled, time = 0) {
		if (!enabled && this.lfo) {
			this.lfo.stop(context.currentTime + NEVER);
		}
		this.lfoKeySync = enabled;
	}

	getLFORate() {
		return this.lfoRate;
	}

	getLFOShape() {
		return this.lfoShape;
	}

	getLFOKeySync() {
		return this.lfoKeySync;
	}

	useLFOPreset(context, presetNum, time = 0, method = 'setValueAtTime') {
		this.setLFORate(context, LFO_FREQUENCIES[presetNum] * this.synth.lfoRateMultiplier, time, method);
	}

	getLFOPreset() {
		let frequency = this.lfoRate / this.synth.lfoRateMultiplier;
		frequency = Math.round(frequency * 100) / 100;
		return LFO_FREQUENCIES.indexOf(frequency);
	}

	triggerLFO(context, time) {
		if (this.lfoKeySync && this.lfoRate !== 0) {
			// Reset LFO phase
			const lfo = new OscillatorNode(context, {frequency: this.lfoRate, type: this.lfoShape});
			lfo.start(time);
			lfo.connect(this.lfoEnvelope);
			if (this.lfo) {
				this.lfo.stop(time);
			}
			this.lfo = lfo;
		}

		const envelope = this.lfoEnvelope.gain;
		const initialAmplitude = this.lfoEnvelopeType;	// 0 or 1
		cancelAndHoldAtTime(envelope, initialAmplitude, time);
		const endDelay = time + this.lfoDelay;
		envelope.setValueAtTime(initialAmplitude, endDelay)
		envelope.linearRampToValueAtTime(1 - initialAmplitude, endDelay + this.lfoFadeTime);
	}

	applyLFO(time) {
		cancelAndHoldAtTime(this.lfoEnvelope.gain, 1, time);
	}

	scheduleSoundOff(operator, time) {
		if (operator.getVolume() !== 0) {
			this.stopTime = Math.max(this.stopTime, time);
		}
	}

	scheduleOscillators() {
		let lastOpOff = 1;
		for (let i = 4; i >= 1; i--) {
			const operator = this.operators[i - 1];
			if (operator.keyIsOn) {
				// Any lower numbered operator may be modulating this one and the algorithm can
				// change while the gate is open.
				lastOpOff = i + 1;
				break;
			}
		}
		const stopTime = this.stopTime;
		for (let i = 4; i >= lastOpOff; i--) {
			this.operators[i - 1].stopOscillator(stopTime);
		}
		if (lastOpOff === 1 && this.lfo && this.lfoKeySync) {
			this.lfo.stop(stopTime);
		}
		this.oldStopTime = stopTime;
	}

	/**
	 * N.B. Doesn't fade in the LFO if a delay has been set. Use {@link Channel.keyOn} or
	 * {@link Channel.keyOnWithVelocity} for that.
	 */
	keyOnOff(context, time, op1, op2 = op1, op3 = op1, op4 = op1) {
		const operators = this.operators;
		if (op1) {
			operators[0].keyOn(context, time + this.operatorDelay[0]);
		} else {
			operators[0].keyOff(time);
		}
		if (op2) {
			operators[1].keyOn(context, time + this.operatorDelay[1]);
		} else {
			operators[1].keyOff(time);
		}
		if (op3) {
			operators[2].keyOn(context, time + this.operatorDelay[2]);
		} else {
			operators[2].keyOff(time);
		}
		if (op4) {
			operators[3].keyOn(context, time + this.operatorDelay[3]);
		} else {
			operators[3].keyOff(time);
		}
		this.scheduleOscillators();
	}

	keyOn(context, time = context.currentTime + TIMER_IMPRECISION) {
		this.triggerLFO(context, time);
		this.keyOnOff(context, time, true);
	}

	keyOff(time) {
		this.keyOnOff(undefined, time, false);
	}

	setOperatorDelay(operatorNum, delay) {
		this.operatorDelay[operatorNum - 1] = delay / 1000;
	}

	getOperatorDelay(operatorNum) {
		return this.operatorDelay[operatorNum - 1] * 1000;
	}

	/**Invoke directly to apply aftertouch.
	 */
	setVelocity(velocity, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 4; i++) {
			const sensitivity = this.keyVelocity[i];
			if (sensitivity > 0) {
				const totalLevel = 127 - velocity * sensitivity;
				this.operators[i].setTotalLevel(totalLevel, time);
			}
		}
	}

	/**When this method is used then the overall output level needs to be controlled using
	 * the channel's setModulationDepth() method rather than setTotalLevel().
	 */
	keyOnWithVelocity(context, velocity, time = context.currentTime + TIMER_IMPRECISION) {
		this.setVelocity(velocity, time);
		this.keyOn(context, time);
	}

	setKeyVelocity(operatorNum, sensitivity) {
		this.keyVelocity[operatorNum - 1] = sensitivity;
	}

	getKeyVelocity(operatorNum) {
		return this.keyVelocity[operatorNum - 1];
	}

	soundOff(time = 0) {
		for (let operator of this.operators) {
			operator.soundOff(time);
		}
		if (this.lfo && this.lfoKeySync) {
			this.lfo.stop(time);
		}
	}

	/**
	 * @param {number} panning -1 = left channel only, 0 = centre, 1 = right channel only
	 */
	setPan(panning, time = 0, method = 'setValueAtTime') {
		this.panner.pan[method](panning, time);
	}

	getPan() {
		return this.panner.pan.value;
	}

	setVolume(volume, time = 0, method = 'setValueAtTime') {
		this.volumeControl[method](volume, time);
	}

	getVolume() {
		return this.volumeControl.value;
	}

	mute(muted, time = 0) {
		this.muteControl.setValueAtTime(muted ? 0 : 1, time);
	}

	isMuted() {
		return this.muteControl.value === 0;
	}

	get numberOfOperators() {
		return 4;
	}

}

class FMSynth {

	constructor(context, output = context.destination, numChannels = 6, clockRate = CLOCK_RATE.PAL) {
		this.setClockRate(clockRate);

		const channelGain = new GainNode(context, {gain: 1 / numChannels});
		channelGain.connect(output);
		this.channelGain = channelGain.gain;
		supportsCancelAndHold = channelGain.gain.cancelAndHoldAtTime !== undefined;

		const dbCurve = new Float32Array(2047);
		dbCurve.fill(0, 0, 1024);
		for (let i = 1024; i < 2047; i++) {
			dbCurve[i] = logToLinear(i - 1023);
		}

		// Table of frequencies in Hertz divided the synth's frequency step.
		this.noteFrequencies = this.tunedMIDINotes(440);

		// Used by the operators to remove the DC offset inherent in certain wave shapes.
		this.dcOffset = new ConstantSourceNode(context);

		const sine = OscillatorConfig.mono('sine');
		const halfSine = OscillatorConfig.am('sine', false, -0.85 / Math.PI, 'square', 1);
		const absSine = OscillatorConfig.mono('sine', true);
		const quarterSine = OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 2);
		const oddSine = OscillatorConfig.am('sine', false, 0, 'square', 1, 2);
		const absOddSine = OscillatorConfig.am('sine', true, -1 / Math.PI, 'square', 1, 2);
		const square = OscillatorConfig.mono('square');
		const sawtooth = OscillatorConfig.mono('sawtooth');
		const triangle = OscillatorConfig.mono('triangle');
		const saw12 = OscillatorConfig.additive('sawtooth', false, 0, 'sawtooth', 2, 1, 4/3);
		const square12 = OscillatorConfig.additive('square', false, 0, 'square', 2);
		const triangle12 = OscillatorConfig.additive('triangle', false, 0, 'triangle', 2, 1, 4/3);
		const sine1234 = new OscillatorConfig('sine', false, -0.25, 'sine', 2, 1, 1, false, 2/3, true);

		const root = x => 2 * Math.atan(Math.sqrt(x));
		const organGain = (harmonic, x) => 2 / (Math.sin(x) + Math.sin(harmonic * x));

		const sine12 = OscillatorConfig.additive('sine', false, 0, 'sine', 2, 1,
			organGain(2, root(6 - Math.sqrt(33)))
		);
		const sine13 = OscillatorConfig.additive('sine', false, 0, 'sine', 3, 1,
			organGain(3, root(5 - 2 * Math.sqrt(6)))
		);
		const sine14 = OscillatorConfig.additive('sine', false, 0, 'sine', 4, 1,
			organGain(4, 2 * 0.97043)
		);
		const sine15 = OscillatorConfig.additive('sine', false, 0, 'sine', 5, 1,
			organGain(5, Math.PI / 2)
		);
		const sine16 = OscillatorConfig.additive('sine', false, 0, 'sine', 6, 1,
			organGain(6, root(0.597383))
		);
		const sine17 = OscillatorConfig.additive('sine', false, 0, 'sine', 7, 1,
			organGain(7, root(0.402496))
		);
		const sine18 = OscillatorConfig.additive('sine', false, 0, 'sine', 8, 1,
			organGain(8, root(1.47569))
		);


		this.oscillatorConfigs = [
			sine, halfSine, absSine, quarterSine,
			oddSine, absOddSine, square, sawtooth,
			triangle,
			saw12, square12, triangle12, sine1234,
			sine12, sine13, sine14, sine15, sine16, sine17, sine18,
		];

		const channels = new Array(numChannels);
		for (let i = 0; i < numChannels; i++) {
			channels[i] = new Channel(this, context, channelGain, dbCurve);
		}
		this.channels = channels;

		const twoOpChannels = new Array(numChannels * 2 - 2);
		for (let i = 0; i < numChannels; i++) {
			const channel = channels[i];
			twoOpChannels[2 * i] = new TwoOperatorChannel(channel, 1);
			twoOpChannels[2 * i + 1] = new TwoOperatorChannel(channel, 3);
		}
		this.twoOpChannels = twoOpChannels;

		const pcmAmp = new GainNode(context, {gain: 0});
		pcmAmp.connect(channels[numChannels - 1].panner);
		this.pcmAmp = pcmAmp;
		this.dacRegister = undefined;
	}

	enablePCMRegister(context) {
		const dacRegister = new ConstantSourceNode(context, {offset: 0});
		dacRegister.connect(this.pcmAmp);
		dacRegister.start();
		this.dacRegister = dacRegister;
	}

	setClockRate(clockRate) {
		this.envelopeTick = 72 * 6 / clockRate;
		this.lfoRateMultiplier = clockRate / 8000000;
		const oldFrequencyStep = this.frequencyStep;
		this.frequencyStep = clockRate / (144 * 2 ** 20);
		if (this.noteFrequencies) {
			const ratio = oldFrequencyStep / this.frequencyStep;
			for (let i = 0; i < 128; i++) {
				this.noteFrequencies[i] *= ratio;
			}
		}
	}

	start(time) {
		for (let channel of this.channels) {
			channel.start(time);
		}
		this.dcOffset.start(time);
	}

	stop(time = 0) {
		for (let channel of this.channels) {
			channel.stop(time);
		}
		if (this.dacRegister) {
			this.dacRegister.stop(time);
			this.dacRegister = undefined;
		}
		this.dcOffset.stop(time);
		this.dcOffset = undefined;
	}

	soundOff(time = 0) {
		for (let channel of this.channels) {
			channel.soundOff(time);
		}
	}

	getChannel(channelNum) {
		return this.channels[channelNum - 1];
	}

	get2OperatorChannel(channelNum) {
		return this.twoOpChannels[channelNum - 1];
	}

	/**
	 * @param {number} amount The gain to apply to the PCM channel, in the range [0..numChannels].
	 * Values in the range (0, 1] will fade down the volume of the highest numbered FM channel
	 * to make space in the mix for PCM content. Values greater than one will fade down the
	 * volume of the other FM channels in addition to silencing the last one.
	 */
	mixPCM(amount, time = 0, method = 'setValueAtTime') {
		let lastChannelVolume, otherChannelsVolume;
		if (amount <= 1) {
			lastChannelVolume = 1 - amount;
			otherChannelsVolume = 1;
		} else {
			lastChannelVolume = 0;
			otherChannelsVolume = 1 - (amount - 1) / (this.channels.length - 1);
		}
		const numChannels = this.channels.length;
		this.channels[numChannels - 1].setVolume(lastChannelVolume, time, method);
		this.pcmAmp.gain[method](amount, time);
		for (let i = 0; i < numChannels - 1; i++) {
			this.channels[i].setVolume(otherChannelsVolume, time, method);
		}
	}

	getPCMMix() {
		return this.pcmAmp.value;
	}

	writePCM(value, time) {
		const floatValue = (value - 128) / 128;
		this.dacRegister.offset.setValueAtTime(floatValue, time);
	}

	syncLFOs(context, frequency = undefined, time = context.currentTime + TIMER_IMPRECISION, ...channels) {
		if (channels.length === 0) {
			channels = new Array(this.channels.length);
			channels.fill(true);
		}
		const index = channels.indexOf(true);
		if (index === -1) {
			return;
		}
		if (frequency === undefined) {
			frequency = this.channels[index].getLFORate();
		}
		for (let i = index; i < channels.length; i++) {
			if (channels[i]) {
				const channel = this.channels[i];
				channel.setLFORate(context, 0, time);
				channel.setLFOKeySync(context, false, time);
			}
		}
		if (frequency !== 0) {
			for (let i = index; i < channels.length; i++) {
				if (channels[i]) {
					this.channels[i].setLFORate(context, frequency, time);
				}
			}
		}
	}

	setChannelGain(level, time = 0, method = 'setValueAtTime') {
		this.channelGain[method](level / this.channels.length, time);
	}

	/**Calculates frequency data for a scale of 128 MIDI notes. The results are expressed in
	 * terms of the YM2612's block and frequency number notation.
	 * @param {number} a4Pitch The pitch to tune A4 to, in Hertz.
	 */
	tunedMIDINotes(a4Pitch = 440) {
		const frequencyData = new Array(128);
		for (let i = 0; i < 128; i++) {
			const frequency = a4Pitch * (2 ** ((i - 69) / 12));
			frequencyData[i] = frequency / this.frequencyStep;
		}
		return frequencyData;
	}

}

class TwoOperatorChannel {

	constructor(parentChannel, startingOperator) {
		this.parentChannel = parentChannel;
		this.operatorOffset = startingOperator - 1;
		this.tremoloDepth = 0;
		this.vibratoDepth = 0;
		this.detune = 0;	// 1:1 with non-detuned frequency
	}

	getOperator(operatorNum) {
		return this.parentChannel.getOperator(this.operatorOffset + operatorNum);
	}

	/**Switches into two operator mode. A fixed panning setting for the pair of two
	 * operator channels needs to be configured on the parent channel.
	 */
	activate(context, time = 0) {
		const parent = this.parentChannel;
		parent.setVolume(0.5, time);	// Reserve half the output level for the other 2 op channel.
		// Disable features that don't apply to 2 op channels.
		parent.setLFOShape(context, 'triangle', time);	// Fixed LFO shape
		parent.setLFOKeySync(context, false);
		parent.applyLFO(time);	// No LFO envelope
		parent.mute(false, time);
	}

	setAlgorithm(modulationDepth, outputLevels, time = 0, method = 'setValueAtTime') {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		parent.setModulationDepth(offset + 1, offset + 2, modulationDepth, time, method);
		for (let i = 1; i <= 2; i++) {
			const operator = parent.getOperator(offset + i);
			const outputLevel = outputLevels[i - 1];
			operator.enable();
			operator.setVolume(outputLevel, time, method);
			parent.setKeyVelocity(offset + i, outputLevel === 0 ? 0 : 1);
		}
	}

	useAlgorithm(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = TWO_OP_ALGORITHMS[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
	}

	getAlgorithm() {
		const isFM = this.getModulationDepth(1, 2) !== 0;
		return isFM ? 0 : 1;
	}

	setModulationDepth(amount, time = 0, method = 'setValueAtTime') {
		const offset = this.operatorOffset;
		this.parentChannel.setModulationDepth(offset + 1, offset + 2, amount, time, method);
	}

	getModulationDepth() {
		const offset = this.operatorOffset;
		return this.parentChannel.getModulationDepth(offset + 1, offset + 2);
	}

	disableOperator(operatorNum, time = 0) {
		this.parentChannel.disableOperator(this.operatorOffset + operatorNum, time);
	}

	enableOperator(operatorNum) {
		this.parentChannel.enableOperator(this.operatorOffset + operatorNum);
	}

	fixFrequency(operatorNum, fixed, time = undefined, preserve = true, method = 'setValueAtTime') {
		this.parentChannel.fixFrequency(this.operatorOffset + operatorNum, fixed, time, preserve, method);
	}

	isOperatorFixed(operatorNum) {
		return this.parentChannel.isOperatorFixed(this.operatorOffset + operatorNum);
	}

	setFrequency(blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (!parent.isOperatorFixed(operatorNum)) {
				const multiple = parent.getFrequencyMultiple(operatorNum);
				parent.getOperator(operatorNum).setFrequency(blockNumber, frequencyNumber, multiple, time, method);
			}
		}
		parent.freqBlockNumbers[offset] = blockNumber;
		parent.frequencyNumbers[offset] = frequencyNumber;
	}

	setOperatorFrequency(operatorNum, blockNumber, frequencyNumber, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setOperatorFrequency(this.operatorOffset + operatorNum, blockNumber, frequencyNumber, time, method);
	}

	getFrequencyBlock(operatorNum = 2) {
		return this.parentChannel.getFrequencyBlock(this.operatorOffset + operatorNum);
	}

	getFrequencyNumber(operatorNum = 2) {
		return this.parentChannel.getFrequencyNumber(this.operatorOffset + operatorNum);
	}

	setFrequencyMultiple(operatorNum, multiple, time = undefined, method = 'setValueAtTime') {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		const effectiveOperatorNum = offset + operatorNum;
		parent.setFrequencyMultiple(effectiveOperatorNum, multiple);
		if (time !== undefined && !parent.isOperatorFixed(effectiveOperatorNum)) {
			const block = parent.getFrequencyBlock(offset + 1);
			const freqNum = parent.getFrequencyNumber(offset + 1);
			const operator = parent.getOperator(effectiveOperatorNum);
			operator.setFrequency(block, freqNum, multiple, time, method);
		}
	}

	getFrequencyMultiple(operatorNum) {
		return this.parentChannel.getFrequencyMultiple(this.operatorOffset + operatorNum);
	}

	setDetune(cents) {
		this.detune = 2 ** (cents / 1200);
	}

	getDetune() {
		return Math.round(Math.log2(this.detune) * 12000) / 10;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		const frequency = this.parentChannel.synth.noteFrequencies[noteNumber] * this.detune;
		const [block, freqNum] = fullFreqToComponents(frequency);
		this.setFrequency(block, freqNum, time, method);
	}

	pitchBend(bend, release, startTime, timesPerStep, maxSteps = bend.getLength(release), scaling = 1) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 0; i < 2; i++) {
			const effectiveOperatorNum = offset + i;
			if (!parent.isOperatorFixed(effectiveOperatorNum)) {
				const operator = parent.getOperator(effectiveOperatorNum);
				bend.execute(
					operator.frequencyParam, release, startTime, timesPerStep, maxSteps,
					operator.frequency, scaling
				);
			}
		}
	}

	setOperatorNote(operatorNum, noteNumber, time = 0, method = 'setValueAtTime') {
		const parent = this.parentChannel;
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		parent.fixFrequency(effectiveOperatorNum, true, undefined, false);
		const frequency = parent.synth.noteFrequencies[noteNumber] * this.detune;
		const [block, freqNum] = fullFreqToComponents(frequency);
		parent.setOperatorFrequency(effectiveOperatorNum, block, freqNum, time, method);
	}

	getMIDINote(operatorNum = 2) {
		const parent = this.parentChannel;
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const block = parent.getFrequencyBlock(effectiveOperatorNum);
		const freqNum = parent.getFrequencyNumber(effectiveOperatorNum);
		return frequencyToNote(block, freqNum, parent.synth.noteFrequencies, this.detune);
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setFeedback(amount, this.operatorOffset + 1, time, method);
	}

	getFeedback() {
		return this.parentChannel.getFeedback(this.operatorOffset + 1);
	}

	useFeedbackPreset(n, time = 0, method = 'setValueAtTime') {
		this.parentChannel.useFeedbackPreset(n, this.operatorOffset + 1, time, method);
	}

	getFeedbackPreset() {
		return this.parentChannel.getFeedbackPreset(this.operatorOffset + 1);
	}

	setFeedbackFilter(cutoff, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setFeedbackFilter(cutoff, this.operatorOffset + 1, time, method);
	}

	getFeedbackFilterFreq() {
		return this.parentChannel.getFeedbackFilterFreq(this.operatorOffset + 1);
	}

	setTremoloDepth(depth, time = 0, method = 'setValueAtTime') {
		const linearAmount = (1020 * depth / 512) / 1023;
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isTremoloEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloDepth() {
		return Math.round(this.tremoloDepth * 1023 / 1020 * 512);
	}

	useTremoloPreset(presetNum, time = 0, method = 'setValueAtTime') {
		const linearAmount = TREMOLO_PRESETS[presetNum];
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isTremoloEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setTremoloDepth(linearAmount, time, method);
			}
		}
		this.tremoloDepth = linearAmount;
	}

	getTremoloPreset() {
		const depth = Math.round(this.tremoloDepth * 1023);
		return TREMOLO_PRESETS.indexOf(depth);
	}

	enableTremolo(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const operator = this.parentChannel.getOperator(effectiveOperatorNum);
		operator.setTremoloDepth(enabled ? this.tremoloDepth : 0, time, method);
		parentChannel.tremoloEnabled[effectiveOperatorNum - 1] = enabled;
	}

	isTremoloEnabled(operatorNum) {
		return this.parentChannel.isTremoloEnabled(this.operatorOffset + operatorNum);
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const linearAmount = Math.sign(cents) * (2 ** (Math.abs(cents) / 1200)) - 1;
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = offset + i;
			if (parent.isVibratoEnabled(operatorNum)) {
				parent.getOperator(operatorNum).setVibratoDepth(linearAmount, time, method);
			}
		}
		this.vibratoDepth = linearAmount;
	}

	getVibratoDepth() {
		return Math.log2(this.vibratoDepth + 1) * 1200;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		const depth = Math.round(this.getVibratoDepth() * 10) / 10;
		return VIBRATO_PRESETS.indexOf(depth);
	}

	enableVibrato(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		const effectiveOperatorNum = this.operatorOffset + operatorNum;
		const operator = this.parentChannel.getOperator(effectiveOperatorNum);
		operator.setVibratoDepth(enabled ? this.vibratoDepth : 0, time, method);
		parentChannel.vibratoEnabled[effectiveOperatorNum - 1] = enabled;
	}

	isTremoloEnabled(operatorNum) {
		return this.parentChannel.isVibratoEnabled(this.operatorOffset + operatorNum);
	}

	setLFORate(context, frequency, time = 0, method = 'setValueAtTime') {
		this.parentChannel.setLFORate(context, frequency, time, method);
	}

	getLFORate() {
		return this.parentChannel.getLFORate();
	}

	useLFOPreset(context, presetNum, time = 0, method = 'setValueAtTime') {
		this.parentChannel.useLFOPreset(context, presetNum, time, method);
	}

	getLFOPreset() {
		return this.parentChannel.getLFOPreset();
	}

	keyOnOff(context, time, op1, op2 = op1) {
		const parent = this.parentChannel;
		const offset = this.operatorOffset;
		const operator1 = parent.getOperator(offset + 1);
		const operator2 = parent.getOperator(offset + 2);
		if (op1) {
			operator1.keyOn(context, time);
		} else {
			operator1.keyOff(time);
		}
		if (op2) {
			operator2.keyOn(context, time);
		} else {
			operator2.keyOff(time);
		}
		parent.scheduleOscillators();
	}

	keyOn(context, time = context.currentTime + TIMER_IMPRECISION) {
		this.keyOnOff(context, time, true);
	}

	keyOff(context, time = context.currentTime + TIMER_IMPRECISION) {
		this.keyOnOff(context, time, false);
	}

	keyOnWithVelocity(context, velocity, time = context.currentTime + TIMER_IMPRECISION) {
		const parent = this.parentChannel;
		for (let i = 1; i <= 2; i++) {
			const operatorNum = this.operatorOffset + i;
			const sensitivity = parent.getKeyVelocity(operatorNum);
			if (sensitivity > 0) {
				const totalLevel = 127 - velocity * sensitivity;
				parent.getOperator(operatorNum).setTotalLevel(totalLevel, time);
			}
		}
		this.keyOn(context, time);
	}

	setKeyVelocity(operatorNum, sensitivity) {
		this.parentChannel.setKeyVelocity(this.operatorOffset + operatorNum, sensitivity);
	}

	getKeyVelocity(operatorNum) {
		return this.parentChannel.getKeyVelocity(this.operatorOffset + operatorNum);
	}

	soundOff(time = 0) {
		for (let i = 1; i <= 2; i++) {
			this.parentChannel.getOperator(this.operatorOffset + i).soundOff(time);
		}
	}

	get numberOfOperators() {
		return 2;
	}

}

export {
	Envelope, OscillatorConfig, FMOperator, Channel, FMSynth,
	logToLinear, linearToLog,
	DETUNE_AMOUNTS, TREMOLO_PRESETS, ENVELOPE_TYPE, CLOCK_RATE
};

const ATTACK_TARGET = [1032.48838867428, 1032.48838867428, 1032.48838867428,
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

const ATTACK_CONSTANT = [63279.2004921133, 63279.2004921133, 31639.6002460567,
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
