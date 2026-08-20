import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Mapping } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';

// Rows this extension can pick up. `listItem` covers bullet + ordered lists;
// `taskItem` is its own node under `taskList`. They must not mix, which the
// schema check in `canDrop` enforces rather than a hand-written rule.
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

// Holds the position of the row currently in flight, or null. Kept in plugin
// state rather than as a class on the row's element: ProseMirror redraws nodes
// mid-drag (a selection change is enough) and a hand-set class does not
// survive that, while a decoration is re-applied on every redraw.
const dragKey = new PluginKey<number | null>('listDragHandle');

const HANDLE_W = 16;
const HANDLE_H = 20;
// Breathing room between the grip and the leftmost ink of the row it belongs
// to. Small on purpose: the grip has to read as attached to its own row rather
// than to the shallower row above it.
const HANDLE_GAP = 6;
// Bullets and numbers are painted outside the row's content box, so a row that
// has one needs that much more clearance. Task rows have no marker and must not
// pay for one — reserving it there pushes the grip a whole indent level away.
const MARKER_W = 16;
// Top-level rows land slightly negative; the page's 2rem gutter absorbs it.
const HANDLE_MIN_LEFT = -26;
// how far past the grip's own column the pointer may stray and still be
// treated as running along the rows rather than having left them
const GUTTER_SLACK = 10;

// travel before a press on the grip counts as a drag rather than a click
const DRAG_SLOP = 4;
// rows sliding to their new places after a move
const FLIP_MS = 220;
const FLIP_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const LONG_PRESS_MS = 420;
const LONG_PRESS_SLOP = 8;
const AUTOSCROLL_EDGE = 60;
const AUTOSCROLL_STEP = 10;

type Item = {
	pos: number; // position of the row node itself
	node: PMNode;
	parent: PMNode; // the list wrapping it
	listPos: number; // position of that list
	index: number; // child index within the list
};

// Innermost list row containing `pos`, or null when `pos` isn't in a list.
function itemAt(state: EditorState, pos: number): Item | null {
	const $pos = state.doc.resolve(pos);
	for (let d = $pos.depth; d > 1; d--) {
		if (!ITEM_TYPES.has($pos.node(d).type.name)) continue;
		return {
			pos: $pos.before(d),
			node: $pos.node(d),
			parent: $pos.node(d - 1),
			listPos: $pos.before(d - 1),
			index: $pos.index(d - 1)
		};
	}
	return null;
}

function itemFromDOM(view: EditorView, el: Element | null | undefined): Item | null {
	const li = el?.closest('li');
	if (!li || !view.dom.contains(li)) return null;
	try {
		return itemAt(view.state, view.posAtDOM(li, 0));
	} catch {
		return null;
	}
}

function itemFromCoords(view: EditorView, x: number, y: number): Item | null {
	const found = view.posAtCoords({ left: x, top: y });
	return found ? itemAt(view.state, found.pos) : null;
}

function itemDOM(view: EditorView, item: Item): HTMLElement | null {
	const dom = view.nodeDOM(item.pos);
	return dom instanceof HTMLElement ? dom : null;
}

// A row's first line box. A row can be tall (nested sublists live inside it),
// so the first child — the paragraph, or a task row's label — is what the
// handle aligns to and what the drop midpoint is measured against.
function lineRect(dom: HTMLElement): DOMRect {
	const first = dom.firstElementChild;
	return (first ?? dom).getBoundingClientRect();
}

// A drop is legal when it lands outside the row's own subtree and the target
// list accepts this row's type — which is what stops a taskItem from being
// dropped into a bullet list. Positions inside the row are also no-op moves,
// so the same range check covers both.
function canDrop(state: EditorState, item: Item, insertPos: number): boolean {
	if (insertPos >= item.pos && insertPos <= item.pos + item.node.nodeSize) return false;
	const $ins = state.doc.resolve(insertPos);
	return $ins.parent.canReplaceWith($ins.index(), $ins.index(), item.node.type);
}

function reducedMotion() {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

type Shot = { pos: number; top: number; left: number };

// Boxes of every on-screen row, keyed by doc position — the "first" half of a
// FLIP. Off-screen rows are skipped: they cost layout reads and animate where
// nobody is looking.
function snapshotRows(view: EditorView): Shot[] {
	const shots: Shot[] = [];
	const limit = window.innerHeight + 100;
	view.state.doc.descendants((node, pos) => {
		if (!ITEM_TYPES.has(node.type.name)) return true;
		const dom = view.nodeDOM(pos);
		if (dom instanceof HTMLElement) {
			const r = dom.getBoundingClientRect();
			if (r.bottom > -100 && r.top < limit) shots.push({ pos, top: r.top, left: r.left });
		}
		return true;
	});
	return shots;
}

// The "last, invert, play" half. Rows are found again by mapping their old
// positions through the transaction, so this survives ProseMirror swapping the
// underlying elements on redraw.
function playFlip(
	view: EditorView,
	shots: Shot[],
	mapping: Mapping,
	moved: { rect: DOMRect | null; pos: number },
	scrolled: { x: number; y: number }
) {
	// a row that scrolled has moved on screen without moving in the document
	const animated: HTMLElement[] = [];
	const slide = (dom: HTMLElement, fromTop: number, fromLeft: number) => {
		const r = dom.getBoundingClientRect();
		const dx = fromLeft - scrolled.x - r.left;
		const dy = fromTop - scrolled.y - r.top;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
		dom.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
			duration: FLIP_MS,
			easing: FLIP_EASE
		});
		animated.push(dom);
	};

	// the row that actually moved: its old position was deleted, so it cannot be
	// recovered from the mapping — it is tracked by where it landed instead
	const landedDom = view.nodeDOM(moved.pos);
	if (landedDom instanceof HTMLElement && moved.rect) {
		slide(landedDom, moved.rect.top, moved.rect.left);
	}

	// and everything that shifted to make room for it
	for (const shot of shots) {
		const mapped = mapping.mapResult(shot.pos);
		if (mapped.deleted) continue;
		const dom = view.nodeDOM(mapped.pos);
		if (!(dom instanceof HTMLElement)) continue;
		// nested rows ride along on their parent's transform; animating them too
		// would move them twice
		if (animated.some((done) => done.contains(dom))) continue;
		slide(dom, shot.top, shot.left);
	}
}

// Insert first, then delete the source: the target position stays valid and
// the source range is mapped through the insertion. `caretOffset` is the
// caret's distance into the row, preserved so a keyboard move doesn't lose
// the cursor.
function moveItem(view: EditorView, item: Item, insertPos: number, caretOffset: number) {
	const tr = view.state.tr;
	tr.insert(insertPos, item.node);

	// A list can't be empty (`listItem+`), so when the moved row was its list's
	// only child the wrapper goes with it.
	const solo = item.parent.childCount === 1;
	const from = solo ? item.listPos : item.pos;
	const to = from + (solo ? item.parent.nodeSize : item.node.nodeSize);

	const afterInsert = tr.steps.length;
	tr.delete(tr.mapping.map(from), tr.mapping.map(to));

	// where the row ended up once the source range collapsed
	const landed = tr.mapping.slice(afterInsert).map(insertPos);
	const caret = Math.min(landed + caretOffset, tr.doc.content.size);
	tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));

	const animate = !reducedMotion();
	const shots = animate ? snapshotRows(view) : [];
	const sourceDOM = animate ? view.nodeDOM(item.pos) : null;
	const rect = sourceDOM instanceof HTMLElement ? sourceDOM.getBoundingClientRect() : null;
	const scrollX = window.scrollX;
	const scrollY = window.scrollY;

	view.dispatch(tr.scrollIntoView());

	// scrollIntoView may have moved the page under the boxes measured above
	if (animate) {
		playFlip(
			view,
			shots,
			tr.mapping,
			{ rect, pos: landed },
			{
				x: window.scrollX - scrollX,
				y: window.scrollY - scrollY
			}
		);
	}
}

// Swap the row at the cursor with its previous/next sibling — the keyboard
// equivalent of a drag, and the accessible path to reordering.
function moveBySibling(view: EditorView, dir: -1 | 1): boolean {
	const { state } = view;
	const item = itemAt(state, state.selection.from);
	if (!item) return false;
	const neighbour = item.parent.maybeChild(item.index + dir);
	if (!neighbour) return false;
	const insertPos =
		dir === -1 ? item.pos - neighbour.nodeSize : item.pos + item.node.nodeSize + neighbour.nodeSize;
	moveItem(view, item, insertPos, state.selection.from - item.pos);
	return true;
}

type Drag = {
	item: Item;
	pointerId: number;
	/** where the row would land on release, or null while over an illegal spot */
	target: number | null;
	/** a finger, not the grip — the row was lifted by long press */
	touch: boolean;
	/** pointer origin, used to tell a real drag from a plain click on the grip */
	originX: number;
	originY: number;
	moved: boolean;
	x: number;
	y: number;
};

class ListDragView {
	private host: HTMLElement;
	private handle: HTMLButtonElement;
	private indicator: HTMLDivElement;
	/** the row the grip is parked on — held as DOM, not a doc position, so an
	 *  unrelated transaction can't strand it on a stale offset */
	private hovered: HTMLElement | null = null;
	private drag: Drag | null = null;
	private pressTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollFrame: number | null = null;

	constructor(private view: EditorView) {
		// `.tiptap-host` is the positioned wrapper the editor is mounted into;
		// the overlays live there so their coordinates are host-relative and
		// they can sit in the left gutter without clipping the text column.
		this.host = (view.dom.parentElement ?? view.dom) as HTMLElement;

		this.handle = document.createElement('button');
		this.handle.type = 'button';
		this.handle.className = 'list-drag-handle';
		this.handle.setAttribute('aria-label', 'Drag to reorder list item');
		this.handle.tabIndex = -1;
		this.handle.innerHTML =
			'<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">' +
			[1, 5, 9]
				.map((cy) => `<circle cx="2" cy="${cy + 1}" r="1"/><circle cx="8" cy="${cy + 1}" r="1"/>`)
				.join('') +
			'</svg>';
		this.handle.addEventListener('pointerdown', this.onHandleDown);

		this.indicator = document.createElement('div');
		this.indicator.className = 'list-drop-indicator';

		this.host.append(this.handle, this.indicator);

		// Tracked on the document, not on view.dom: the grip is a sibling of the
		// editor and can sit left of it, so reaching for it leaves view.dom and a
		// listener scoped there would hide the grip out from under the pointer.
		document.addEventListener('mousemove', this.onHover);
		document.addEventListener('mouseleave', this.hideHandle);
		view.dom.addEventListener('pointerdown', this.onDocDown);
		// non-passive so a touch drag can hold the page still under the finger
		view.dom.addEventListener('touchmove', this.onTouchMove, { passive: false });
	}

	update() {
		// the row may have reflowed under the pointer (a sibling grew, a sublist
		// opened), so follow it rather than hiding and waiting for a mousemove
		// that a still hand never sends
		if (this.drag) return;
		if (this.hovered?.isConnected) this.showHandle(this.hovered);
		else this.hideHandle();
	}

	destroy() {
		this.endDrag(false);
		document.removeEventListener('mousemove', this.onHover);
		document.removeEventListener('mouseleave', this.hideHandle);
		this.view.dom.removeEventListener('pointerdown', this.onDocDown);
		this.view.dom.removeEventListener('touchmove', this.onTouchMove);
		this.handle.remove();
		this.indicator.remove();
	}

	// ---- handle ----------------------------------------------------------

	private onHover = (e: MouseEvent) => {
		if (this.drag) return;
		if (!this.view.editable) return this.hideHandle();
		const target = e.target as Element | null;
		// on the grip itself — that is the point of it, not a reason to leave
		if (target && this.handle.contains(target)) return;

		const li = target?.closest('li');
		if (li instanceof HTMLElement && this.view.dom.contains(li)) {
			this.hovered = li;
			this.showHandle(li);
			return;
		}
		const beside = this.rowBeside(e.clientX, e.clientY);
		if (beside) {
			this.hovered = beside;
			this.showHandle(beside);
			return;
		}
		this.hideHandle();
	};

	// The gutter the grip lives in is outside view.dom, and the list's own
	// padding inside it belongs to the <ul>, so neither has an <li> to hit.
	// Resolve the row from the pointer's line instead, which both keeps the grip
	// reachable and lets it track rows while travelling up and down the gutter.
	private rowBeside(x: number, y: number): HTMLElement | null {
		const box = this.view.dom.getBoundingClientRect();
		if (y < box.top || y > box.bottom) return null;
		if (x < box.left + HANDLE_MIN_LEFT - GUTTER_SLACK || x > box.right) return null;
		// clamped so a pointer out in the gutter still lands on that line's text
		const item = itemFromCoords(this.view, Math.max(x, box.left + 1), y);
		return item && itemDOM(this.view, item);
	}

	private hideHandle = () => {
		if (this.drag) return;
		this.hovered = null;
		this.handle.classList.remove('visible');
	};

	private showHandle(dom: HTMLElement) {
		// Sliding between rows reads well; sliding in from wherever the grip last
		// sat does not, so a fresh appearance is placed without transition.
		const settled = this.handle.classList.contains('visible');
		this.handle.style.transition = settled ? '' : 'none';
		const hostRect = this.host.getBoundingClientRect();
		const rect = lineRect(dom);
		const style = getComputedStyle(dom);
		const line = parseFloat(style.lineHeight) || rect.height;
		// task rows render as flex and drop their marker; bullet/ordered rows keep
		// one and need the extra clearance
		const marker = style.display === 'list-item' && style.listStyleType !== 'none' ? MARKER_W : 0;
		const offset = HANDLE_W + HANDLE_GAP + marker;
		const left = Math.max(rect.left - hostRect.left - offset, HANDLE_MIN_LEFT);
		this.handle.style.left = `${left}px`;
		this.handle.style.top = `${rect.top - hostRect.top + (line - HANDLE_H) / 2}px`;
		this.handle.classList.add('visible');
		if (!settled) {
			void this.handle.offsetWidth; // flush the placement before transitions resume
			this.handle.style.transition = '';
		}
	}

	// ---- drag ------------------------------------------------------------

	private onHandleDown = (e: PointerEvent) => {
		if (!this.view.editable) return;
		const item = itemFromDOM(this.view, this.hovered);
		if (!item) return;
		e.preventDefault();
		this.startDrag(item, e, this.handle);
	};

	// Touch has no hover, so the grip never appears: press and hold a row to
	// pick it up instead. Sliding before the timer fires means the user meant
	// to scroll, so the press is abandoned.
	private onDocDown = (e: PointerEvent) => {
		if (e.pointerType === 'mouse' || !this.view.editable || this.drag) return;
		const item = itemFromDOM(this.view, e.target as Element);
		if (!item) return;
		const { clientX: x0, clientY: y0 } = e;
		const cancel = (ev: PointerEvent) => {
			if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < LONG_PRESS_SLOP) return;
			clear();
		};
		const clear = () => {
			if (this.pressTimer) clearTimeout(this.pressTimer);
			this.pressTimer = null;
			window.removeEventListener('pointermove', cancel);
			window.removeEventListener('pointerup', clear);
			window.removeEventListener('pointercancel', clear);
		};
		window.addEventListener('pointermove', cancel);
		window.addEventListener('pointerup', clear);
		window.addEventListener('pointercancel', clear);
		this.pressTimer = setTimeout(() => {
			clear();
			this.startDrag(item, e, this.view.dom);
		}, LONG_PRESS_MS);
	};

	private startDrag(item: Item, e: PointerEvent, capture: Element) {
		const touch = e.pointerType !== 'mouse';
		this.drag = {
			item,
			pointerId: e.pointerId,
			touch,
			target: null,
			originX: e.clientX,
			originY: e.clientY,
			moved: false,
			x: e.clientX,
			y: e.clientY
		};
		this.view.dispatch(this.view.state.tr.setMeta(dragKey, item.pos));
		this.host.classList.add('list-dragging');
		// The press landed inside contenteditable, so the browser has put a caret
		// in the row and raised the on-screen keyboard. Once the row is airborne
		// that caret is neither wanted nor reachable — drop focus so the keyboard
		// goes away and the drag has the screen to itself.
		if (touch) this.view.dom.blur();
		try {
			capture.setPointerCapture(e.pointerId);
		} catch {
			/* capture is a nicety; the window listeners carry the drag regardless */
		}
		window.addEventListener('pointermove', this.onDragMove);
		window.addEventListener('pointerup', this.onDragUp);
		window.addEventListener('pointercancel', this.onDragCancel);
		window.addEventListener('keydown', this.onDragKey, true);
		this.scrollFrame = requestAnimationFrame(this.autoScroll);
		// deliberately no trackTarget here: a target armed on press alone turns a
		// plain click on the grip into a move the user never asked for
	}

	private onDragMove = (e: PointerEvent) => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		this.drag.x = e.clientX;
		this.drag.y = e.clientY;
		if (!this.drag.moved) {
			const { originX, originY } = this.drag;
			if (Math.hypot(e.clientX - originX, e.clientY - originY) < DRAG_SLOP) return;
			this.drag.moved = true;
		}
		this.trackTarget(e.clientX, e.clientY);
	};

	private onDragUp = (e: PointerEvent) => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		this.endDrag(true);
	};

	private onDragCancel = () => this.endDrag(false);

	private onDragKey = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		this.endDrag(false);
	};

	private onTouchMove = (e: TouchEvent) => {
		if (this.drag) e.preventDefault();
	};

	// Resolve the row under the pointer, pick the nearer of its two edges, and
	// park the indicator there. An illegal drop clears the target so releasing
	// is a no-op rather than a surprise.
	private trackTarget(x: number, y: number) {
		if (!this.drag) return;
		this.drag.x = x;
		this.drag.y = y;
		// A drag wanders outside the text column — into the grip's own gutter, off
		// to the right, past the top or bottom — and posAtCoords answers null for
		// anything off the editor. Clamping into the box keeps the row under the
		// pointer's line resolvable wherever the pointer actually is.
		const { left, right, top, bottom } = this.view.dom.getBoundingClientRect();
		const px = Math.min(Math.max(x, left + 1), right - 1);
		const py = Math.min(Math.max(y, top + 1), bottom - 1);
		let over = itemFromCoords(this.view, px, py);
		let dom = over && itemDOM(this.view, over);
		if (!over || !dom) {
			// past the ends of the list, or out over the empty space the editor
			// reserves below the text — snap to whichever row is closest
			const near = this.nearestRow(py);
			if (!near) return this.clearTarget();
			over = near.item;
			dom = near.dom;
		}

		const rect = lineRect(dom);
		const after = py > rect.top + rect.height / 2;
		const insertPos = after ? over.pos + over.node.nodeSize : over.pos;
		if (!canDrop(this.view.state, this.drag.item, insertPos)) return this.clearTarget();

		this.drag.target = insertPos;
		const settled = this.indicator.classList.contains('visible');
		this.indicator.style.transition = settled ? '' : 'none';
		const hostRect = this.host.getBoundingClientRect();
		const box = dom.getBoundingClientRect();
		this.indicator.style.left = `${box.left - hostRect.left}px`;
		this.indicator.style.width = `${box.width}px`;
		this.indicator.style.top = `${(after ? rect.bottom : rect.top) - hostRect.top}px`;
		this.indicator.classList.add('visible');
		if (!settled) {
			void this.indicator.offsetWidth; // place it, then let it glide between targets
			this.indicator.style.transition = '';
		}
	}

	// Only walked when the pointer resolves to no row at all, so the cost of
	// measuring every row stays off the common path.
	private nearestRow(py: number): { item: Item; dom: HTMLElement } | null {
		const rows: { item: Item; dom: HTMLElement; dist: number }[] = [];
		this.view.state.doc.descendants((node, pos) => {
			if (!ITEM_TYPES.has(node.type.name)) return true;
			const dom = this.view.nodeDOM(pos);
			if (!(dom instanceof HTMLElement)) return true;
			const item = itemAt(this.view.state, pos + 1);
			if (!item) return true;
			const r = lineRect(dom);
			rows.push({ item, dom, dist: py < r.top ? r.top - py : Math.max(py - r.bottom, 0) });
			return true;
		});
		if (!rows.length) return null;
		return rows.reduce((closest, row) => (row.dist < closest.dist ? row : closest));
	}

	private clearTarget() {
		if (this.drag) this.drag.target = null;
		this.indicator.classList.remove('visible');
	}

	// Keep dragging usable in a document taller than the viewport.
	private autoScroll = () => {
		if (!this.drag) return;
		const { y } = this.drag;
		const dy =
			y < AUTOSCROLL_EDGE
				? -AUTOSCROLL_STEP
				: y > window.innerHeight - AUTOSCROLL_EDGE
					? AUTOSCROLL_STEP
					: 0;
		if (dy && this.drag.moved) {
			window.scrollBy(0, dy);
			this.trackTarget(this.drag.x, this.drag.y);
		}
		this.scrollFrame = requestAnimationFrame(this.autoScroll);
	};

	private endDrag(commit: boolean) {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
		this.scrollFrame = null;
		window.removeEventListener('pointermove', this.onDragMove);
		window.removeEventListener('pointerup', this.onDragUp);
		window.removeEventListener('pointercancel', this.onDragCancel);
		window.removeEventListener('keydown', this.onDragKey, true);
		this.host.classList.remove('list-dragging');
		if (dragKey.getState(this.view.state) != null) {
			this.view.dispatch(this.view.state.tr.setMeta(dragKey, null));
		}
		this.indicator.classList.remove('visible');
		this.handle.classList.remove('visible');
		this.hovered = null;

		if (
			commit &&
			drag.moved &&
			drag.target !== null &&
			canDrop(this.view.state, drag.item, drag.target)
		) {
			moveItem(this.view, drag.item, drag.target, 1);
			// refocusing after a touch drop would summon the keyboard again for a
			// gesture that was never about typing
			if (!drag.touch) this.view.focus();
		}
	}
}

export const ListDragHandle = Extension.create({
	name: 'listDragHandle',

	addKeyboardShortcuts() {
		return {
			'Mod-Shift-ArrowUp': () => moveBySibling(this.editor.view, -1),
			'Mod-Shift-ArrowDown': () => moveBySibling(this.editor.view, 1)
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin<number | null>({
				key: dragKey,
				view: (view) => new ListDragView(view),
				state: {
					init: () => null,
					apply: (tr, pos) => {
						const meta = tr.getMeta(dragKey);
						if (meta !== undefined) return meta as number | null;
						return pos === null ? null : tr.mapping.map(pos);
					}
				},
				props: {
					decorations(state) {
						const pos = dragKey.getState(state);
						if (pos == null) return null;
						const node = state.doc.nodeAt(pos);
						if (!node) return null;
						return DecorationSet.create(state.doc, [
							Decoration.node(pos, pos + node.nodeSize, { class: 'is-dragging' })
						]);
					}
				}
			})
		];
	}
});
