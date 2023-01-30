/* This source code is copyright of Elizabeth Hudnott.
 * © Elizabeth Hudnott 2021-2023. All rights reserved.
 * Any redistribution or reproduction of part or all of the source code in any form is
 * prohibited by law other than downloading the code for your own personal non-commercial use
 * only. You may not distribute or commercially exploit the source code. Nor may you transmit
 * it or store it in any other website or other form of electronic retrieval system. Nor may
 * you translate it into another language.
 */

function queryChecked(ancestor, name) {
	return ancestor.querySelector(`:checked[name="${name}"]`);
}

function checkInput(ancestor, name, value) {
	const input = ancestor.querySelector(`[name="${name}"][value="${value}"]`);
	input.checked = true;
	return input;
}

export {queryChecked, checkInput};
