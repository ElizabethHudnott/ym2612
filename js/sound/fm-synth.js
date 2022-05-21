import {
	logToLinear, outputLevelToGain,
	PROCESSING_TIME, ClockRate,
} from './common.js';
import Channel from './fm-channel.js';
import TwoOperatorChannel from './two-op-channel.js';

export default class Synth {

	static keyCode(blockNumber, frequencyNumber) {
		const f11 = frequencyNumber >= 1024;
		const lsb = frequencyNumber >= 1152 || (!f11 && frequencyNumber >= 896);
		return (blockNumber << 2) + (f11 << 1) + lsb;
	}

	constructor(context, output = context.destination, numChannels = 6, clockRate = ClockRate.PAL) {
		// Tuning data
		this.referencePitch = 220;
		this.referenceNote = 69;
		this.feedbackCallibration = 2.5;
		this.setClockRate(clockRate);

		const channelGain = new GainNode(context, {gain: 1 / numChannels});
		channelGain.connect(output);
		this.channelGain = channelGain.gain;

		const dbCurve = new Float32Array(2047);
		dbCurve.fill(0, 0, 1024);
		for (let i = 1024; i < 2047; i++) {
			dbCurve[i] = logToLinear(i - 1023);
		}

		// Used by the operators to remove the DC offset inherent in certain wave shapes.
		this.dcOffset = new ConstantSourceNode(context);

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
		this.pcmLevel = 0;
	}

	enablePCMRegister(context) {
		const dacRegister = new ConstantSourceNode(context, {offset: 0});
		dacRegister.connect(this.pcmAmp);
		dacRegister.start();
		this.dacRegister = dacRegister;
	}

	/**Configures internal timings, etc. to match the real chip's behaviour in different
	 * settings such as PAL versus NTSC game consoles.
	 */
	setClockRate(clockRate) {
		this.envelopeTick = 72 * 6 / clockRate;
		this.lfoRateMultiplier = clockRate / 8000000;
		this.frequencyStep = clockRate / (144 * 2 ** 20);
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
	 * @param {number} pcmLevel The output level of the PCM channel. Values in the range 1..99
	 * (or -99..-1) will fade down the volume of the highest numbered FM channel to make space
	 * in the mix for the PCM content. Values greater than 99 (or less than -99) will
	 * additionally reduce the volume of the other FM channels as well as silencing the last
	 * one. PCM volume values up to 141 can be used for a six channel synth.
	 */
	mixPCM(pcmLevel, time = 0, method = 'setValueAtTime') {
		const numChannels = this.channels.length;
		const pcmGain = Math.min(outputLevelToGain(Math.abs(pcmLevel)), numChannels);

		let lastChannelGain, otherChannelsGain;
		if (pcmGain <= 1) {
			lastChannelGain = 1 - pcmGain;
			otherChannelsGain = 1;
		} else {
			lastChannelGain = 0;
			otherChannelsGain = 1 - (pcmGain - 1) / (numChannels - 1);
		}

		let channel = this.channels[numChannels - 1];
		lastChannelGain *= outputLevelToGain(channel.outputLevel);
		channel.setGain(lastChannelGain, time, method);

		for (let i = 0; i < numChannels - 1; i++) {
			const channel = this.channels[i];
			const gain = otherChannelsGain * outputLevelToGain(channel.outputLevel);
			channel.setGain(gain, time, method);
		}
		this.pcmAmp.gain[method](Math.sign(pcmLevel) * pcmGain, time);
		this.pcmLevel = pcmLevel
	}

	getPCMMix() {
		return this.pcmLevel;
	}

	writePCM(value, time) {
		const floatValue = (value - 128) / 128;
		this.dacRegister.offset.setValueAtTime(floatValue, time);
	}

	setLFORate(context, frequency, time = context.currentTime + PROCESSING_TIME, method = 'setValueAtTime') {
		for (let i = 0; i < this.channels.length; i++) {
			const channel = this.channels[i];
			if (!channel.getLFOKeySync()) {
				channel.setLFORate(context, frequency, time, method);
			}
		}
	}

	disableLFOKeySync(context, frequency = this.channels[0].getLFORate(), time = context.currentTime + PROCESSING_TIME) {
		const numChannels = this.channels.length;
		for (let i = 0; i < numChannels; i++) {
			const channel = this.channels[i];
			channel.setLFORate(context, 0, time);	// Destroy current LFO
			channel.setLFOKeySync(context, false, time);
		}
		if (frequency !== 0) {
			for (let i = 0; i < numChannels; i++) {
				this.channels[i].setLFORate(context, frequency, time);
			}
		}
	}

	setChannelGain(level, time = 0, method = 'setValueAtTime') {
		this.channelGain[method](level / this.channels.length, time);
	}

	/**
	 * @param {number} frequency The pitch to tune the reference note to, in Hertz.
	 * @param {number} noteNumber The MIDI note number that gets tuned to the specified
	 * frequency, usually 69 (A4).
	 */
	setReferencePitch(frequency, noteNumber = 69) {
		this.referencePitch = frequency / 2;	// Account for high modulation index.
		this.referenceNote = noteNumber;
	}

	getTuning(detune = 0, interval = 2, divisions = 12, steps = [1]) {
		const referencePitch = this.referencePitch;
		const referenceNote = this.referenceNote;
		const frequencyData = new Array(128);
		const numIntervals = steps.length;
		let noteNumber = 60;
		let stepIndex = 0;
		for (let i = 60; i < 128; i++) {
			const frequency = referencePitch *
				(interval ** ((noteNumber - referenceNote + detune / 100) / divisions));
			frequencyData[i] = frequency / this.frequencyStep;
			noteNumber  += steps[stepIndex];
			stepIndex = (stepIndex + 1) % numIntervals;
		}
		noteNumber = 60;
		stepIndex = numIntervals - 1;
		for (let i = 59; i >= 0; i--) {
			noteNumber -= steps[stepIndex];
			const frequency = referencePitch *
				(interval ** ((noteNumber - referenceNote + detune / 100) / divisions));
			frequencyData[i] = frequency / this.frequencyStep;
			stepIndex--;
			if (stepIndex < 0) {
				stepIndex = numIntervals - 1;
			}
		}

		// Adjustment to spread the key codes evenly
		let blocks = [], freqNums = [], keyCodes = [];
		const numInstances = new Array(32);
		numInstances.fill(0);
		for (let i = 0; i < 128; i++) {
			let block;
			let freqNum = frequencyData[i];
			if (freqNum < 1023.5) {
				block = 0;
				freqNum = Math.round(freqNum) * 2;
			} else {
				block = 1;
				while (freqNum >= 2047.5) {
					freqNum /= 2;
					block++;
				}
				if (block > 7) {
					break;
				}
				freqNum = Math.round(freqNum);
			}
			blocks[i] = block;
			freqNums[i] = freqNum;
			const keyCode = Synth.keyCode(block, freqNums[i]);
			keyCodes[i] = keyCode;
			numInstances[keyCode]++;
		}
		let minIndex = 0;
		while (frequencyData[minIndex + 1] <= 13.75 && keyCodes[minIndex] === 0) {
			numInstances[0]--;
			minIndex++;
		}
		let maxIndex = blocks.length - 1;
		const standardC7 = 440 * (2 ** (27 / 12)) / this.frequencyStep; // effectively C8
		while (frequencyData[maxIndex - 1] >= standardC7 && keyCodes[maxIndex] === 31) {
			numInstances[31]--;
			maxIndex--;
		}
		blocks = blocks.slice(minIndex, maxIndex + 1);
		freqNums = freqNums.slice(minIndex, maxIndex + 1);
		keyCodes = keyCodes.slice(minIndex, maxIndex + 1);

		let freqNumThreshold = 2048;
		let variance, newVariance = Infinity;
		let thresholdHistory = [2048, 2048];
		let changes;
		do {
			variance = newVariance;
			let minKeyCode = keyCodes[0];
			let maxKeyCode = keyCodes[keyCodes.length - 1];
			let sum = 0;
			let sumSquares = 0;
			for (let i = minKeyCode; i <= maxKeyCode; i++) {
				const count = numInstances[i];
				sum += count;
				sumSquares += count * count;
			}
			const keyCodeRange = maxKeyCode - minKeyCode + 1;
			const mean = sum / keyCodeRange;
			newVariance = sumSquares / keyCodeRange - mean * mean;

			let newFreqNumThreshold = 0;
			for (let freqNum of freqNums) {
				if (freqNum < freqNumThreshold) {
					newFreqNumThreshold = Math.max(newFreqNumThreshold, freqNum);
				}
			}
			thresholdHistory[0] = thresholdHistory[1];
			thresholdHistory[1] = freqNumThreshold;
			freqNumThreshold = newFreqNumThreshold;

			changes = false;
			for (let i = 0; i < freqNums.length; i++) {
				if (freqNums[i] === freqNumThreshold && blocks[i] !== 7) {
					blocks[i]++;
					freqNums[i] = Math.round(freqNums[i] / 2);
					const oldKeyCode = keyCodes[i];
					const keyCode = Synth.keyCode(blocks[i], freqNums[i]);
					keyCodes[i] = keyCode;
					numInstances[oldKeyCode]--;
					numInstances[keyCode]++;
					changes = true;
				}
			}

		} while (newVariance < variance || !changes);
		return {
			octaveThreshold: 	thresholdHistory[0] - 0.5,
			freqBlockNumbers: blocks,
			frequencyNumbers: freqNums,
		};
	}

}
