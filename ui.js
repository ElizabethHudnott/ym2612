
const context = new AudioContext();
const op = new FMOperator(context);
op.connect(context.destination);


document.getElementById('btn-start').addEventListener('click', function (event) {
	context.resume();
	op.start(context.currentTime + 0.1);
});
