let access, currentPort;
let status;	// i.e. the current message type and channel number
let channel = -1;	// Default to listening in omni mode

function addPort(port) {
	const option = document.createElement('OPTION');
	option.value = port.id;
	option.innerHTML = port.name;
	document.getElementById('midi-port').appendChild(option);
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

async function requestAccess(success, fail) {
	try {
		access = await navigator.requestMIDIAccess();
	} catch (e) {
		fail(e);
		return;
	}

	for (let port of access.inputs.values()) {
		addPort(port);
	}

	access.addEventListener('statechange', function (event) {
		const port = event.port;
		if (port.type !== 'input') {
			return;
		}
		const portSelect = document.getElementById('midi-port');
		const option = portSelect.querySelector('[value="' + port.id + '"]');
		if (option === null) {
			addPort(port);
		} else if (port.state === 'disconnected') {
			if (currentPort === port) {
				currentPort = undefined;
				portSelect.value = 'none';
			}
			option.remove();
		}
	});

	document.getElementById('midi-port').addEventListener('input', function (event) {
		if (currentPort) {
			currentPort.close();
			currentPort.removeEventListener('midimessage');
		}
		const id = this.value;
		if (id === 'none') {
			currentPort = undefined;
		} else {
			currentPort = access.inputs.get(id);
			currentPort.addEventListener('midimessage', processMessage);
		}
	})

	success();
}

const MIDI = {
	requestAccess: requestAccess,
	noteOn: undefined,
	noteOff: undefined,
}

export default MIDI;
