
const PortamentoMode = Object.freeze({
	OFF: 			0,
	ON: 			1,
	FINGERED: 	2,
});

class MusicInput {

	constructor(numChannels) {
		this.minChannel = 0;
		this.maxChannel = 0;
		this.numChannels = numChannels;
		this.numChannelsInUse = 1;
		this.legato = false;
		this.portamento = PortamentoMode.OFF;
		// In the order they were pressed down
		this.keysDown = [];
		// The notes playing on each channel (or undefined if no note has been played yet)
		this.channelToNote = [undefined];
		// Channel index to (re)allocate first is at the start of the array
		this.allocationOrder = [0];
	}

	#indexToChannelNum(index) {
		return (this.minChannel + index) % this.numChannels + 1;
	}

	#removeAllocation(channelIndex) {
		this.allocationOrder.splice(this.allocationOrder.indexOf(channelIndex), 1);
	}

	setChannelRange(minChannel, maxChannel, numChannels = this.numChannels) {
		minChannel--;
		maxChannel--;
		this.minChannel = minChannel;
		this.maxChannel = maxChannel;
		this.numChannels = numChannels;
		this.keysDown = [];
		let numChannelsInUse;
		if (maxChannel >= minChannel) {
			numChannelsInUse = maxChannel - minChannel + 1;
		} else {
			numChannelsInUse = numChannels - maxChannel + minChannel + 1;
		}
		this.numChannelsInUse = numChannelsInUse;
		if (numChannelsInUse > 1) {
			this.legato = false;
		}
		this.channelToNote = new Array(numChannelsInUse);
		this.allocationOrder = new Array(numChannelsInUse);
		for (let i = 0; i < numChannelsInUse; i++) {
			this.allocationOrder[i] = i;
		}
	}

	keyDown(timeStamp, note, velocity) {
		const keyDownIndex = this.keysDown.indexOf(note);
		let channelIndex = -1;
		if (keyDownIndex !== -1) {
			this.keysDown.splice(keyDownIndex, 1);
			channelIndex = this.channelToNote.indexOf(note);
		}
		const numKeysDown = this.keysDown.length;
		if (channelIndex === -1) {
			channelIndex = this.allocationOrder.shift();
			if (numKeysDown > 0 && this.legato) {
				velocity = 0;
			}
		} else {
			this.#removeAllocation(channelIndex);
		}
		this.allocationOrder.push(channelIndex);
		let prevNote;
		if (
			this.portamento === PortamentoMode.ON ||
			(this.portamento === PortamentoMode.FINGERED && numKeysDown > 0)
		) {
			prevNote = this.channelToNote[channelIndex];
		}
		const channelNum = this.#indexToChannelNum(channelIndex);
		this.pitchChange(timeStamp, channelNum, prevNote, note, velocity);
		this.keysDown.push(note);
		this.channelToNote[channelIndex] = note;
	}

	keyUp(timeStamp, note) {
		const noteIndex = this.keysDown.indexOf(note);
		if (noteIndex === - 1) {
			return;
		}
		let numKeysDown = this.keysDown.length;
		const notesStolen = numKeysDown > this.numChannelsInUse;
		this.keysDown.splice(noteIndex, 1);
		numKeysDown--;
		const channelIndex = this.channelToNote.indexOf(note);
		if (channelIndex === -1) {
			return;
		}
		const channelNum  = this.#indexToChannelNum(channelIndex);
		if (notesStolen) {
			const newNote = this.keysDown[numKeysDown - this.numChannelsInUse];
			const fromNote = this.portamento === PortamentoMode.OFF ? undefined : note;
			this.pitchChange(timeStamp, channelNum, fromNote, newNote, 0);
			this.channelToNote[channelIndex] = newNote;
			this.#removeAllocation(channelIndex);
			this.allocationOrder.push(channelIndex);
		} else {
			this.noteOff(timeStamp, channelNum);
			this.#removeAllocation(channelIndex);
			const insertIndex = this.numChannelsInUse - numKeysDown - 1;
			this.allocationOrder.splice(insertIndex, 0, channelIndex);
		}
	}

	portamentoCC(enabled) {
		if (this.portamento !== PortamentoMode.FINGERED) {
			this.portamento = enabled ? PortamentoMode.ON : PortamentoMode.OFF;
		}
	}

	pitchChange(timeStamp, channelNum, fromNote, toNote, velocity) {
		// To be overridden.
	}

	noteOff(timeStamp, channelNum) {
		// To be overridden.
	}

}

export {MusicInput as default, PortamentoMode};
