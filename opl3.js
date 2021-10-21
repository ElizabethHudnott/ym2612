const expTable = new Array(1024);
for (let i = 0; i <= 255; i++) {
	const exp = -(2 ** (1 - i / 256) - 1);
	expTable[512 + i] = exp;
}
for (let i = 0; i <= 255; i++) {
	expTable[256 + i] = -expTable[767 - i];
}
expTable.fill(0, 0, 256);
expTable.fill(0, 768);

export class FMOperator {
	constructor(context, unmodulated) {
		const frequencyAdd = new ConstantSourceNode(context, {offset: 440});
		frequencyAdd.start();
		this.frequencyAdd = frequencyAdd.offset;
		const frequencyMultiplier = new GainNode(context);
		this.frequencyMultiplier = frequencyMultiplier.gain;
		frequencyAdd.connect(frequencyMultiplier);
		const cutFrequencyMultiplier = new GainNode(context);
		frequencyAdd.connect(cutFrequencyMultiplier);

		const sine = new OscillatorNode(context, {frequency: 0});
		frequencyMultiplier.connect(sine.frequency);

		const sineMod = new GainNode(context);
		sine.connect(sineMod);

		const square1 = new OscillatorNode(context, {type: 'square', frequency: 0});
		frequencyMultiplier.connect(square1.frequency);

		const sineModAmp = new GainNode(context, {gain: 0});
		square1.connect(sineModAmp);
		sineModAmp.connect(sineMod.gain);
		const squareAmp = new GainNode(context, {gain: 0});
		square1.connect(squareAmp);

		const saw = new OscillatorNode(context, {type: 'sawtooth', frquency: 0});
		frequencyMultiplier.connect(saw.frequency);
		const shaper = new WaveShaperNode(context, {curve: expTable});
		saw.connect(shaper);
		const shaperAmp = new GainNode(context, {gain: 0});
		shaper.connect(shaperAmp);

		const square2 = new OscillatorNode(context, {type: 'square', frequency: 0});
		cutFrequencyMultiplier.connect(square2.frequency);
		//...

		this.oscillators = [sine, square1, saw, square2];
		this.wavetableGains = [sineMod.gain, sineModAmp.gain, shaperAmp.gain, squareAmp.gain];
		this.outputs = [sineMod, shaperAmp, squareAmp];

		this.wave = 0;
	}

	start(time) {
		for (let oscillator of this.oscillators) {
			oscillator.start(time);
		}
	}

	connect(destination) {
		for (let node of this.outputs) {
			node.connect(destination);
		}
	}


	setWave(value, time = 0, method = 'setValueAtTime') {
		const gains = this.wavetableGains;
		const numGains = gains.length;

		value %= numGains;
		const intValue = Math.trunc(value);
		const fraction = value - intValue;

		const oldWave = this.wave;
		const oldInt = Math.trunc(oldWave);
		const oldFraction = oldWave - oldInt;

		gains[intValue][method](1 - fraction, time);
		const index2 = (intValue + 1) % numGains;
		gains[index2][method](fraction, time);

		if (oldInt !== intValue && oldInt !== index2) {
			gains[oldInt][method](0, time);
		}
		const index4 = (oldInt + 1) % numGains;
		if (index4 !== intValue && index4 !== index2) {
			gains[index4][method](0, time);
		}

		this.wave = value;
	}
}
