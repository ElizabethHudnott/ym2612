import {PMSynth, CLOCK_RATE} from './opn2.js';

const write = [];

export default class YM2612 {
	constructor(context, output = context.destination, clockRate = CLOCK_RATE.PAL) {
		this.synth = new PMSynth(context, output, 6, clockRate);
	}

	write(address, value, time = 0, port = 0) {
		write[address](this.synth, value, time, port);
	}
}

write[0x22] = (synth, n, t) => synth.setLFOFrequencyNumber(n, t);

write[0x27] = (synth, b, t) => {
	const channel3Mode = b >> 6;
	synth.setChannel3Mode(channel3Mode, t);
}

write[0x28] = (synth, b, t) => {
	const channelNum = b & 7;
	const op1 = (b & 16) === 16;
	const op2 = (b & 32) === 32;
	const op3 = (b & 64) === 64;
	const op4 = (b & 128) === 128;
	synth.getChannel(channelNum + 1).keyOnOff(op1, t, 127, op2, op3, op4);
}

function multiplyAndDetune(synth, port, relativeChannelNum, operatorNum, value, time) {
	const channelNum = port * 3 + relativeChannelNum;
	const multiple = value & 15;
	const detune = (value >> 4) & 7;
	const channel = synth.getChannel(channelNum);
	channel.getOperator(operatorNum).setDetune(detune, time);
	const immediate = channelNum !== 3 || synth.getChannel3Mode() === 0;
	channel.setFrequencyMultiple(operatorNum, multiple, immediate ? time : undefined);
}

write[0x30] = (synth, b, t, port) => multiplyAndDetune(synth, port, 1, 1, b, t);
write[0x31] = (synth, b, t, port) => multiplyAndDetune(synth, port, 2, 1, b, t);
write[0x32] = (synth, b, t, port) => multiplyAndDetune(synth, port, 3, 1, b, t);
write[0x34] = (synth, b, t, port) => multiplyAndDetune(synth, port, 1, 3, b, t);
write[0x35] = (synth, b, t, port) => multiplyAndDetune(synth, port, 2, 3, b, t);
write[0x36] = (synth, b, t, port) => multiplyAndDetune(synth, port, 3, 3, b, t);
write[0x38] = (synth, b, t, port) => multiplyAndDetune(synth, port, 1, 2, b, t);
write[0x39] = (synth, b, t, port) => multiplyAndDetune(synth, port, 2, 2, b, t);
write[0x3A] = (synth, b, t, port) => multiplyAndDetune(synth, port, 3, 2, b, t);
write[0x3C] = (synth, b, t, port) => multiplyAndDetune(synth, port, 1, 4, b, t);
write[0x3D] = (synth, b, t, port) => multiplyAndDetune(synth, port, 2, 4, b, t);
write[0x3E] = (synth, b, t, port) => multiplyAndDetune(synth, port, 3, 4, b, t);
