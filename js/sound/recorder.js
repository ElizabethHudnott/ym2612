/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2022. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */
export default class Recorder {

	constructor(context) {
		this.audioNode = new MediaStreamAudioDestinationNode(context);
		this.ondatarecorded = undefined;
		this.format = 'audio/webm';
	}

	connectIn(input) {
		input.connect(this.audioNode);
	}

	set format(mimeType) {
		if (this.mediaRecorder) {
			// Clean up old resources
			this.mediaRecorder.ondataavailable = undefined;
			if (this.mediaRecorder.state !== 'inactive') {
				this.mediaRecorder.stop();
			}
		}

		this.chunks = [];
		this.stopping = false;

		const mediaRecorder = new MediaRecorder(this.audioNode.stream, {mimeType: mimeType});
		this.mediaRecorder = mediaRecorder;

		const me = this;

		mediaRecorder.ondataavailable = function (event) {
			me.chunks.push(event.data);
			if (me.ondatarecorded) {
				const blob = new Blob(me.chunks, {type: me.mediaRecorder.mimeType});
				me.ondatarecorded(blob);
			}
			if (me.stopping) {
				me.chunks = [];
				me.stopping = false;
			}
		};

	}

	get format() {
		return this.mediaRecorder.mimeType;
	}

	start() {
		this.mediaRecorder.start();
	}

	stop() {
		this.stopping = true;
		this.mediaRecorder.stop();
	}

	pause() {
		this.mediaRecorder.pause();
	}

	resume() {
		this.mediaRecorder.resume();
	}

	requestAudio() {
		if (this.mediaRecorder.state === 'inactive') {
			const blob = new Blob(this.chunks, {type: this.mediaRecorder.mimeType});
			this.ondatarecorded(blob);
		} else {
			this.mediaRecorder.requestData();
		}
	}

	get state() {
		return this.mediaRecorder.state;
	}

}
