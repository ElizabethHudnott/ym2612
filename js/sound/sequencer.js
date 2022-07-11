import {PROCESSING_TIME, VIBRATO_PRESETS} from './common.js';
import {EffectNumbers, Effects} from './effect-commands.js';

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
		this.effects = new Map();
	}

	clone(deep) {
		const newCell = new Cell();
		newCell.delay = this.delay;
		newCell.note = this.note;
		newCell.velocity = this.velocity;
		newCell.instrument = this.instrument;
		if (deep) {
			const effects = new Map();
			for (let [number, params] of this.effects.entries()) {
				effects.set(number, params.clone());
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
		/* Starting offset. Negative values create empty cells for tracks to come in later.
		 * Positive values permit reusing the tail end of a phrase. */
		this.offset = 0;
		this.loop = false;
		this.loopStart = 0;
		this.intensity = 1;	// velocity multiplier
		this.accent = 1;		// between 0 (no velocity variation) and 1 (maximum/normal)
		this.initialInstrument = 0;	// 0 = don't change instrument
		this.step = 1	// default to forward direction, one cell at a time
		this.stretch = 1	// higher values insert blank rows between source rows
	}

	apply(phrase, length = 64) {
		const phraseLength = phrase.length;
		const step = this.step;
		const loopStart = this.loopStart;
		const loopLength = step >= 0 ? phraseLength - loopStart : loopStart + 1;
		const intensity = this.intensity;
		const accent = this.accent;
		let position = this.offset;
		if (step < 0) {
			position = phraseLength - 1 - position;
		}

		const outputCells = new Array(length);
		let firstNote = true;
		let inputStepsTaken = -1;	// incremented before use

		const transformsVelocity = intensity !== 1 || accent < 1;

		for (let outputRowNum = 0; outputRowNum < length; outputRowNum++) {

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
				outputCells[outputRowNum] = Cell.EMPTY;
				continue;
			}

			inputStepsTaken++;
			if (inputStepsTaken % this.stretch !== 0) {
				outputCells[outputRowNum] = Cell.EMPTY;
				continue;
			}

			let cell = phrase.cells[position];
			const velocity = cell.velocity;
			const delayChange = step < 0 && cell.delay !== 0;
			const instrumentChange = velocity > 0 && firstNote && this.initialInstrument !== 0;

			if (
				delayChange || instrumentChange ||
				(velocity > 0 && transformsVelocity)
			) {
				cell = cell.clone(false);
				if (step < 0) {
					cell.delay = -cell.delay;
				}
				if (velocity > 0) {
					const scaledVelocity = intensity * velocity * accent + intensity * (1 - accent);
					cell.velocity = Math.min(scaledVelocity, 127);
					if (firstNote) {
						cell.instrument = this.initialInstrument;
						firstNote = false;
					}
				}
			}

			outputCells[outputRowNum] = cell;
			position += step;
		}

		return outputCells;
	}

}

class TrackState {

	constructor(ticksPerRow = 6) {
		this.ticksPerRow = ticksPerRow;
		// Number of ticks the current note has already played for because it started on a
		// previous row.
		this.carriedTicks = 0;
		this.gateLengthPresets = [0.25, 0.5, 0.75];
		this.gateLength = 0.5;
		this.vibrato = VIBRATO_PRESETS[1];
		this.tremolo = 7.5;
		this.prevVelocity = 127;	// For retriggering
		this.newRow();
	}

	newRow() {
		this.glide = false;
	}

	newPattern(ticksPerRow) {
		this.ticksPerRow = ticksPerRow;
	}

}

class Player {

	constructor(context, synth, rowsPerMinute = 240, ticksPerRow = 6, groove = [1]) {
		this.context = context;
		this.synth = synth;
		this.trackState = new Array(synth.numberOfChannels);
		this.initialRowsPerMin = rowsPerMinute;
		this.initialTicksPerRow = ticksPerRow;
		this.initialGroove = groove;
		this.reset();
	}

	newPattern() {
		for (let state of this.trackState) {
			state.newPattern(this.initialTicksPerRow);
		}
	}

	reset() {
		const trackStates = this.trackState;
		for (let i = 0; i < trackStates.length; i++) {
			trackStates[i] = new TrackState(this.initialTicksPerRow);
		}
		this.setTempo(this.initialRowsPerMin);
		this.groove = this.initialGroove;
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

	invalidateCache(trackNum) {
		this.cachedCells[trackNum] = undefined;
	}

	play(player, time = player.context.currentTime + PROCESSING_TIME) {
		const context = player.context;
		const numTracks = this.phrases.length;
		const numRows = this.length;
		player.newPattern();
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

		let basicRowDuration = player.rowTime;
		let prevRowDuration = basicRowDuration * groove[grooveLength - 1];
		for (let rowNum = 0; rowNum < numRows; rowNum++) {
			const rowDuration = basicRowDuration * groove[rowNum % grooveLength];
			for (let trackNum = 0; trackNum < numTracks; trackNum++) {
				const channel = synth.getChannel(trackNum + 1);
				const cells = this.cachedCells[trackNum];
				const cell = cells[rowNum];
				const trackState = player.trackState[trackNum];
				trackState.newRow();
				let numTicks = cell.effects.get(EffectNumbers.TICKS_PER_ROW)?.ticks;
				if (numTicks !== undefined) {
					trackState.ticksPerRow = numTicks;
				}

				numTicks = trackState.ticksPerRow;
				const startTick = cell.delay;
				let onset = time;
				// These two record the actual length of the row, after adjustments to account for
				// delays.
				let duration = rowDuration;
				let numRowTicks = numTicks;

				if (startTick >= 0) {
					if (startTick >= numTicks) {
						continue;
					}
					onset += startTick / numTicks * rowDuration;
					duration *= (numTicks - startTick) / numTicks;
				} else if (rowNum === 0) {
					startTick = 0;	// First row can't have a negative delay
				} else {
					if (startTick <= -numTicks) {
						continue;
					}
					/* Negative delays
					 * The fraction numberedTick / totalTicks is based on the number of ticks per
					 * row as it applies to the current row (before modification caused by delays).
					 * BUT the time that we apply that fraction to is the duration of the PREVIOUS
					 * row (ignoring delays but including groove and tempo).
					 */
					const timeExtension = -startTick / numTicks * prevRowDuration;
					duration += timeExtension;
					onset -= timeExtension;
				}

				/* Negative delays: Naively adding time and ticks based on time borrowed from the
				 * previous row will give weird results if a tick based effect is used when the
				 * rows initially had different amounts of time allocated to them (because of
				 * groove or a tempo change). Division into ticks of uniform duration will make the
				 * ticks occur out of sync with those happening on other tracks which have the same
				 * number of ticks per row. But that's an acceptable limitation.
				 */
				numRowTicks -= startTick;

				const nextCell = cells[rowNum + 1];
				if (nextCell?.delay < 0) {
					const ticksDeductedAfter = -nextCell.delay;
					duration -= rowDuration * Math.min(ticksDeductedAfter, numTicks) / numTicks;
					numRowTicks -= ticksDeductedAfter;
				}

				let velocity = cell.velocity;
				let gateLength;
				const retrigger = cell.effects.get(EffectNumbers.RETRIGGER);

				if (retrigger === undefined) {

					// No retriggering

					if (cell.note !== undefined) {
						channel.setMIDINote(cell.note, onset, trackState.glide);
					}

					for (let effect of cell.effects.values()) {
						effect.apply(trackState, channel, onset);
					}
					gateLength = trackState.gateLength;

					if (velocity > 0) {
						channel.keyOn(context, velocity, onset);
						duration = Pattern.findNoteDuration(
							duration, basicRowDuration, numTicks, groove, cells, rowNum, gateLength
						);
						channel.keyOff(context, onset + duration);
						trackState.prevVelocity = velocity;
					}
					trackState.carriedTicks = 0;
					continue;
				}

				// Retriggering scenario

				if (velocity === undefined) {
					velocity = trackState.prevVelocity;
				}

				let tick = 0;
				let tickTime = onset;
				if (trackState.carriedTicks > 0) {
					/* There's a design choice to be made here about how a positive delay interacts
					 * with retriggering, whether or not the delayed ticks count towards completing
					 * a note that was already in progress, whether a note is prolonged or a rest is
					 * inserted. I chose to prolong the retriggered note.
					 */
					tick = retrigger.ticks - trackState.carriedTicks;
					if (tick > numRowTicks) {
						if (nextCell?.effects.has(EffectNumbers.RETRIGGER)) {
							// Permit retriggering less than once per row.
							trackState.carriedTicks += numRowTicks;
							trackState.carriedTime += duration;

							if (cell.note !== undefined) {
								channel.setMIDINote(cell.note, onset, trackState.glide);
							}

							for (let effect of cell.effects.values()) {
								effect.apply(trackState, channel, onset);
							}

							continue;	// Process next track
						} else {
							tick = numRowTicks;
						}
					}
					const carriedTime = trackState.carriedTime;
					const offTime = onset - carriedTime +
						(carriedTime + duration * tick / numRowTicks) * trackState.gateLength;
					channel.keyOff(context, offTime);

					tickTime = onset + duration * tick / numRowTicks;
					trackState.carriedTicks = 0;
					trackState.carriedTime = 0;
				}

				if (cell.note !== undefined) {
					channel.setMIDINote(cell.note, tickTime, trackState.glide);
				}

				for (let effect of cell.effects.values()) {
					effect.apply(trackState, channel, tickTime);
				}
				gateLength = trackState.gateLength;

				while (tick < numRowTicks) {
					// Restrict actual velocity used to a valid value
					const noteVelocity = Math.max(Math.min(Math.round(velocity), 127), 1);
					channel.keyOn(context, noteVelocity, tickTime);
					let nextTriggerTick = tick + retrigger.ticks;
					if (nextTriggerTick > numRowTicks) {
						if (nextCell?.effects.has(EffectNumbers.RETRIGGER)) {
							trackState.carriedTicks = numRowTicks - tick;
							trackState.carriedTime = onset + duration - tickTime;
							break;
						} else {
							nextTriggerTick = numRowTicks;
						}
					}
					const nextTriggerTime = onset + duration * nextTriggerTick / numRowTicks;
					const offTime = tickTime + (nextTriggerTime - tickTime) * gateLength;
					channel.keyOff(context, offTime);
					tick = nextTriggerTick;
					tickTime = nextTriggerTime;
					velocity *= retrigger.velocityMultiple;
				}
				trackState.prevVelocity = velocity;

			}	// End for each track
			time += rowDuration;
			prevRowDuration = rowDuration;
		}
	}

	static findNoteDuration(initialDuration, basicRowDuration, numTicks, groove, cells, rowNum, gateLength) {
		const numRows = cells.length;
		const grooveLength = groove.length;
		let rowDuration = basicRowDuration * groove[rowNum % grooveLength];
		let duration = initialDuration;
		let lastNoteOffset = 0;
		rowNum++;
		let cell = cells[rowNum];

		while (rowNum < numRows && cell.velocity === undefined && !cell.effects.has(EffectNumbers.RETRIGGER)) {
			if (cell.note !== undefined) {
				lastNoteOffset = duration;
			}
			rowDuration = basicRowDuration * groove[rowNum % grooveLength];
			duration += rowDuration;
			rowNum++;
			cell = cells[rowNum];
		}

		let extraTicks = 0;
		if (cell !== undefined) {
			const lastRowDuration = basicRowDuration * groove[rowNum % grooveLength];
			extraTicks = cell.delay;
			if (extraTicks >= 0) {
				extraTicks = Math.min(extraTicks, numTicks);
				duration += lastRowDuration * extraTicks / numTicks;
			} else {
				extraTicks = Math.max(-extraTicks, -numTicks);
				duration += rowDuration * extraTicks / numTicks;
			}
		}
		return lastNoteOffset + (duration - lastNoteOffset) * gateLength;
	}

}

export {Phrase, Transform, Pattern, Player};
