/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
export default class MusicInput {

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
		this.pitchChange(timeStamp / 1000, channelNum, transposedNote, velocity, glide);

		if (numKeysDown >= numChannelsArmed) {
			this.noteToChannel.delete(this.channelToNote[channelIndex]);
		}
		this.keysDown.push(note);
		this.channelToNote[channelIndex] = note;
		this.noteToChannel.set(note, channelIndex);
		this.allocationOrder.push(channelIndex);
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
			this.pitchChange(timeStamp, channelNum, transposedNewNote, 0, glide);
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

	pitchChange(timeStamp, channelNum, note, velocity, glide) {
		// To be overridden.
	}

	noteOff(timeStamp, channelNum) {
		// To be overridden.
	}

	controlChange(timeStamp, controller, value) {
		// To be overridden
	}

}
