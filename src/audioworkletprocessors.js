'use strict';

class NoiseProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: 'count',
				defaultValue: 16,
				minValue: 0,
				automationRate: 'k-rate',
			},
			{
				name: 'type',
				minValue: 0,
				maxValue: 1,
				automationRate: 'k-rate',
			}
		];
	}

	constructor() {
		super();
		this.counter = 0;
		this.tickRate = (3546893 / 16) / sampleRate;
		this.lfsr = 1;
		this.outputValue = 0;
		this.stopTime = Infinity;

		const me = this;
		this.port.onmessage = function (event) {
			const data = event.data;
			const type = data.type;
			switch (type) {
			case 'stop':
				me.stopTime = data.value;
				break;
			case 'setClockRate':
				me.tickRate = (data.value / 16) / sampleRate;
				break;
			}
		}
	}

	process(inputs, outputs, parameters) {
		const output = outputs[0][0];
		const tickRate = this.tickRate;
		const resetValue = Math.max(2 * parameters.count[0], tickRate);
		const periodicNoise = parameters.type[0] < 0.5;

		let counter = this.counter;
		let lfsr = this.lfsr;
		let outputValue = this.outputValue;
		let tap;

		for (let i = 0; i < 128; i++) {
			counter -= tickRate;
			if (counter <= 0) {
				outputValue = lfsr & 1;
				if (periodicNoise) {
					tap = outputValue;
				} else {
					tap = ((lfsr & 8) >> 3) ^ outputValue;
				}
				lfsr = (lfsr >>> 1) | (tap << 15);
				counter += resetValue;
			}
			output[i] = outputValue;
		}

		this.counter = counter;
		this.lfsr = lfsr;
		this.outputValue = outputValue;
		return currentTime < this.stopTime;
	}

}

registerProcessor('noise', NoiseProcessor);
