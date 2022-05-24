const notesOn = new Set();
let access, currentPort;
let status;	// i.e. the current message type and channel number

function addPort(port) {
	const option = document.createElement('OPTION');
	option.value = port.id;
	option.innerHTML = port.name;
	document.getElementById('midi-port').appendChild(option);
}

function closePort(timeStamp = performance.now()) {
	if (currentPort) {
		currentPort.removeEventListener('midimessage', processMessage);
		for (let note of notesOn) {
			MUSIC_INPUT.keyUp(timeStamp, note);
		}
		notesOn.clear();
		currentPort.close();
	}
}

function switchPort(timeStamp = performance.now()) {
	closePort(timeStamp);
	const id = document.getElementById('midi-port').value;
	if (id === '') {
		currentPort = undefined;
	} else {
		currentPort = access.inputs.get(id);
		currentPort.addEventListener('midimessage', processMessage);
	}
}

function portChange(event) {
	const port = event.port;
	if (port.type !== 'input') {
		return;
	}
	const portSelect = document.getElementById('midi-port');
	const option = portSelect.querySelector('[value="' + port.id + '"]');
	if (port.state === 'disconnected') {
		if (option !== null) {
			option.remove();
			switchPort(event.timeStamp);
		}
	} else if (option === null) {
		addPort(port);
		if (currentPort === undefined) {
			switchPort(event.timeStamp);
		}
	}
}

function processMessage(event) {
	const timeStamp = event.timeStamp;
	const data = event.data;
	let messageType, channel, index;
	if (data[0] & 128) {
		if ((data[0] & 0xF0) !== 0xF0) {
			status = data[0];
			messageType = status & 0xF0;
			channel = status & 0x0F;
		} else {
			messageType = data[0];
		}
		index = 1;
	} else {
		messageType = status & 0xF0;
		channel = status & 0x0F;
		index = 0;
	}

	let note, velocity, value;

	switch (messageType) {
	case 0x80: 	// Note Off
		note = data[1] + 12 * MIDI.octaveShift;
		MUSIC_INPUT.keyUp(timeStamp, note);
		notesOn.delete(note);
		break;

	case 0x90: 	// Note On
		note = data[1] + 12 * MIDI.octaveShift;
		velocity = data[2];
		if (velocity === 0) {
			MUSIC_INPUT.keyUp(timeStamp, note);
			notesOn.delete(note);
		} else {
			if (!MIDI.velocitySensitive) {
				velocity = 127;
			}
			MUSIC_INPUT.keyDown(timeStamp, note, velocity);
			notesOn.add(note);
		}
		break;

	case 0xB0: // Control Change
		const controller = data[1];
		value = data[2];
		switch (controller) {
		case 64: // Sustain
			MUSIC_INPUT.sustainCC(timeStamp, value >= 64);
			break;
		case 65: // Portamento switch
			MUSIC_INPUT.portamentoSwitch(value >= 64);
			break;
		default:
			MUSIC_INPUT.controlChange(timeStamp, controller, value);
		}
		break;
	}

}

const Request = Object.freeze({
	UNSUPPORTED: 0,
	INACTIVE: 1,
	PENDING: 2,
	GRANTED: 3,
	REFUSED: 4,
});

async function requestAccess(success, fail) {
	if (MIDI.status === Request.PENDING) {
		return;
	}
	document.getElementById('midi-port').innerHTML = '';
	MIDI.status = Request.PENDING;
	try {
		access = await navigator.requestMIDIAccess();
		if (MIDI.status === Request.INACTIVE) {
			access = undefined;
			return;
		}
		MIDI.status = Request.GRANTED;
	} catch (e) {
		MIDI.status = Request.REFUSED;
		fail(e);
		return;
	}

	for (let port of access.inputs.values()) {
		addPort(port);
	}
	switchPort();

	access.addEventListener('statechange', portChange);
	document.getElementById('midi-port').addEventListener('input', switchPort);

	success();
}

function stopMIDI() {
	if (access) {
		document.getElementById('midi-port').removeEventListener('input', switchPort);
		access.removeEventListener('statechange', portChange);
		access = undefined;
		closePort();
	}
	MIDI.status = Request.INACTIVE;
}

const MIDI = {
	requestAccess: requestAccess,
	close: stopMIDI,
	Status: Request,
	status: 'requestMIDIAccess' in navigator ? Request.INACTIVE : Request.UNSUPPORTED,
	octaveShift: 0,
	velocitySensitive: true,
}

export default MIDI;
