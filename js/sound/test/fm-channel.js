import {assert, FMTestSuite} from '../../test.js';
import Operator from '../operator.js';

const tests = new FMTestSuite();

tests.add(
	'getOperator(): returns instance of Operator',
	channel => assert(channel.getOperator(1) instanceof Operator)
);

tests.add(
	'getOperator(): channel has at least 4 operators',
	channel => assert(channel.getOperator(4))
);

tests.add(
	'setAlgorithm(): Mixed AM & FM',
	(channel, test) => test.play(time => {
		channel.setAlgorithm([88], [82, 82]);
		channel.setFrequencyMultiple(1, 3, time);
	})
);

tests.add(
	'useAlgorithm(): 1 modulator and 3 carriers',
	(channel, test) => test.play(time => {
		channel.useAlgorithm(5);
		channel.normalizeLevels();
		channel.getOperator(1).setTotalLevel(72);
		channel.setFrequencyMultiple(2, 0.5, time);
		channel.setFrequencyMultiple(3, 2, time);
		channel.setFrequencyMultiple(4, 4, time);
	})
);

tests.add(
	'getAlgorithm()',
	channel => {
		channel.useAlgorithm(0);
		assert(channel.getAlgorithm() === 0);
	}
)

tests.add(
	'setModulationDepth(): lower depth',
	(channel, test) => test.play(time => {
		channel.useAlgorithm(4);
		channel.disableOperator(3);
		channel.disableOperator(4);
		channel.setModulationDepth(1, 2, 80);
	})
)

TEST_RIG.addSuite('fm-channel.js', tests);
