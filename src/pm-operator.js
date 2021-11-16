class PMOperator extends Operator {

	/**Constructs an instance of an operator. Operators are normally created by
	 * invoking the {@link FMSynth} constructor.
	 * @param {AudioContext} context The Web Audio context.
	 * @param {AudioNode} lfModulator The signal used as an LFO to control the operator's phase.
	 * @param {AudioNode} amModulator The signal used to apply amplitude modulation to the oscillator's output.
	 * @param {AudioNode} output The destination to route the operator's audio output to
	 * or undefined if the operator will always be used as a modulator.
	 *
	 */
	constructor(synth, context, lfModulator, amModulator, output, dbCurve) {
		super(synth, context, amModulator, output, dbCurve);

		/* Smallest frequency (longest period) is 1/2 of the frequency step (operator multiple = 0.5).
		 * Plus the LFO too. Allow +-1/2 cycle for that, which is more than needed but it
		 * makes the numbers easier.
		 */
		const maxDelay = 2 * 2 / synth.frequencyStep;
		const delay = new DelayNode(context, {delayTime: 1 / 440, maxDelayTime:  maxDelay});
		this.sine.connect(delay);
		this.delay = delay;
		const delayAmp = new GainNode(context, {gain: 1 / 880});
		delayAmp.connect(delay.delayTime);
		this.delayAmp = delayAmp;
		lfModulator.connect(delayAmp);
		delay.connect(this.amModNode);
	}

	/**Configures this operator to have its phase modulated from an external source (usually another operator).
	 * This method is usually called by the {@link Channel} constructor.
	 * @param {AudioNode} source The source to use to modulate this operator's oscillator.
	 */
	connectIn(source) {
		source.connect(this.delayAmp);
	}

	setFrequency(blockNumber, frequencyNumber, frequencyMultiple = 1, time = 0, method = 'setValueAtTime') {
		super.setFrequency(blockNumber, frequencyNumber, frequencyMultiple, time, method);
		const period = 1 / Math.max(this.frequency, 0.5 * this.synth.frequencyStep);
		this.delay.delayTime[method](period, time);
		this.delayAmp.gain[method](0.5 * period, time);
	}

	keyOn(context, time = context.currentTime + TIMER_IMPRECISION) {
		if (!this.keyIsOn) {
			const frequency = this.frequency;

			const makeNewOscillator =
				!this.freeRunning &&
				frequency !== 0 &&
				this.lastFreqChange <= time;

			if (makeNewOscillator) {
				const currentMaxDelay = 3 / frequency;
				if (context.currentTime + TIMER_IMPRECISION + currentMaxDelay <= time) {
					const newSine = new OscillatorNode(context, {frequency: frequency});
					const switchOverTime = time - currentMaxDelay;
					newSine.start(switchOverTime);
					newSine.connect(this.delay);
					this.sine.stop(switchOverTime);
					this.sine = newSine;
				}
			}
			super.keyOn(time);
		}
	}

}
