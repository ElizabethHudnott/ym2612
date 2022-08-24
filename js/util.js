
function queryChecked(ancestor, name) {
	return ancestor.querySelector(`:checked[name="${name}"]`);
}

function checkInput(ancestor, name, value) {
	const input = ancestor.querySelector(`[name="${name}"][value="${value}"]`);
	input.checked = true;
	return input;
}

export {queryChecked, checkInput};
