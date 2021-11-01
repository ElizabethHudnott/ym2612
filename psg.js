import {decibelsToAmplitude} from './opn2.js';

const AMPLITUDES = new Array(16);
for (let i = 0; i < 16; i++) {
	AMPLITUDES[i] = 1 - decibelsToAmplitude(i * 2);
}

const CLOCK_RATE = {
	PAL: 	3546893,
	NTSC: 	3579545
}

let supportsCancelAndHold;

class PSGChannel {
	constructor(context, lfo, output) {

	}

	start(time) {

	}

	stop(time) {

	}

}

class PSG {

	constructor(context, output = context.destination, numWaveChannels = 3, clockRate = CLOCK_RATE.PAL) {
		const frequencies = new Array(1024);
		this.frequencies = frequencies;
		frequencies[0] = 0;
		const nyquist = context.sampleRate / 2;
		for (let i = 1; i < 1024; i++) {
			let frequency = clockRate / (i * 32);
			if (frequency > nyquist) {
				frequency = 0;
			}
			frequencies[i] = frequency;
		}
		this.noteFrequencies = this.tunedMIDINotes(440);

		const lfo = new OscillatorNode(context, {frequency: 0, type: 'triangle'});
		this.lfo = lfo;
		supportsCancelAndHold = lfo.frequency.cancelAndHoldAtTime !== undefined;

		const channelGain = new GainNode(context, {gain: 1 / numWaveChannels});
		channelGain.connect(context.destination);
		const channels = [];
		for (let i = 0; i < numWaveChannels; i++) {
			const channel = new PSGChannel(context, lfo, channelGain);
			channels[i + 1] = channel;
		}
		this.channels = channels;

	}

	start(time) {
		this.lfo.start(time);
		for (let channel of this.channels) {
			channel.start(time);
		}
	}

	stop(time = 0) {
		this.lfo.stop(time);
		for (let channel of this.channels) {
			channel.stop(time);
		}
	}

	setLFOFrequency(frequency, time = 0, method = 'setValueAtTime') {
		this.lfo.frequency[method](frequency, time);
	}

	getLFOFrequency() {
		return this.lfo.frequency.value;
	}

	tunedMIDINotes(a4Pitch) {
		const frequencyNums = new Array(128);
		let freqNum = 1;
		while (this.frequencies[freqNum] === 0) {
			freqNum++;
		}
		for (let i = 127; i >= 0; i--) {
			const frequency = a4Pitch * (2 ** ((i - 69) / 12));
			let upperFreqNum = freqNum;
			let upperFrequency;
			do {
				upperFreqNum++;
				upperFrequency = this.frequencies[upperFreqNum];
			} while (upperFrequency >= frequency && upperFreqNum < 1022);
			upperFreqNum = Math.min(upperFreqNum - 1, 1022);
			upperFrequency = this.frequencies[upperFreqNum];
			const upperFreqDiff = upperFrequency - frequency;
			const lowerFrequency = this.frequencies[upperFreqNum + 1];
			const lowerFreqDiff = frequency - lowerFrequency;
			freqNum = upperFreqDiff < lowerFreqDiff ? upperFreqNum : upperFreqNum + 1;
			frequencyNums[i] = freqNum;
		}
		return frequencyNums;
	}

	frequencyNumToNote(frequencyNum) {
		let lb = 0;
		let ub = 127;
		while (lb < ub) {
			let mid = Math.trunc((lb + ub) / 2);
			const noteFreqNum = this.noteFrequencies[mid];
			if (frequencyNum < noteFreqNum) {
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
	PSGChannel, PSG,
}
