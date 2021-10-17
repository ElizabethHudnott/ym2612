
class FMOperator {
	constructor(context) {
		const sine = new OscillatorNode(context);
		this.sine = sine;

		const sineMod = new GainNode(context);
		this.sineModAdd = sineMod.gain;
		sine.connect(sineMod);

		const square1 = new OscillatorNode(context, {type: 'square'});
		this.square1 = square1;

		const sineModAmp = new GainNode(context, {gain: 0});
		this.sineModGain = sineModAmp.gain;
		square1.connect(sineModAmp);
		sineModAmp.connect(sineMod.gain);

		this.outputs = [sineMod];
	}

	start(time) {
		this.sine.start(time);
		this.square1.start(time);
	}

	connect(destination) {
		for (let node of this.outputs) {
			node.connect(destination);
		}
	}


	setWavetable(value, time = 0, method = 'setValueAtTime') {
		value %= 4;
		const intValue = Math.trunc(value);
		const fraction = value - intValue;

		let sineModAdd, sineModGain;

		switch (intValue) {
		case 0:
			sineModAdd = 1 - fraction;
			sineModGain = fraction;
			break;

		case 1:
			sineModAdd = 0;
			sineModGain = 1 - fraction;
			break;
		}
		this.sineModAdd[method](sineModAdd, time);
		this.sineModGain[method](sineModGain, time);
	}
}
