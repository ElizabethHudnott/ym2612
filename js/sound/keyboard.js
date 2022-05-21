const keymap = new Map();
keymap.set('IntlBackslash', 47);
keymap.set('KeyZ', 48);
keymap.set('KeyS', 49);
keymap.set('KeyX', 50);
keymap.set('KeyD', 51);
keymap.set('KeyC', 52);
keymap.set('KeyV', 53);
keymap.set('KeyG', 54);
keymap.set('KeyB', 55);
keymap.set('KeyH', 56);
keymap.set('KeyN', 57);
keymap.set('KeyJ', 58);
keymap.set('KeyM', 59);
keymap.set('Comma', 60);
keymap.set('KeyL', 61);
keymap.set('Period', 62);
keymap.set('Semicolon', 63);
keymap.set('Slash', 64);
keymap.set('KeyQ', 60);
keymap.set('Digit2', 61);
keymap.set('KeyW', 62);
keymap.set('Digit3', 63);
keymap.set('KeyE', 64);
keymap.set('KeyR', 65);
keymap.set('Digit5', 66);
keymap.set('KeyT', 67);
keymap.set('Digit6', 68);
keymap.set('KeyY', 69);
keymap.set('Digit7', 70);
keymap.set('KeyU', 71);
keymap.set('KeyI', 72);
keymap.set('Digit9', 73);
keymap.set('KeyO', 74);
keymap.set('Digit0', 75);
keymap.set('KeyP', 76);
keymap.set('BracketLeft', 77);

const notesOn = new Set();
let velocity = 127;
let transpose = 0;

document.body.addEventListener('keydown', function (event) {
	const code = event.code;
	const shift = event.shiftKey;

	if (event.altKey || event.ctrlKey || event.metaKey) {
		return;
	}

	const htmlInputType = document.activeElement.type;

	if (
		htmlInputType === 'number' &&
		(code.slice(0, 5) === 'Digit' || code.slice(0, 6) === 'Numpad' || code === 'Minus' || code === 'Period')
	) {
		return;
	}

	if (code === 'Minus' || code === 'NumpadSubtract') {
		if (shift) {
			if (transpose > -48 && notesOn.size === 0) {
				transpose -= 12;
			}
		} else if (velocity > 16) {
			velocity -= 16;
		}
		return;
	}

	if (code === 'Equal' || code === 'NumpadAdd') {
		if (shift) {
			if (transpose < 60 && notesOn.size === 0) {
				transpose += 12;
			}
		} else if (velocity < 127) {
			velocity += 16;
		}
		return;
	}

	if (event.repeat || shift) {
		return;
	}

	let note = keymap.get(code);
	if (note !== undefined) {
		note += transpose;
		if (note < 0 || note > 127) {
			return;
		}
		MUSIC_INPUT.keyDown(event.timeStamp, note, velocity);
		notesOn.add(note);
	}

});

document.body.addEventListener('keyup', function (event) {
	let note = keymap.get(event.code);
	if (note !== undefined) {
		note += transpose;
		MUSIC_INPUT.keyUp(event.timeStamp, note);
		notesOn.delete(note);
	}
});

export function allNotesOff(timeStamp = performance.now()) {
	for (let note of notesOn) {
		MUSIC_INPUT.keyUp(timeStamp, note);
	}
	notesOn.clear();
}

window.addEventListener('blur', function (event) {
	allNotesOff(event.timeStamp);
});
