import {PROCESSING_TIME} from './common.js';

class Cell {
	static EMPTY = Object.freeze(new Cell());

	constructor() {
		// Delay in ticks
		this.delay = 0;
		// MIDI note number or undefined for no change in pitch
		this.note = undefined;
		// 0 indicates a rest, 1-127 triggers a note with the specified velocity,
		// undefined = no action
		this.velocity = undefined;
		// Instrument number or undefined for no change of instrument
		this.instrument = undefined;
		// Effect command objects
		this.effects = [];
	}

	clone(deep) {
		const newCell = new Cell();
		newCell.delay = this.delay;
		newCell.note = this.note;
		newCell.velocity = this.velocity;
		newCell.instrument = this.instrument;
		const numEffects = this.effects.length;
		if (deep) {
			const effects = new Array(numEffects);
			for (let i = 0; i < numEffects; i++) {
				effects[i] = this.effects[i].clone();
			}
			newCell.effects = effects;
		} else {
			newCell.effects = this.effects;
		}
		return newCell;
	}
}

class Phrase {
	static nameCounter = 1;

	constructor(name, length = 64, beatLength = 4, barLength = 16) {
		const cells = new Array(length);
		for (let i = 0; i < length; i++) {
			cells[i] = new Cell();
		}
		this.cells = cells;
		this.name = name;
		this.beatLength = beatLength;
		this.barLength = barLength;
	}

	get length() {
		return this.cells.length;
	}

	static fromCells(name, cells) {
		const phrase = new Phrase(name, 0);
		phrase.cells = cells;
	}

}

class Transform {

	static IDENTITY = Object.freeze(new Transform());

	constructor() {
		this.offset = 0;	// starting offset. negative values create empty cells
		this.loop = false;
		this.loopStart = 0;
		this.intensity = 1;	// multiplier
		this.accent = 1;		// between 0 (no velocity variation) and 1 (maximum/normal)
		this.initialInstrument = 0;	// 0 = don't change instrument
		this.step = 1	// default to forward direction, one cell at a time
	}

	apply(phrase, length = 64) {
		let position = this.offset;
		const phraseLength = phrase.length;
		const step = this.step;
		const loopStart = this.loopStart;
		const loopLength = step >= 0 ? phraseLength - loopStart : loopStart + 1;
		const intensity = this.intensity;
		const accent = this.accent;

		const outputCells = new Array(length);
		let firstNote = true;
		for (let i = 0; i < length; i++) {

			if (this.loop) {
				if (step >= 0) {
					if (position >= phraseLength) {
						position = (position - loopStart) % loopLength + loopStart;
					}
				} else if (position < 0) {
					position = loopStart - (loopStart - position) % loopLength;
				}
			}

			if (position < 0 || position >= phraseLength) {
				outputCells[i] = Cell.EMPTY;
				continue;
			}

			let cell = phrase.cells[position];

			if (
				(cell.velocity > 0 && (intensity !== 1 || accent < 1)) ||
				(firstNote && this.initialInstrument !== 0)
			) {
				cell = cell.clone(false);
				if (cell.velocity > 0) {
					const velocity = intensity * cell.velocity * accent + intensity * (1 - accent);
					cell.velocity = Math.min(velocity, 127);
					if (firstNote) {
						cell.instrument = this.initialInstrument;
						firstNote = false;
					}
				}
			}

			outputCells[i] = cell;
			position += step;
		}

		return outputCells;
	}

}

class TrackState {

	constructor(ticksPerRow = 6) {
		this.ticksPerRow = 6;
		this.articulation = 0.5;
	}

}

class Player {

	constructor(context, synth, rowsPerMinute = 240, ticksPerRow = 6, groove = [1]) {
		this.context = context;
		this.synth = synth;
		const numChannels = synth.numberOfChannels;
		this.trackState = new Array(numChannels);
		for (let i = 0; i < numChannels; i++) {
			this.trackState[i] = new TrackState(ticksPerRow);
		}
		this.setTempo(rowsPerMinute);
		this.groove = groove;
	}

	setTempo(rowsPerMinute) {
		this.rowsPerMinute = rowsPerMinute;
		this.rowTime = 60 / rowsPerMinute;
	}

}

class Pattern {
	static nameCounter = 1;

	constructor(name, length = 64) {
		this.name = name;
		this.length = length;
		this.phrases = [];
		this.transforms = [];
		this.cachedCells = [];
		this.groove = undefined;
	}

	addTrack(phrase, transform = Transform.IDENTITY) {
		this.phrases.push(phrase);
		this.transforms.push(transform);
		this.cachedCells.push(transform.apply(phrase, this.length));
	}

	play(player, time = player.context.currentTime + PROCESSING_TIME) {
		const context = player.context;
		const numTracks = this.phrases.length;
		const numRows = this.length;
		if (this.groove !== undefined) {
			player.groove = this.groove;
		}
		const groove = player.groove;
		const grooveLength = groove.length;
		for (let i = 0; i < numTracks; i++) {
			if (this.cachedCells[i] === undefined) {
				this.cachedCells[i] = this.transforms[i].apply(this.phrases[i], numRows);
			}
		}

		for (let rowNum = 0; rowNum < numRows; rowNum++) {
			const basicRowDuration = player.rowTime;
			const rowDuration = basicRowDuration * groove[rowNum % grooveLength];
			for (let trackNum = 0; trackNum < numTracks; trackNum++) {
				const channel = synth.getChannel(trackNum + 1);
				const cells = this.cachedCells[trackNum];
				const cell = cells[rowNum];
				const trackState = player.trackState[trackNum];
				let numTicks = trackState.ticksPerRow;
				let tick = cell.delay;
				if (tick >= numTicks) {
					continue;
				}
				const onset = time + tick / numTicks * rowDuration;

				if (cell.note !== undefined) {
					channel.setMIDINote(cell.note, onset);
				}

				if (cell.velocity > 0) {
					channel.keyOn(context, cell.velocity, onset);
					let duration = rowDuration * (numTicks - tick) / numTicks;
					duration += Pattern.findExtendedNoteDuration(
						basicRowDuration, numTicks, groove, cells, rowNum
					);
					duration *= trackState.articulation;
					channel.keyOff(context, onset + duration);
				}

				for (let effect of cell.effects) {
					effect.apply(channel, onset);
				}

			}
			time += rowDuration;
		}
	}

	static findExtendedNoteDuration(basicRowDuration, numTicks, groove, cells, rowNum) {
		rowNum++;
		const numRows = cells.length;
		const grooveLength = groove.length;
		let duration = 0;
		let cell = cells[rowNum];
		while (rowNum < numRows && cell.velocity === undefined) {
			duration += basicRowDuration * groove[rowNum % grooveLength];
			rowNum++;
			cell = cells[rowNum];
		}
		if (cell !== undefined) {
			const lastRowDuration = basicRowDuration * groove[rowNum % grooveLength];
			const extraTicks = Math.min(cell.delay, numTicks);
			duration += basicRowDuration * extraTicks / numTicks;
		}
		return duration;
	}
}

export {Phrase, Transform, Pattern, Player};
