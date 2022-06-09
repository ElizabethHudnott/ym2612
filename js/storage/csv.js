import {Phrase, Pattern} from '../sound/sequencer.js';

function parseCSV(text) {
	const fieldRE = /"([^"]*(?:""[^"]*)*)"|([^",\t\r\n]*)/gu;
	const separatorRE = /(,|\t)|(\r?\n)|$/gu;

	const rows = [];
	let columns = [];
	let lineNum = 1;
	let lineBeginIndex = 0;
	while (true) {
		let match = fieldRE.exec(text);
		if (match === null) {
			rows.push(columns);
			break;
		}
		const data = match[1] !== undefined ? match[1] : match[2];
		columns.push(data);

		const searchIndex = fieldRE.lastIndex;
		separatorRE.lastIndex = searchIndex;
		match = separatorRE.exec(text);
		if (match === null) {
			const errorIndex = searchIndex - lineBeginIndex;
			throw new Error('CSV file contains an error at line ' + lineNum + ', character ' + errorIndex);
		} else if (match[2] !== undefined) {
			rows.push(columns);
			lineNum++;
			columns = [];
			lineBeginIndex = separatorRE.lastIndex;
		} else if (separatorRE.lastIndex === text.length) {
			rows.push(columns);
			break;
		}
		fieldRE.lastIndex = separatorRE.lastIndex;
	}
	const numRows = rows.length;
	const lastRow = rows[numRows - 1];
	if (lastRow.length === 1 && lastRow[0] === '') {
		rows.splice(numRows - 1, 1);
	}
	return rows;
}

class ColumnMap {

	constructor() {
		this.delay = undefined;
		this.note = undefined;
		this.velocity = undefined;
		this.instrument = undefined;
	}

}

function parseHeader(row, maxChannels) {
	const tracks = [];
	let columns = new ColumnMap();
	let isEmpty = true;
	for (let i = 0; i < row.length; i++) {
		const heading = row[i].trim().toLowerCase();
		switch (heading) {
		case 'delay':
		case 'note':
			if (!isEmpty || columns[heading] !== undefined) {
				tracks.push(columns);
				columns = new ColumnMap();
			}
			columns[heading] = i;
			isEmpty = false;
			break;
		case 'velocity':
		case 'instrument':
			if (columns[heading] !== undefined) {
				tracks.push(columns);
				columns = new ColumnMap();
			}
			columns[heading] = i;
			isEmpty = false;
			break;
		}
	}
	tracks.push(columns);
	return tracks;
}

function parsePattern(name, text, maxChannels) {
	const rows = parseCSV(text);
	if (rows.length === 0) {
		return Pattern(name, 0);
	}

	const trackMappings = parseHeader(rows[0], maxChannels);
	const numTracks = trackMappings.length;
	const numRows = rows.length - 1;
	const pattern = new Pattern(name, numRows);
	for (let i = 0; i < numTracks; i++) {
		const phrase = new Phrase('Phrase ' + Phrase.nameCounter, numRows);
		Phrase.nameCounter++;
		pattern.addTrack(phrase);
	}
	const pitches = [9, 11, 0, 2, 4, 5, 7];	// A-G

	const noteRE = /(?:([A-G])(#)?(-?\d)?)|(\d{1,3})/;
	const properties = ['delay', 'velocity', 'instrument'];
	const octaves = new Array(numTracks);
	octaves.fill(4);
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		for (let trackNum = 0; trackNum < numTracks; trackNum++) {
			const cell = pattern.phrases[trackNum].cells[i - 1];
			const trackMap = trackMappings[trackNum];
			for (let property of properties) {
				const columnNum = trackMap[property];
				if (columnNum !== undefined) {
					const number = parseInt(row[columnNum]);
					if (Number.isFinite(number)) {
						cell[property] = number;
					}
				}
			}
			let columnNum = trackMap.note;
			if (columnNum !== undefined) {
				const str = row[columnNum].trim().toUpperCase();
				const match = str.match(noteRE);
				if (match === null) {
					if (str !== '') {
						throw new Error('CSV file contains an error on row ' + i + ', column ' +
							String(columnNum + 1));
					}
				} else {
					let note;
					if (match[1] !== undefined) {
						// Note letter
						note = pitches[match[1].charCodeAt(0) - 65];
						if (match[2] !== undefined) {
							// Sharps
							note++;
						}
						// Octave
						if (match[3] !== undefined) {
							octaves[trackNum] = parseInt(match[3]);
						}
						note += (octaves[trackNum] + 1) * 12;
						cell.note = note;
					} else {
						// MIDI note number
						cell.note = parseInt(match[4]);
					}
					if (trackMap.velocity === undefined) {
						cell.velocity = 127;
					}
				}
			} // end if new note
		} // end for each track
	} // end for each row
	return pattern;
}

export {parsePattern};
