import {PROCESSING_TIME} from './sound/common.js';
import Synth from './sound/fm-synth.js';

function assert(value) {
	if (!value) {
		throw new Error('Assertion failed');
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class TestCase {

	constructor(title, exec) {
		this.title = title;
		this.exec = exec;
		this.runtime = undefined;
	}

	async run(setup, teardown) {
		const data = setup();
		this.runtime = data;
		console.log(this.title);
		await this.exec(data.target, this);
		teardown(data);
		this.runtime = undefined;
	}

}

class FMTestCase extends TestCase {

	play(execOrDuration = 1) {
		const channel = this.runtime.channel;
		const time = audioContext.currentTime + PROCESSING_TIME;
		let duration;
		if (typeof(execOrDuration) === 'function') {
			duration = execOrDuration(time) || 1;
		} else {
			duration = execOrDuration;
		}
		channel.keyOn(audioContext, 127, time);
		channel.keyOff(audioContext, time + duration);
		if (!confirm(this.title)) {
			throw new Error('User declared the test failed.');
		}
	}

}

class Outcome {
	constructor(numPassed, numFailed) {
		this.numPassed = numPassed;
		this.numFailed = numFailed;
	}
}

class TestSuite {

	constructor() {
		this.tests = [];
	}

	setup() {
		return {};
	}

	teardown() { }

	add(title, exec) {
		this.tests.push(new TestCase(title, exec));
	}

	async run() {
		let passed = 0, failed = 0;
		for (let test of this.tests) {
			try {
				await test.run(this.setup, this.teardown);
				passed++;
			} catch (e) {
				console.error(e);
				failed++;
			}
		}
		return new Outcome(passed, failed);
	}

}

class FMTestSuite extends TestSuite {

	add(title, exec) {
		this.tests.push(new FMTestCase(title, exec));
	}

	setup() {
		const synth = new Synth(audioContext, audioContext.destination, 1);
		synth.start(audioContext.currentTime + PROCESSING_TIME);
		const channel = synth.getChannel(1);
		return {
			target: channel,
			channel: channel,
			synth: synth
		};
	}

	teardown(data) {
		data.synth.stop();
	}

}

class TestRig {

	constructor() {
		this.suites = new Map();
	}

	addSuite(name, testSuite) {
		this.suites.set(name, testSuite);
	}

	async runSuite(name) {
		console.clear();
		const outcome = await this.suites.get(name).run();
	}

	async runAll() {
		console.clear();
		let totalPassed = 0, totalFailed = 0, numSuitesFailed = 0;
		for (let [name, suite] of this.suites.entries()) {
			console.log('Test Suite: ' + name);
			console.group();
			const outcome = await suite.run();
			console.groupEnd();
			totalPassed += outcome.numPassed;
			totalFailed += outcome.numFailed;
			if (outcome.numFailed > 0) {
				console.error(outcome.numFailed + ' tests failed.');
				numSuitesFailed++;
			} else {
				console.log(outcome.numPassed + ' tests passed and no failures.');
			}
		}

		const numSuites = this.suites.size;
		if (totalFailed === 0) {
			console.log(numSuites + ' suites tested, ' + totalPassed + ' tests passed and no failures.');
		} else {
			console.error(numSuitesFailed + ' test suites contain failures. ' + totalFailed + ' tests failed in total.');
		}
	}

}

const TEST_RIG = new TestRig();

export {assert, delay, TestSuite, FMTestSuite, TEST_RIG};
