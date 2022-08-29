/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
import {
	cancelAndHoldAtTime, outputLevelToGain, gainToOutputLevel, PROCESSING_TIME, NEVER
} from './common.js';
import {Waveform} from './waveforms.js';
import Envelope from './fm-envelope.js';
import Synth from './fm-synth.js';

class Operator {

	/**The amount to detune each note by when the various detuning settings are applied. The
	 * array is organized into four sequential blocks of 32 values each. The first block
	 * represents the changes in frequency from the basic scale when an operator's detuning
	 * parameter is set to 0 (should be 32 zeros!). The second block represents the increases
	 * in frequency when the detuning parameter is set to 1 and the decreases in frequency
	 * when the detuning parameter is set to 5, and so on. Each block of 32 values contains a
	 * single entry for each of the YM2612's "key codes".
	 * @type {Array<number}
	 */
	static detuneAmounts = [
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

	/* Expressed in terms of a 16 bit phase offset.
	 * Approximately equal to frequency ratios: 1, 1.41, 1.57, 1.73
	 */
	static detune2Presets = [0, 27080, 37355, 47842];

	/**Constructs an instance of an operator without an oscillator. Operators are normally
	 * created using the {@link FMOperator} subclass.
	 * @param {AudioContext} context The Web Audio context.
	 * @param {AudioNode} lfo The signal used to control the operator's vibrato and tremolo effects.
	 * @param {AudioNode} output The destination to route the operator's audio output to.
	 *
	 */
	constructor(channel, context, lfo, output, dbCurve) {
		this.channel = channel;
		this.freqBlockNumber = 3;
		this.frequencyNumber = 1093;
		this.frequency =
			channel.synth.frequencyStep *
			channel.componentsToFullFreq(this.freqBlockNumber, this.frequencyNumber);

		// The operator's frequency before FM modulation
		const centreFrequencyNode = new ConstantSourceNode(context, {offset: this.frequency});
		// The oscillator's frequency at this precise moment
		const frequencyNode = new ConstantSourceNode(context, {offset: 0});
		centreFrequencyNode.connect(frequencyNode.offset);

		this.centreFrequencyNode = centreFrequencyNode;
		this.frequencyNode = frequencyNode;
		this.frequencyParam = centreFrequencyNode.offset;

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

		this.keyCode = Synth.keyCode(this.freqBlockNumber, this.frequencyNumber);
		this.frequencyMultiple = 1;
		this.detune = 0;			// Fine detune
		this.detune2 = 0;			// Used by OPM to implement fractional ratios
		this.detuneOffset = 0;	// An amount of detuning that doesn't scale with pitch.
		this.keyIsOn = false;
		this.glideFrom = undefined;
		this.glideStart = context.currentTime;
		this.glideTime = 0;
		this.disabled = false;

		this.tremoloDepth = 0;
		this.outputLevel = 99;
	}

	copyTo(operator) {
		operator.detune = this.detune;
		operator.detune2 = this.detune2;
		operator.setTremoloDepth(this.tremoloDepth);
		operator.envelope.copyTo(this.envelope);
	}

	copyEnvelopeTo(operator) {
		operator.envelope.copyTo(this.envelope);
	}

	/**Starts the operator's oscillator.
	 * Operators are normally started by calling start() on an instance of {@link FMSynth}.
	 */
	start(time) {
		this.centreFrequencyNode.start(time);
		this.frequencyNode.start(time);
		this.envelope.start(time);
	}

	/**Stops the operator's oscillator so that the operator's system resources can be released.
	 * Operators are normally stopped by calling stop() on an instance of {@link FMSynth}.
	 */
	stop(time = 0) {
		this.centreFrequencyNode.stop(time);
		this.frequencyNode.stop(time);
		this.envelope.stop(time);
		this.centreFrequencyNode = undefined;
		this.frequencyNode = undefined;
		this.frequencyParam = undefined;
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
	 * @param {number} [glideRate] The time taken to glide a distance of one octave.
	 */
	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, glideRate = 0) {
		this.cancelGlide(time);
		const currentFrequency = this.frequency;
		const keyCode = Synth.keyCode(blockNumber, frequencyNumber);
		const detuneSetting = this.detune;
		const detuneTableOffset = (detuneSetting & 3) << 5;
		const detuneSign = (-1) ** (detuneSetting >> 2);
		const detuneSteps = detuneSign * Operator.detuneAmounts[detuneTableOffset + Math.min(keyCode, 31)];

		let fullFreqNumber =
			this.channel.componentsToFullFreq(blockNumber, frequencyNumber) +
			detuneSteps +
			(this.detune2 >> (7 - blockNumber));

		if (fullFreqNumber < 0) {
			fullFreqNumber += 0x20000; // underflowing, 17 bits
		}

		// 20 bit output
		fullFreqNumber = (fullFreqNumber * frequencyMultiple + this.detuneOffset) & 0xFFFFF;

		const frequencyStep = this.channel.synth.frequencyStep;
		const newFrequency = fullFreqNumber * frequencyStep;

		if (currentFrequency === 0 || newFrequency === 0 || this.glideFrom === undefined) {
			this.frequencyParam.setValueAtTime(newFrequency, time);
		} else {
			const glideTime = Math.abs(Math.log2(newFrequency / currentFrequency)) * glideRate;
			this.frequencyParam.linearRampToValueAtTime(newFrequency, time + glideTime);
			this.glideTime = glideTime;
		}
		this.glideFrom = currentFrequency;
		this.frequency = newFrequency;	// AKA the new "glide to"
		this.glideStart = time;				// Start time for the new glide

		this.freqBlockNumber = blockNumber;
		this.frequencyNumber = frequencyNumber;
		this.frequencyMultiple = frequencyMultiple;
		this.keyCode = keyCode;
	}

	cancelGlide(time) {
		const glidingFrom = this.glideFrom;
		const glidingTo = this.frequency;
		const prevGlideStart = this.glideStart;
		const prevGlideTime = this.glideTime;
		let currentFrequency;
		if (prevGlideTime === 0 || time >= prevGlideStart + prevGlideTime) {
			currentFrequency = glidingTo;
		} else {
			currentFrequency = glidingFrom + (glidingTo - glidingFrom) * (time - prevGlideStart) / prevGlideTime;
		}
		cancelAndHoldAtTime(this.frequencyParam, currentFrequency, time);
		this.frequency = currentFrequency;
		this.glideTime = 0;
	}


	/**Returns the block number associated with the operator's current frequency. */
	getFrequencyBlock() {
		return this.freqBlockNumber;
	}

	/**Returns the frequency number associated with the operator's current frequency. */
	getFrequencyNumber() {
		return this.frequencyNumber;
	}

	getFrequencyMultiple() {
		return this.frequencyMultiple;
	}

	/** Configures the amount of detuning.
	 * @param {number} extent The amount of detuning. Zero means no detuning, 1 raises the
	 * pitch a little, 2 raises the pitch moderately, 3 raises the pitch a lot. 5 lowers
	 * the pitch a little, 6 lowers it moderately, 7 lowers it a lot.
	 * @param {number} [time] When to alter the detuning. Defaults to whenever
	 * setFrequency() is next called.
	 */
	setDetune(extent, time = undefined) {
		this.detune = extent;
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time);
		}
	}

	/**Returns the most recently set detuning value. */
	getDetune() {
		return this.detune;
	}

	/**
	 * Good values: 1/SQRT(2), Golden Ratio
	 */
	setDetune2Ratio(ratio, time = undefined) {
		this.detune2 = Math.round((ratio % 1) * 2 ** 17);
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time);
		}
	}

	setDetune2Cents(cents, time = undefined) {
		this.detune2 = Math.round((2 ** (cents / 1200) - 1) * 2 ** 17);
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time);
		}
	}

	getDetune2Ratio() {
		return this.detune2 / 2 ** 17;
	}

	getDetune2Cents() {
		return Math.round(Math.log2(1 + this.getDetune2Ratio()) * 1200);
	}

	useDetune2Preset(presetNum, time = undefined) {
		this.detune2 = Operator.detune2Presets[presetNum];
		if (time !== undefined) {
			this.setFrequency(this.freqBlockNumber, this.frequencyNumber, this.frequencyMultiple, time);
		}
	}

	getDetune2Preset() {
		return Operator.detune2Presets.indexOf(this.detune2);
	}

	setDetuneHertz(hertz) {
		this.detuneOffset = Math.round(hertz / this.channel.synth.frequencyStep);
	}

	getDetuneHertz() {
		return this.detuneOffset * this.channel.synth.frequencyStep;
	}

	/** Specifies the degree to which this operator's output undergoes amplitude
	 * modulation from the synthesizer's LFO. This method is usually invoked by an instance
	 * of {@link Channel}. Use its enableTremolo(), useTremoloPreset() and setTremoloDepth()
	 * methods to configure amplitude modulation for the operators. However, if you wish then
	 * you can manually initiate amplitude modulation by invoking this method directly. This
	 * allows different operators to have differing levels of amplitude modulation.
	 * @param {number} scaledDepth The amount of amplitude modulation to apply between 0
	 * and 1.
	 * @param {number} [time] When to change the amplitude modulation depth. Defaults to immediately.
	 * @param {string} [method] Apply the change instantaneously (default), linearly or exponentially.
	 */
	setTremoloDepth(scaledDepth, time = 0, method = 'setValueAtTime') {
		this.tremoloAmp[method](scaledDepth, time);
		this.tremolo[method](1 - Math.abs(scaledDepth), time);
		this.tremoloDepth = scaledDepth;
	}

	/**Gets the amount of amplitude modulation being applied to the operator on a 0..1 linear scale. */
	getTremoloDepth() {
		return this.tremoloDepth;
	}

	setOutputLevel(outputLevel, time = 0, method = 'setValueAtTime') {
		const gain = outputLevelToGain(outputLevel);
		this.mixer[method](gain, time);
		this.outputLevel = outputLevel;
	}

	getOutputLevel() {
		return this.outputLevel;
	}

	setGain(gain, time = 0, method = 'setValueAtTime') {
		this.mixer[method](gain, time);
		this.outputLevel = gainToOutputLevel(gain);
	}

	getGain() {
		return outputLevelToGain(this.outputLevel);
	}

	disable(time = 0) {
		this.soundOff(time);
		this.disabled = true;
	}

	enable() {
		this.disabled = false;
	}

	isDisabled() {
		return this.disabled;
	}

	keyOn(context, velocity, time) {
		this.envelope.keyOn(context, velocity, this, time);
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
		this.oscillator1 = undefined;
		this.oscillator2 = undefined;
		this.envelope.soundOff(time);
		this.keyIsOn = false;
	}

	setTotalLevel(level, time = 0, method = 'setValueAtTime') {
		this.envelope.setTotalLevel(level, time, method);
	}

	getTotalLevel() {
		return this.envelope.getTotalLevel();
	}

	setVelocitySensitivity(sensitivity) {
		this.envelope.setVelocitySensitivity(sensitivity);
	}

	getVelocitySensitivity() {
		return this.envelope.getVelocitySensitivity();
	}

	setVelocityOffset(offset) {
		this.envelope.setVelocityOffset(offset);
	}

	getVelocityOffset() {
		return this.envelope.getVelocityOffset();
	}

	setRateSensitivity(sensitivity) {
		this.envelope.setRateSensitivity(sensitivity);
	}

	getRateSensitivity() {
		return this.envelope.getRateSensitivity();
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

	getSSG() {
		return this.envelope.getSSG();
	}

	setEnvelopeRate(rate) {
		this.envelope.setEnvelopeRate(rate);
	}

	getEnvelopeRate() {
		return this.envelope.getEnvelopeRate();
	}

	setEnvelopeReset(enabled) {
		this.envelope.reset = enabled;
	}

	getEnvelopeReset() {
		return this.envelope.reset;
	}

	attenuationAutomation(automation, release, startTime, timesPerStep, maxSteps = automation.getLength(release)) {
		const envelope = this.envelope;
		if (!envelope.looping) {
			envelope.setAttack(31);
			envelope.setDecay(0);
			envelope.inverted = false;
		}
		automation.execute(
			envelope.totalLevelParam, release, startTime, timesPerStep, 1, undefined, maxSteps
		);
	}

}

export default class FMOperator extends Operator {

	constructor(channel, context, lfo, output, dbCurve) {
		super(channel, context, lfo, output, dbCurve);

		const frequencyMultiplier = new GainNode(context);
		this.frequencyNode.connect(frequencyMultiplier);
		this.frequencyMultiplier = frequencyMultiplier;
		const shaper = new WaveShaperNode(context, {curve: [1, 0, 1]});
		this.shaper = shaper;

		const amMod = new GainNode(context);
		shaper.connect(amMod);
		amMod.connect(this.tremoloNode);
		this.amMod = amMod;
		const amModAmp = new GainNode(context);
		amModAmp.connect(amMod.gain);
		this.amModAmp = amModAmp;
		const bias = new ConstantSourceNode(context, {offset: 0});
		bias.connect(this.tremoloNode);
		this.biasNode = bias;
		this.bias = bias.offset;

		this.oscillator1 = undefined;
		this.oscillator2 = undefined;
		this.oscillatorConfig = Waveform.SINE;

		const fmOut = new GainNode(context, {gain: 0});
		this.centreFrequencyNode.connect(fmOut.gain);
		this.envelopeGain.connect(fmOut);
		this.fmOut = fmOut;

		const vibratoDepth = new GainNode(context, {gain: 0});
		lfo.connect(vibratoDepth);
		const vibratoAmp = new GainNode(context, {gain: 0});
		this.centreFrequencyNode.connect(vibratoAmp.gain);
		vibratoDepth.connect(vibratoAmp);
		vibratoAmp.connect(this.frequencyNode.offset);
		this.vibratoDepthParam = vibratoDepth.gain;
		this.vibratoDepth = 0;
	}

	copyTo(operator) {
		super.copyTo(operator);
		operator.setVibratoDepth(this.vibratoDepth);
		operator.oscillatorConfig = this.oscillatorConfig;
	}

	start(time) {
		super.start(time);
		this.biasNode.start(time);
	}

	stop(time = 0) {
		super.stop(time);
		this.stopOscillator(time);
		this.oscillator1 = undefined;
		this.oscillator2 = undefined;
		this.biasNode.stop(time);
		this.biasNode = undefined;
		this.bias = undefined;
	}

	/**Configures this operator to modulate an external source (usually another operator).
	 * This method is usually called by the {@link Channel} constructor.
	 * @param {AudioNode} destination The signal to modulate.
	 */
	connectOut(destination) {
		this.fmOut.connect(destination);
	}

	connectIn(source) {
		source.connect(this.frequencyNode.offset);
	}

	connectFrequency(destination) {
		this.centreFrequencyNode.connect(destination);
	}

	newOscillator(context, time) {
		this.stopOscillator(time);	// Stop old oscillator

		const config = this.oscillatorConfig;
		this.frequencyMultiplier.gain.setValueAtTime(config.frequencyMultiplier, time);

		// Create Oscillator 1
		let oscillator1;
		if (config.periodicWave !== undefined) {

			oscillator1 = new OscillatorNode(
				context,
				{frequency: 0, periodicWave: config.periodicWave}
			);

		} else if (config.oscillator1Shape === 'custom') {

			const periodicWave = new PeriodicWave(
				context,
				{real: config.cosines, imag: config.sines}
			);
			oscillator1 = new OscillatorNode(context, {frequency: 0, periodicWave: periodicWave});
			config.periodicWave = periodicWave;

		} else {

			oscillator1 = new OscillatorNode(
				context,
				{frequency: 0, type: config.oscillator1Shape}
			);

		}

		// Configure Oscillator 1's frequency
		if (config.oscillator1FrequencyMult === 1) {
			this.frequencyNode.connect(oscillator1.frequency);
		} else {
			this.frequencyMultiplier.connect(oscillator1.frequency);
		}
		oscillator1.connect(config.waveShaping ? this.shaper : this.amMod);

		const gain = config.gain;	// Overall gain
		this.bias.setValueAtTime(gain * config.bias, time);

		// Create Oscillator 2
		let oscillator2;
		if (config.oscillator2Shape !== undefined) {
			oscillator2 = new OscillatorNode(context, {
				frequency: config.frequencyOffset, type: config.oscillator2Shape
			});
			if (config.oscillator1FrequencyMult !== 1) {
				// Oscillator 1 has customized pitch, Oscillator 2 is the fundamental.
				this.frequencyNode.connect(oscillator2.frequency);
			} else {
				// Oscillator 2 can have pitch customized.
				this.frequencyMultiplier.connect(oscillator2.frequency);
			}
			oscillator2.connect(this.amModAmp);
			if (config.additive) {
				oscillator2.connect(this.amMod);
			}

			const amplitude = config.modDepth; // Amplitude of the modulator, before gain
			this.amModAmp.gain.setValueAtTime(gain * amplitude, time);
			this.amMod.gain.setValueAtTime(gain * (1 - Math.abs(amplitude)), time);
			oscillator2.start(time);
		} else {
			this.amMod.gain.setValueAtTime(1, time);
		}
		oscillator1.start(time);

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

	setVibratoDepth(linearAmount, time = 0, method = 'setValueAtTime') {
		this.vibratoDepthParam[method](linearAmount, time);
		this.vibratoDepth = linearAmount;
	}

	getVibratoDepth() {
		return this.vibratoDepth;
	}

	keyOn(context, velocity, time) {
		if (!this.keyIsOn && !this.disabled) {
			super.keyOn(context, velocity, time);
			if (this.oscillator1 && !this.envelope.reset && this.channel.oldStopTime > time) {
				this.stopOscillator(context.currentTime + NEVER);
			} else {
				this.newOscillator(context, this.envelope.beginAttack);
			}
		}
	}

	setWaveform(context, oscillatorConfig, time = context.currentTime + PROCESSING_TIME) {
		if (oscillatorConfig == undefined) {
			throw new Error('Parameters: setWaveform(context, oscillatorConfig, ?time');
		}
		this.oscillatorConfig = oscillatorConfig;
		this.channel.newOscillators(context, time);
	}

}
