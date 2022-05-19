let access, currentPort;
let status;	// i.e. the current message type and channel number

function addPort(port) {
	const option = document.createElement('OPTION');
	option.value = port.id;
	option.innerHTML = port.name;
	document.getElementById('midi-port').appendChild(option);
}

function switchPort() {
	if (currentPort) {
		currentPort.removeEventListener('midimessage', processMessage);
		currentPort.close();
	}
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
			switchPort();
		}
	} else if (option === null) {
		addPort(port);
		switchPort();
	}
}

function processMessage(event) {
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
	}
	MIDI.status = Request.INACTIVE;
}

const MIDI = {
	requestAccess: requestAccess,
	close: stopMIDI,
	Status: Request,
	status: 'requestMIDIAccess' in navigator ? Request.INACTIVE : Request.UNSUPPORTED,
	noteOn: undefined,
	noteOff: undefined,
}

export default MIDI;
