// Other people's carets in a shared entry. The colored line always shows; the
// name label shows for a moment after that person types or moves, then fades
// (hover the caret to see it again). Carets are keyed by the Y client id each
// member puts in their awareness `user` (as `cid`), so a caret re-rendered by
// the editor still knows whether its owner just moved.

const SHOW_MS = 2500;
const lastMove = new Map<number, number>();
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function flash(el: Element, ms = SHOW_MS) {
	el.classList.add('is-active');
	clearTimeout(timers.get(el));
	timers.set(
		el,
		setTimeout(() => el.classList.remove('is-active'), ms)
	);
}

// Call for each remote client whose awareness (caret, name) just changed.
export function noteCaretMove(cid: number): void {
	lastMove.set(cid, Date.now());
	for (const el of document.querySelectorAll(`.collaboration-carets__caret[data-cid="${cid}"]`)) {
		flash(el);
	}
}

// CollaborationCaret's render(), with the client id and the fade.
export function renderCaret(user: Record<string, unknown>): HTMLElement {
	const color = typeof user.color === 'string' ? user.color : '#888';
	const caret = document.createElement('span');
	caret.className = 'collaboration-carets__caret';
	caret.style.borderColor = color;
	const cid = typeof user.cid === 'number' ? user.cid : null;
	if (cid != null) caret.dataset.cid = String(cid);

	const label = document.createElement('div');
	label.className = 'collaboration-carets__label';
	label.style.backgroundColor = color;
	label.textContent = typeof user.name === 'string' ? user.name : 'Someone';
	caret.append(label);

	const since = cid != null ? Date.now() - (lastMove.get(cid) ?? 0) : Infinity;
	if (since < SHOW_MS) flash(caret, SHOW_MS - since);
	return caret;
}
