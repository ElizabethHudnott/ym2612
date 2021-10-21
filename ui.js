import {FMOperator} from './opl3.js';
let context;


document.getElementById('btn-start').addEventListener('click', function (event) {
	context = new AudioContext();
	const op = new FMOperator(context, true);
	op.connect(context.destination);
	op.start(context.currentTime + 0.1);
	window.op = op;
});
