const PanController = Object.freeze({
	OFF: 0,
	NOTE: 1,
	VELOCITY: 2,
});

class MusicInput {

	constructor() {
		// Public fields
		// Changed by UI
		this.fingeredPortamento = false;
		this.legato = false;
		this.transpose = 0;
		// Changed by MIDI implementation
		this.portamentoSwitch = true;

		this.armedChannels = [1];
		this.sustain = false;

		// All notes in the follow fields are stored untransposed.
		this.sustainedNotes = new Set();
		// In the order they were pressed down, recorded non-transposed
		this.keysDown = [];
		// The notes playing on each channel (or undefined if no note has been played yet)
		this.channelToNote = [undefined];
		this.noteToChannel = new Map();
		// Channel index to (re)allocate first is at the start of the array
		this.allocationOrder = [0];

		this.panRange = 2;		// Can be negative to reverse direction
		this.minPanInput = 0;	// MIDI note or velocity. Must be less than or equal to max
		this.maxPanInput = 127;
		this.panMode = PanController.OFF;
		this.panPosition = undefined; // Current position
	}

	#removeAllocation(channelIndex) {
		this.allocationOrder.splice(this.allocationOrder.indexOf(channelIndex), 1);
	}

	armChannel(channelNum) {
		if (this.armedChannels.includes(channelNum)) {
			return;
		}
		this.armedChannels.push(channelNum);
		this.channelToNote.push(undefined);
		this.allocationOrder.unshift(this.channelToNote.length - 1);
	}

	disarmChannel(channelNum) {
		const channelIndex = this.armedChannels.indexOf(channelNum);
		if (channelIndex === -1) {
			return;
		}
		const note = this.channelToNote[channelIndex];
		if (this.noteToChannel.get(note) === channelIndex) {
			this.noteOff(performance.now(), channelNum);
			this.noteToChannel.delete(note);
		}
		this.armedChannels.splice(channelIndex, 1);
		this.channelToNote.splice(channelIndex, 1);
		const numChannelsArmed = this.armedChannels.length;
		this.#removeAllocation(numChannelsArmed);
		for (let i = 0; i < numChannelsArmed; i++) {
			if (this.allocationOrder[i] >= channelIndex) {
				this.allocationOrder[i]--;
			}
		}
	}

	solo(channelNum) {
		const channelIndex = this.armedChannels.indexOf(channelNum);
		const timeStamp = performance.now();
		for (let i = 0; i < this.channelToNote.length; i++) {
			if (i !== channelIndex) {
				const note = this.channelToNote[i];
				if (this.noteToChannel.get(note) === i) {
					this.noteOff(timeStamp, this.armedChannels[i]);
				}
			}
		}
		this.armedChannels = [channelNum];
		const note = this.channelToNote[channelIndex];
		this.channelToNote = [note];
		if (this.noteToChannel.get(note) === channelIndex) {
			this.keysDown = [note];
			this.noteToChannel.clear();
			this.noteToChannel.set(note, 0);
		} else {
			this.keysDown = [];
			this.noteToChannel.clear();
		}
		this.allocationOrder = [0];
	}

	keyDown(timeStamp, note, velocity) {
		const transposedNote = note + this.transpose;
		if (transposedNote < 0 || transposedNote > 127) {
			return;
		}
		const keyDownIndex = this.keysDown.indexOf(note);
		let channelIndex;
		if (keyDownIndex !== -1) {
			this.keysDown.splice(keyDownIndex, 1);
			channelIndex = this.noteToChannel.get(note);
		}
		const numChannelsArmed = this.armedChannels.length;
		const numKeysDown = this.keysDown.length;

		if (numKeysDown === 0) {
			switch (this.panMode) {
			case PanController.NOTE:
				this.panPosition = this.#inputToPanPosition(note);
				break;
			case PanController.VELOCITY:
				this.panPosition = this.#inputToPanPosition(velocity);
				break;
			}
		}
		const pan = this.panPosition;

		if (channelIndex === undefined) {
			channelIndex = this.allocationOrder.shift();
			if (numKeysDown > 0 && numChannelsArmed === 1 && this.legato) {
				velocity = 0;
			}
		} else {
			this.#removeAllocation(channelIndex);
		}
		const channelNum = this.armedChannels[channelIndex];
		let glide;
		if (this.fingeredPortamento) {
			glide = numKeysDown > 0;
		} else {
			glide = this.portamentoSwitch;
		}
		this.pitchChange(timeStamp / 1000, channelNum, transposedNote, velocity, glide, pan);

		if (numKeysDown >= numChannelsArmed) {
			this.noteToChannel.delete(this.channelToNote[channelIndex]);
		}
		this.keysDown.push(note);
		this.channelToNote[channelIndex] = note;
		this.noteToChannel.set(note, channelIndex);
		this.allocationOrder.push(channelIndex);
	}

	#inputToPanPosition(input) {
		const range = this.panRange;
		const minInput = this.minPanInput;
		const maxInput = this.maxPanInput;
		if (input <= minInput) {
			return -range / 2;
		} else if (input >= maxInput) {
			return range / 2;
		} else {
			return (input - minInput) / (maxInput - minInput) * range - range / 2;
		}
	}

	keyUp(timeStamp, note) {
		const noteIndex = this.keysDown.indexOf(note);
		if (noteIndex === - 1) {
			return;
		}
		if (this.sustain) {
			sustainedNotes.add(note);
			return;
		}
		let numKeysDown = this.keysDown.length;
		const numChannelsArmed = this.armedChannels.length;
		const notesStolen = numKeysDown > numChannelsArmed;
		this.keysDown.splice(noteIndex, 1);
		numKeysDown--;
		const channelIndex = this.noteToChannel.get(note);
		if (channelIndex === undefined) {
			return;
		}
		const channelNum  = this.armedChannels[channelIndex];
		timeStamp /= 1000;
		const newNote = this.keysDown[numKeysDown - numChannelsArmed];
		const transposedNewNote = newNote + this.transpose;
		if (notesStolen && transposedNewNote >= 0 && transposedNewNote <= 127) {
			const glide = this.portamentoSwitch || this.fingeredPortamento;
			this.pitchChange(timeStamp, channelNum, transposedNewNote, 0, glide, this.panPosition);
			this.channelToNote[channelIndex] = newNote;
			this.noteToChannel.set(newNote, channelIndex);
			this.#removeAllocation(channelIndex);
			this.allocationOrder.push(channelIndex);
		} else {
			this.noteOff(timeStamp, channelNum);
			this.#removeAllocation(channelIndex);
			const insertIndex = numChannelsArmed - numKeysDown - 1;
			this.allocationOrder.splice(insertIndex, 0, channelIndex);
		}
		this.noteToChannel.delete(note);
	}

	setPanMode(mode) {
		this.panMode = mode;
		this.panPosition = undefined;
	}

	debug(event, note) {
		let str = event + ' ' + note;
		str += ' Down: [' + this.keysDown + ']';
		str += ' Playing: [';
		for (let [note, channel] of this.noteToChannel.entries()) {
			str += note + '->' + channel + ', ';
		}
		str += ']';
		str += ' Pitches: [' + this.channelToNote + ']';
		str += ' Queue: [' + this.allocationOrder + ']';
		console.log(str);
	}

	sustainCC(timeStamp, enabled) {
		this.sustain = enabled;
		if (!enabled) {
			for (let note of sustainedNotes) {

			}
		}
	}

	pitchChange(timeStamp, channelNum, note, velocity, glide, pan) {
		// To be overridden.
	}

	noteOff(timeStamp, channelNum) {
		// To be overridden.
	}

	controlChange(timeStamp, controller, value) {
		// To be overridden
	}

}

export {PanController, MusicInput as default};
