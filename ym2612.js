import {PMSynth, CLOCK_RATE} from './opn2.js';

const LONG_REGISTER = Object.freeze({
	FREQUENCY: 0,		// 0-5
	CH3_FREQUENCY: 6,	// 6-8
});

const write = [];

export default class YM2612 {
	constructor(context, output = context.destination, clockRate = CLOCK_RATE.PAL) {
		const synth = new PMSynth(context, output, 6, clockRate);
		this.synth = synth;
		const channel = synth.getChannel(1);
		const highFrequencyByte = (channel.getFrequencyBlock() << 3) + (channel.getFrequencyNumber() >> 8);
		this.longRegisters = [
			highFrequencyByte, highFrequencyByte, highFrequencyByte, highFrequencyByte
		];
	}

	start(time) {
		this.synth.start(time);
	}

	stop(time) {
		this.synth.stop(time);
	}

	write(address, value, port = 0, time = 0) {
		write[address](this, value, time, port);
	}

}

write[0x22] = (chip, n, t) => chip.synth.setLFOFrequencyNumber(n, t);

write[0x27] = (chip, b, t) => {
	const channel3Mode = b >> 6;
	chip.synth.setChannel3Mode(channel3Mode, t);
}

write[0x28] = (chip, b, t) => {
	const channelNum = b & 7;
	const op1 = (b & 16) === 16;
	const op2 = (b & 32) === 32;
	const op3 = (b & 64) === 64;
	const op4 = (b & 128) === 128;
	chip.synth.getChannel(channelNum + 1).keyOnOff(op1, t, 127, op2, op3, op4);
}

function multiplyAndDetune(chip, port, relativeChannelNum, operatorNum, value, time) {
	const synth = chip.synth;
	const channelNum = port * 2 + relativeChannelNum;
	const multiple = value & 15;
	const detune = (value >> 4) & 7;
	const channel = synth.getChannel(channelNum);
	channel.getOperator(operatorNum).setDetune(detune, time);
	const immediate = channelNum !== 3 || synth.getChannel3Mode() === 0;
	channel.setFrequencyMultiple(operatorNum, multiple, immediate ? time : undefined);
}

write[0x30] = (chip, b, t, port) => multiplyAndDetune(chip, port, 1, 1, b, t);
write[0x31] = (chip, b, t, port) => multiplyAndDetune(chip, port, 2, 1, b, t);
write[0x32] = (chip, b, t, port) => multiplyAndDetune(chip, port, 3, 1, b, t);
write[0x34] = (chip, b, t, port) => multiplyAndDetune(chip, port, 1, 3, b, t);
write[0x35] = (chip, b, t, port) => multiplyAndDetune(chip, port, 2, 3, b, t);
write[0x36] = (chip, b, t, port) => multiplyAndDetune(chip, port, 3, 3, b, t);
write[0x38] = (chip, b, t, port) => multiplyAndDetune(chip, port, 1, 2, b, t);
write[0x39] = (chip, b, t, port) => multiplyAndDetune(chip, port, 2, 2, b, t);
write[0x3A] = (chip, b, t, port) => multiplyAndDetune(chip, port, 3, 2, b, t);
write[0x3C] = (chip, b, t, port) => multiplyAndDetune(chip, port, 1, 4, b, t);
write[0x3D] = (chip, b, t, port) => multiplyAndDetune(chip, port, 2, 4, b, t);
write[0x3E] = (chip, b, t, port) => multiplyAndDetune(chip, port, 3, 4, b, t);

// ...

function setFrequency(chip, port, relativeChannelNum, lowerByte, time) {
	const channelNum = port * 2 + relativeChannelNum;
	const upperByte = chip.longRegisters[LONG_REGISTER.FREQUENCY + channelNum - 1];
	const block = upperByte >> 3;
	const freqNum = ((upperByte & 7) << 8) + lowerByte;
	chip.synth.getChannel(channelNum).setFrequency(block, freqNum, time);
}

function setCh3Frequency(chip, operatorNum, lowerByte, time) {
	let index;
	if (operatorNum === 4) {
		index = LONG_REGISTER.FREQUENCY + 2;	// Channel 3 main register
	} else {
		index = LONG_REGISTER.CH3_FREQUENCY + operatorNum - 1; // Supplementary register
	}
	const upperByte = chip.longRegisters[index];
	const block = upperByte >> 3;
	const freqNum = ((upperByte & 7) << 8) + lowerByte;
	chip.synth.setChannel3Frequency(operatorNum, block ,freqNum, time);
}

write[0xA0] = (chip, b, t, port) => setFrequency(chip, port, 1, b, t);
write[0xA1] = (chip, b, t, port) => setFrequency(chip, port, 2, b, t);
write[0xA2] = (chip, b, t, port) => {
	if (port === 0) {
		setCh3Frequency(chip, 4, b, t);
	} else {
		setFrequency(chip, 1, 3, b, t);	// Channel 6
	}
}
write[0xA4] = (chip, b, t, port) => chip.longRegisters[LONG_REGISTER.FREQUENCY + port * 3] = b;
write[0xA5] = (chip, b, t, port) => chip.longRegisters[LONG_REGISTER.FREQUENCY + port * 3 + 1] = b;
write[0xA6] = (chip, b, t, port) => chip.longRegisters[LONG_REGISTER.FREQUENCY + port * 3 + 2] = b;
write[0xA8] = (chip, b, t) => setCh3Frequency(chip, 3, b, t);
write[0xA9] = (chip, b, t) => setCh3Frequency(chip, 1, b, t);
write[0xAA] = (chip, b, t) => setCh3Frequency(chip, 2, b, t);
write[0xAC] = (chip, b) => chip.longRegisters[LONG_REGISTER.CH3_FREQUENCY + 2] = b;
write[0xAD] = (chip, b) => chip.longRegisters[LONG_REGISTER.CH3_FREQUENCY] = b;
write[0xAE] = (chip, b) => chip.longRegisters[LONG_REGISTER.CH3_FREQUENCY + 1] = b;
