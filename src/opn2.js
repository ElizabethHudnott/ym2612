import {
	decibelReductionToAmplitude, amplitudeToDecibels, TIMER_IMPRECISION, CLOCK_RATE,
	LFO_FREQUENCIES, VIBRATO_PRESETS
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

function logToLinear(x) {
	return x === 0 ? 0 : 10 ** (54 / 20 * (x - 1));
}

function linearToLog(y) {
	return y == 0 ? 0 : 20 / 54 * Math.log10(y) + 1;
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

// For decay, sustain and release
const ENV_INCREMENT = new Array(64);
{
	const increments = [0, 0, 4, 4, 4, 4, 6, 6];
	for (let i = 0; i < 60; i++) {
		const power = Math.trunc(i / 4) - 14;
		const multiple = i < 8 ? increments[i] : ((i % 4) + 4);
		ENV_INCREMENT[i] =  multiple * (2 ** power);
	}
	ENV_INCREMENT.fill(8, 60);
}

class Envelope {

	/**Creates an envelope.
	 * @param {GainNode} output The GainNode to be controlled by the envelope.
	 */
	constructor(synth, context, output, dbCurve) {
		this.synth = synth;
		output.gain.value = 0;
		const gainNode = new ConstantSourceNode(context, {offset: 0});
		this.gainNode = gainNode;
		this.gain = gainNode.offset;

		const totalLevelNode = new ConstantSourceNode(context, {offset: 0});
		this.totalLevelNode = totalLevelNode;
		this.totalLevel = totalLevelNode.offset;
		const shaper = new WaveShaperNode(context, {curve: dbCurve});
		gainNode.connect(shaper);
		totalLevelNode.connect(shaper);
		shaper.connect(output.gain);

		this.rateScaling = 0;
		this.attackRate = 16;
		this.decayRate = 12;
		this.sustainRate = 0;
		this.releaseRate = 17;
		this.sustain = 576;		// Already converted into an attenuation value.
		this.inverted = false;
		this.jump = false;	// Jump to high level at end of envelope (or low if inverted)

		// Values stored during key on.
		this.beginLevel = 0;
		this.hasAttack = true;
		this.beginAttack = 0;
		this.prevAttackRate = 0;
		this.endAttack = 0;
		this.endDecay = 0;
		this.endSustain = 0;
		this.beginRelease = 0;
		this.releaseLevel = 0;
		this.endRelease = 0;
	}

	start(time = 0) {
		this.gainNode.start(time);
		this.totalLevelNode.start(time);
	}

	stop(time = 0) {
		this.gainNode.stop(time);
		this.totalLevelNode.stop(time);
	}

	/**
	 * For Algorithm 7, set total level to at least 122 to avoid distortion.
	 */
	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.totalLevel[method](-level / 128, time);
	}

	getTotalLevel() {
		return -Math.round(this.totalLevel.value * 128);
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
			this.inverted = false;
			this.jump = false;
			return;
		}
		mode -= 8;
		this.inverted = mode >= 4;
		this.jump = [0, 3, 4, 7].includes(mode);
	}

	/**
	 * Don't call with rate = 0, because that means infinite time.
	 */
	decayTime(from, to, basicRate, rateAdjust) {
		const rate = Math.min(Math.round(2 * basicRate + rateAdjust), 63);
		const gradient = ENV_INCREMENT[rate];
		return this.synth.envelopeTick * (from - to) / gradient;
	}

	/**Opens the envelope at a specified time.
	 */
	keyOn(keyCode, time) {
		const rateAdjust = Math.trunc(keyCode / 2 ** (3 - this.rateScaling));
		const tickRate = this.synth.envelopeTick;
		const gain = this.gain;
		const invert = this.inverted;
		const ssgScale = invert || this.jump ? 6 : 1;

		let beginLevel = 0;
		const endRelease = this.endRelease;
		if (endRelease > 0) {
			//I.e. it's not the first time the envelope ran.
			if (time >= endRelease) {
				// Release phase ended.
				beginLevel = this.jump ? 1023 : 0;
			} else {
				// Still in the release phase
				const beginRelease = this.beginRelease;
				const timeProportion = (time - beginRelease) / (endRelease - beginRelease);
				beginLevel = this.releaseLevel * (1 - timeProportion);
			}
			if (invert) {
				beginLevel = 1023 - beginLevel;
			}
		}

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
				this.beginAttack = time;
				this.prevAttackRate = attackRate;
				const attackTime = -timeConstant * Math.log((1023 - target) / (beginLevel - target));
				endAttack += attackTime;
			}
			cancelAndHoldAtTime(gain, 1, endAttack);
		}
		this.endAttack = endAttack;

		if (this.decayRate === 0) {
			const endTime = invert ? time : Infinity;
			this.endDecay = endTime;
			this.endSustain = endTime;
			return;
		}

		const decay = this.decayTime(1023, this.sustain, this.decayRate, rateAdjust) / ssgScale;
		const endDecay = endAttack + decay;
		const sustain = invert ? 1023 - this.sustain : this.sustain;
		gain.linearRampToValueAtTime(sustain / 1023, endDecay);
		this.endDecay = endDecay;
		if (this.sustainRate === 0) {
			this.endSustain = Infinity;
			return;
		}

		const sustainTime = this.decayTime(this.sustain, 0, this.sustainRate, rateAdjust) / ssgScale;
		const endSustain = endDecay + sustainTime;
		gain.linearRampToValueAtTime(invert ? 1 : 0, endSustain);
		this.endSustain = endSustain;

		if (this.jump) {
			gain.linearRampToValueAtTime(invert ? 0 : 1, endSustain + tickRate);
		}
	}

	linearValueAtTime(time) {
		const endAttack = this.endAttack;
		const endDecay = this.endDecay;
		const endSustain = this.endSustain;
		let linearValue;

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

		} else if (time >= endAttack) {

			// In the decay phase.
			if (endDecay === Infinity) {
				linearValue = 1023;
			} else {
				const timeProportion = (time - endAttack) / (endDecay - endAttack);
				linearValue = 1023 -  timeProportion * (1023 - this.sustain);
			}

		} else if (!this.hasAttack) {

			// Attack rate was 0.
			return this.beginLevel;

		} else {

			// In the attack phase.
			const attackRate = this.prevAttackRate;
			const target = ATTACK_TARGET[attackRate - 2];
			const timeConstant = ATTACK_CONSTANT[attackRate - 2] * this.synth.envelopeTick;
			const beginAttack = this.beginAttack;
			const beginLevel = this.beginLevel;
			return target + (beginLevel - target) * Math.exp(-(time - beginAttack) / timeConstant);

		}

		if (this.inverted) {
			linearValue = 1023 - linearValue;
		}
		return linearValue;
	}

	/**Closes the envelope at a specified time.
	 */
	keyOff(keyCode, time) {
		const currentValue = this.linearValueAtTime(time);
		const rateAdjust = Math.trunc(keyCode / 2 ** (3 - this.rateScaling));
		const ssgScale = this.inverted || this.jump ? 6 : 1;
		const releaseTime = this.decayTime(currentValue, 0, this.releaseRate, rateAdjust) / ssgScale;
		const gain = this.gain;
		cancelAndHoldAtTime(gain, currentValue / 1023, time);
		const endRelease = time + releaseTime;
		gain.linearRampToValueAtTime(0, endRelease);
		this.beginRelease = time;
		this.releaseLevel = currentValue;
		this.endRelease = endRelease;
	}

	/**Cuts audio output without going through the envelope's release phase.
	 * @param {number} time When to stop outputting audio. Defaults to ceasing sound production immediately.
	 */
	soundOff(time = 0) {
		cancelAndHoldAtTime(this.gain, 0, time);
	}

}


/**The amount to detune each note by when the various detuning settings are applied. The
 * array is organized into four sequential blocks of 32 values each. The first block
 * represents the changes in frequency from the basic scale when an operator's detuning
 * parameter is set to 0 (should be 32 zeros!). The second block represents the increases
 * in frequency when the detuning parameter is set to 1 and the decreases in frequency
 * when the detuning parameter is set to 5, and so on. Each block of 32 values contains a
 * single entry for each of the YM2612's "key codes". The find a note's key code you
 * multiply its block number by 4 and place the two most significant bits of its frequency
 * number into the two least significant bits of the key code. Each value in the array
 * (per detuning value, per key code) is a multiplier that's applied as a deviation from
 * the note's normal frequency. For example, a value of 0.05 represents a 5% increase or
 * decrease applied to the note's frequency in Hertz.
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
	8 , 8, 9,10,11,12,13,14,16,17,19,20,22,22,22,22
];

/**Represents a single operator in the FM synthesizer. The synthesizer alters frequency
 * using phase modulation (PM). There are 4 operators per sound channel and 6 independent
 * channels by default.
 */
class Operator {

	/**Constructs an instance of an operator. Operators are normally created by
	 * invoking the {@link FMSynth} constructor.
	 * @param {AudioContext} context The Web Audio context.
	 * @param {AudioNode} lfModulator The signal used as an LFO to control the operator's phase.
	 * @param {AudioNode} amModulator The signal used to apply amplitude modulation to the oscillator's output.
	 * @param {AudioNode} output The destination to route the operator's audio output to
	 * or undefined if the operator will always be used as a modulator.
	 *
	 */
	constructor(synth, context, amModulator, output, dbCurve) {
		this.frequency = 440;
		this.sourceType = 'sine';
		this.source = this.makeSource(context);

		const amMod = new GainNode(context);
		this.amModNode = amMod;
		this.amMod = amMod.gain;
		const amModGain = new GainNode(context, {gain: 0});
		amModGain.connect(amMod.gain);
		this.amModAmp = amModGain.gain;
		amModulator.connect(amModGain);

		const envelopeGain = new GainNode(context);
		amMod.connect(envelopeGain);
		this.envelope = new Envelope(synth, context, envelopeGain, dbCurve);
		this.envelopeGain = envelopeGain;

		if (output !== undefined) {
			const mixer = new GainNode(context);
			envelopeGain.connect(mixer);
			mixer.connect(output);
			this.mixer = mixer.gain;
		}

		this.synth = synth;
		this.lastFreqChange = 0;
		this.freqBlockNumber = 4;
		this.frequencyNumber = 1093;
		this.keyCode = calcKeyCode(4, 1093);
		this.frequencyMultiple = 1;
		this.detune = 0;
		this.keyIsOn = false;
		this.freeRunning = false;
	}

	makeSource(context) {
		const oscillator = new OscillatorNode(
			context,
			{frequency: this.frequency, type: this.sourceType}
		);
		this.frequencyParam = oscillator.frequency;
		return oscillator;
	}


	/**Starts the operator's oscillator.
	 * Operators are normally started by calling start() on an instance of {@link FMSynth}.
	 */
	start(time) {
		this.source.start(time);
		this.envelope.start(time);
	}

	/**Stops the operator's oscillator so that the operator's system resources can be released.
	 * Operators are normally stopped by calling stop() on an instance of {@link FMSynth}.
	 */
	stop(time = 0) {
		this.source.stop(time);
		this.envelope.stop(time);
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
	 * @param {number} blockNumber A kind of octave measurement. See {@link FMSynth.noteFrequencies}.
	 * @param {number} frequencyNumber A linear frequency measurement. See {@link FMSynth.noteFrequencies}.
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
		const frequencyStep = this.synth.frequencyStep;
		const frequency = fullFreqNumber * frequencyMultiple * frequencyStep;
		this.frequencyParam[method](frequency, time);
		this.frequency = frequency;
		this.lastFreqChange = time;
		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
		this.keyCode = keyCode;
		this.frequencyMultiple = frequencyMultiple;
	}


	/**Returns the block number associated with the operator's current frequency.
	 * See {@link FMSynth.noteFrequencies}.
	 */
	getFrequencyBlock() {
		return this.freqBlockNumber;
	}

	/**Returns the frequency number associated with the operator's current frequency.
	 * See {@link FMSynth.noteFrequencies}.
	 */
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

	/** Specifies the degree to which this operator's output undergoes amplitude
	 * modulation from the synthesizer's LFO. This method is usually invoked by an instance
	 * of {@link Channel}. Use its enableAM(), useAMPreset() and setAMDepth() methods to
	 * configure amplitude modulation for the operators. However, if you wish then you can
	 * instead manually initiate amplitude modulation by invoking this method directly. This
	 * allows different operators to have differing levels of amplitude modulation.
	 * @param {number} linearAmount The amount of amplitude modulation to apply between 0
	 * and 1. Unlike the {@link Channel} methods this method uses a linear scale. You'll
	 * probably first want to convert from an exponential (decibels) scale to a linear scale
	 * using the decibelReductionToAmplitude() function in order to match human perception of
	 * loudness.
	 * @param {number} [time] When to change the amplitude modulation depth. Defaults to immediately.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setAMDepth(linearAmount, time = 0, method = 'setValueAtTime') {
		this.amModAmp[method](linearAmount, time);
		this.amMod[method](-(1 - linearAmount), time);
	}

	/**Gets the amount of amplitude modulation being applied to the operator on a 0..1 linear scale. */
	getAMDepth() {
		return this.amModAmp.value;
	}

	setVolume(level, time = 0, method = 'setValueAtTime') {
		this.mixer[method](level, time);
	}

	getVolume() {
		return this.mixer.value;
	}

	keyOn(time) {
		this.envelope.keyOn(this.keyCode, time);
		this.keyIsOn = true;
	}

	keyOff(time) {
		if (this.keyIsOn) {
			this.envelope.keyOff(this.keyCode, time);
			this.keyIsOn = false;
		}
	}

	soundOff(time = 0) {
		this.envelope.soundOff(time);
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

	setFreeRunning(enabled) {
		this.freeRunning = enabled;
	}

	getFreeRunning() {
		return this.freeRunning;
	}

}

class FMOperator extends Operator {

	constructor(synth, context, lfModulator, amModulator, output, dbCurve) {
		super(synth, context, amModulator, output, dbCurve);
		this.source.connect(this.amModNode);
		const fmModAmp = new GainNode(context, {gain: 440});
		fmModAmp.connect(this.frequencyParam);
		lfModulator.connect(fmModAmp);
		this.fmModAmp = fmModAmp;
	}

	connectIn(source) {
		source.connect(this.fmModAmp);
	}

	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		super.setFrequency(blockNumber, frequencyNumber, frequencyMultiple, time, method);
		this.fmModAmp.gain[method](this.frequency, time);
	}

	changeSource(context, time) {
		const newSource = this.makeSource(context)
		newSource.start(time);
		newSource.connect(this.amModNode);
		this.source.stop(time);
		this.fmModAmp.connect(this.frequencyParam);
		this.source = newSource;
	}

	keyOn(context, time = context.currentTime + TIMER_IMPRECISION) {
		if (!this.keyIsOn) {
			const frequency = this.frequency;

			const makeNewOscillator =
				!this.freeRunning &&
				frequency !== 0 &&
				this.lastFreqChange <= time &&
				context.currentTime + TIMER_IMPRECISION <= time;

			if (makeNewOscillator) {
				this.changeSource(context, time);
			}
			super.keyOn(time);
		}
	}

	setWaveform(context, type, time = 0) {
		this.sourceType = type;
		if (this.freeRunning) {
			this.changeSource(context, time);
		}
	}

	getWaveform() {
		return this.sourceType;
	}

}

const ALGORITHMS = [
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

const AM_PRESETS = [0, 1.4, 5.9, 11.8];

function indexOfGain(modulatorOpNum, carrierOpNum) {
	if (modulatorOpNum === 1 && carrierOpNum === 1) {
		return 0;
	} else if (modulatorOpNum >= 4 || modulatorOpNum >= carrierOpNum) {
		return -1;
	}
	let index = 1;
	for (let i = modulatorOpNum - 1; i > 0; i--) {
		index += 4 - i;
	}
	index += carrierOpNum - modulatorOpNum - 1;
	return index;
}

class Channel {

	constructor(synth, context, lfo, output, dbCurve) {
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

		const lfoEnvelope = new GainNode(context);
		lfo.connect(lfoEnvelope);
		this.lfoEnvelope = lfoEnvelope.gain;
		this.lfoAttack = 0;
		const vibratoGain = new GainNode(context, {gain: 0});
		lfoEnvelope.connect(vibratoGain);
		this.vibratoDepth = vibratoGain.gain;

		const op1 = new FMOperator(synth, context, vibratoGain, lfoEnvelope, shaper, dbCurve);
		const op2 = new FMOperator(synth, context, vibratoGain, lfoEnvelope, shaper, dbCurve);
		const op3 = new FMOperator(synth, context, vibratoGain, lfoEnvelope, shaper, dbCurve);
		const op4 = new FMOperator(synth, context, vibratoGain, lfoEnvelope, shaper, dbCurve);
		this.operators = [op1, op2, op3, op4];

		const op1To1 = new GainNode(context, {gain: 0});
		op1.connectOut(op1To1);
		op1.connectIn(op1To1);
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

		const op3To4 = new GainNode(context, {gain: 0});
		op3.connectOut(op3To4);
		op4.connectIn(op3To4);

		this.gains = [
			op1To1.gain, op1To2.gain, op1To3.gain, op1To4.gain,
			op2To3.gain, op2To4.gain,
			op3To4.gain
		];

		this.freqBlockNumbers = [4, 4, 4, 4];
		this.frequencyNumbers = [1093, 1093, 1093, 1093];
		this.frequencyMultiples = [1, 1, 1, 1];
		this.fixedFrequency = [false, false, false, false];

		this.amDepth = 0;
		this.amEnabled = [false, false, false, false];
		this.transpose = 0;
		this.keyVelocity = [1, 1, 1, 1];
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
	}

	getOperator(operatorNum) {
		return this.operators[operatorNum - 1];
	}

	setAlgorithm(modulations, outputLevels, time = 0, method = 'setValueAtTime') {
		for (let i = 0; i < 6; i++) {
			this.gains[i + 1][method](modulations[i], time);
		}
		for (let i = 0; i < 4; i++) {
			const outputLevel = outputLevels[i];
			this.operators[i].setVolume(outputLevel, time, method);
			this.keyVelocity[i] = outputLevel === 0 ? 0 : 1;
		}
	}

	useAlgorithm(algorithmNum, time = 0, method = 'setValueAtTime') {
		const algorithm = ALGORITHMS[algorithmNum];
		this.setAlgorithm(algorithm[0], algorithm[1], time, method);
		this.algorithmNum = algorithmNum;
	}

	getAlgorithm() {
		return this.algorithmNum;
	}

	setModulationDepth(modulatorOpNum, carrierOpNum, amount, time = 0, method = 'setValueAtTime') {
		this.gains[indexOfGain(modulatorOpNum, carrierOpNum)][method](amount, time);
	}

	getModulationDepth(modulatorOpNum, carrierOpNum) {
		const index = indexOfGain(modulatorOpNum, carrierOpNum);
		return index === -1 ? 0 : this.gains[index].value;
	}

	disableOperator(operatorNum) {
		for (let i = operatorNum + 1; i <= 4; i++) {
			this.setModulationDepth(operatorNum, i, 0);
		}
		this.operators[operatorNum - 1].setVolume(0);
	}

	enableOperator(operatorNum, outputLevel = 1) {
		const algorithm = ALGORITHMS[this.algorithmNum];
		const modulations = algorithm[0];
		const outputLevels = algorithm[1]
		for (let i = operatorNum + 1; i <= 4; i++) {
			const index = indexOfGain(operatorNum, i);
			this.gains[index].value = modulations[index - 1];
		}
		if (outputLevels[operatorNum - 1] === 0) {
			outputLevel = 0;
		}
		this.operators[operatorNum - 1].setVolume(outputLevel);
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

	setTranspose(transpose) {
		this.transpose = transpose;
	}

	getTranspose() {
		return this.transpose;
	}

	setMIDINote(noteNumber, time = 0, method = 'setValueAtTime') {
		noteNumber += this.transpose;
		const [block, freqNum] = this.synth.noteFrequencies[noteNumber];
		this.setFrequency(block, freqNum, time, method);
	}

	setOperatorNote(operatorNum, noteNumber, time = 0, method = 'setValueAtTime') {
		this.fixedFrequency[operatorNum - 1] = true;
		const [block, freqNum] = this.synth.noteFrequencies[noteNumber];
		this.setOperatorFrequency(operatorNum, block, freqNum, time, method);
	}

	getMIDINote(operatorNum = 4) {
		const block = this.freqBlockNumbers[operatorNum - 1];
		const freqNum = this.frequencyNumbers[operatorNum - 1];
		let note = this.synth.frequencyToNote(block, freqNum);
		if (!this.fixedFrequency[operatorNum - 1]) {
			note -= this.transpose;
		}
		return note;
	}

	setFeedback(amount, time = 0, method = 'setValueAtTime') {
		this.gains[0][method](amount, time);
	}

	getFeedback() {
		return this.gains[0].value;
	}

	useFeedbackPreset(n, time = 0) {
		const amount = n === 0 ? 0 : 2 ** (n - 6);
		this.setFeedback(amount, time);
	}

	getFeedbackPreset() {
		const amount = this.getFeedback();
		return amount === 0 ? 0 : Math.round(Math.log2(amount) + 6);
	}

	setLFOAttack(seconds) {
		this.lfoAttack = seconds;
	}

	getLFOAttack() {
		return this.lfoAttack;
	}

	setAMDepth(decibels, time = 0, method = 'setValueAtTime') {
		const linearAmount = 1 - decibelReductionToAmplitude(decibels);
		for (let i = 0; i < 4; i++) {
			if (this.amEnabled[i]) {
				this.operators[i].setAMDepth(linearAmount, time, method);
			}
		}
		this.amDepth = linearAmount;
	}

	getAMDepth() {
		return amplitudeToDecibels(this.amDepth);
	}

	useAMPreset(presetNum, time = 0) {
		this.setAMDepth(AM_PRESETS[presetNum], time);
	}

	getAMPreset() {
		return AM_PRESETS.indexOf(this.amDepth);
	}

	enableAM(operatorNum, enabled = true, time = 0, method = 'setValueAtTime') {
		if (enabled) {
			this.operators[operatorNum - 1].setAMDepth(this.amDepth, time, method);
			this.amEnabled[operatorNum - 1] = true;
		} else {
			this.operators[operatorNum - 1].setAMDepth(0, time, method);
			this.amEnabled[operatorNum - 1] = false;
		}
	}

	isAMEnabled(operatorNum) {
		return this.amEnabled[operatorNum - 1];
	}

	setVibratoDepth(cents, time = 0, method = 'setValueAtTime') {
		const depth = (2 ** (cents / 1200)) - 1;
		this.vibratoDepth[method](depth, time);
	}

	getVibratoDepth() {
		return Math.log2(this.vibratoDepth.value + 1) * 1200;
	}

	useVibratoPreset(presetNum, time = 0) {
		this.setVibratoDepth(VIBRATO_PRESETS[presetNum], time);
	}

	getVibratoPreset() {
		return VIBRATO_PRESETS.indexOf(this.getVibratoDepth());
	}

	keyOnOff(context, time, op1, op2 = op1, op3 = op1, op4 = op1) {
		const operators = this.operators;
		if (op1) {
			operators[0].keyOn(context, time);
		} else {
			operators[0].keyOff(time);
		}
		if (op2) {
			operators[1].keyOn(context, time);
		} else {
			operators[1].keyOff(time);
		}
		if (op3) {
			operators[2].keyOn(context, time);
		} else {
			operators[2].keyOff(time);
		}
		if (op4) {
			operators[3].keyOn(context, time);
		} else {
			operators[3].keyOff(time);
		}
	}

	keyOn(context, time = context.currentTime + TIMER_IMPRECISION) {
		if (this.lfoAttack > 0) {
			this.lfoEnvelope.setValueAtTime(0, time);
			this.lfoEnvelope.linearRampToValueAtTime(1, time + this.lfoAttack);
		}
		this.keyOnOff(context, time, true);
	}

	keyOff(time) {
		this.keyOnOff(undefined, time, false);
	}


	/**When this method is used then the overall output level needs to be controlled using
	 * the channel's setModulationDepth() method rather than setTotalLevel().
	 */
	keyOnWithVelocity(context, velocity, time = context.currentTime + TIMER_IMPRECISION) {
		const totalLevel = 127 - velocity;
		for (let i = 0; i < 4; i++) {
			const sensitivity = this.keyVelocity[i];
			if (sensitivity > 0) {
				this.operators[i].setTotalLevel(totalLevel, time);
			}
		}
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

}

class FMSynth {
	constructor(context, output = context.destination, numChannels = 6, clockRate = CLOCK_RATE.PAL) {
		const lfo = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.lfo = lfo;
		supportsCancelAndHold = lfo.frequency.cancelAndHoldAtTime !== undefined;
		this.setClockRate(clockRate);

		const channelGain = new GainNode(context, {gain: 1 / numChannels});
		channelGain.connect(output);
		this.channelGain = channelGain.gain;

		const dbCurve = new Float32Array(2047);
		dbCurve.fill(0, 0, 1024);
		for (let i = 1024; i < 2047; i++) {
			dbCurve[i] = logToLinear((i - 1023) / 1023);
		}

		const channels = [];
		for (let i = 0; i < numChannels; i++) {
			const channel = new Channel(this, context, lfo, channelGain, dbCurve);
			channels[i] = channel;
		}
		this.channels = channels;


		const pcmGain = new GainNode(context, {gain: 0});
		pcmGain.connect(channels[5].panner);
		this.pcmGain = pcmGain.gain;
		const dacRegister = new ConstantSourceNode(context, {offset: 0});
		dacRegister.connect(pcmGain);
		this.dacRegister = dacRegister;

		/**Provides frequency information for each MIDI note in terms of the YM2612's block and
		 * frequency number notation. The block number is stored in the first element of each
		 * entry and the frequency number is stored in the nested array's second element. When the
		 * block number is zero then increasing the frequency number by one raises the note's
		 * frequency by 0.025157Hz. Increasing the block number by one multiplies the frequency in
		 * Hertz by two. You can edit this table if you want to tune to something other than A440
		 * pitch (see {@link tunedMIDINotes}). The only constraint is that the table is sorted
		 * first by block number and then by frequency number.
		 * @type {Array<Array<number>>}
		 */
		this.noteFrequencies = this.tunedMIDINotes(440);
	}

	setClockRate(clockRate, time = 0) {
		const lfoPresetNum = this.getLFOPreset();
		this.envelopeTick = 72 * 6 / clockRate;
		this.frequencyStep = clockRate / (144 * 2 ** 20);
		this.lfoRateMultiplier = clockRate / 8000000;
		if (lfoPresetNum !== -1) {
			this.useLFOPreset(lfoPresetNum, time);
		}
	}

	start(time) {
		for (let channel of this.channels) {
			channel.start(time);
		}
		this.lfo.start(time);
		this.dacRegister.start(time);
	}

	stop(time = 0) {
		for (let channel of this.channels) {
			channel.stop(time);
		}
		this.lfo.stop(time);
		this.dacRegister.stop(time);
	}

	soundOff(time = 0) {
		for (let channel of this.channels) {
			channel.soundOff(time);
		}
	}

	getChannel(channelNum) {
		return this.channels[channelNum - 1];
	}

	setLFOFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo.frequency[method](frequency, time);
	}

	getLFOFrequency() {
		return this.lfo.frequency.value;
	}

	useLFOPreset(n, time = 0) {
		this.setLFOFrequency(LFO_FREQUENCIES[n] * this.lfoRateMultiplier, time);
	}

	getLFOPreset() {
		let frequency = this.getLFOFrequency() / this.lfoRateMultiplier;
		frequency = Math.round(frequency * 100) / 100;
		return LFO_FREQUENCIES.indexOf(frequency);
	}

	/**
	 * @param {number} amount The gain to apply to the PCM channel, in the range [0..numChannels].
	 */
	mixPCM(amount, time = 0, method = 'setValueAtTime') {
		let channel6Volume, otherChannelsVolume;
		if (amount <= 1) {
			channel6Volume = 1 - amount;
			otherChannelsVolume = 1;
		} else {
			channel6Volume = 0;
			otherChannelsVolume = 1 - (amount - 1) / (this.channels.length - 1);
		}
		this.channels[5].setVolume(channel6Volume, time, method);
		this.pcmGain[method](amount, time);
		for (let i = 0; i < this.channels.length; i++) {
			if (i !== 5) {
				this.channels[i].setVolume(otherChannelsVolume, time, method);
			}
		}
	}

	getPCMMix() {
		return this.pcmGain.value;
	}

	writePCM(value, time) {
		const floatValue = (value - 128) / 128;
		this.dacRegister.offset.setValueAtTime(floatValue, time);
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
			frequencyData[i] = fullFreqToComponents(frequency / this.frequencyStep);
		}
		return frequencyData;
	}

	frequencyToNote(block, frequencyNum) {
		let lb = 0;
		let ub = 127;
		while (lb < ub) {
			let mid = Math.trunc((lb + ub) / 2);
			const [noteBlock, noteFreqNum] = this.noteFrequencies[mid];
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

	getLFO() {
		return this.lfo;
	}

}

export {
	Envelope, FMOperator, Channel, FMSynth,
	decibelReductionToAmplitude, amplitudeToDecibels, logToLinear, linearToLog,
	DETUNE_AMOUNTS, AM_PRESETS, CLOCK_RATE
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
