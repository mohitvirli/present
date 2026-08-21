import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { dateRefLabel, dayKeyMedium, relativeDayKey, shiftDayKey } from './day';
import { DOW, monthCells, monthTitle, stepMonth } from './calendar';

// The `@` menu: type `@` and a small popover offers the dated shorthands plus a
// date picker. The typed shorthands in tiptap-quirks.ts stay the fast path —
// this is the discovery path, and the only way to reach a date that isn't
// today, tomorrow or yesterday.
//
// Hand-rolled rather than pulling in @tiptap/suggestion: the item list is five
// static entries with no async lookup, and this file is the same Plugin +
// PluginKey + widget-decoration shape as tiptap-suggestion.ts already uses.

export type AtMenuState = {
	from: number; // document position of the '@'
	query: string; // what has been typed after it
	index: number; // highlighted row in list mode
	picker: { cursor: string } | null; // open date picker, keyed by its focused day
} | null;

export const atMenuKey = new PluginKey<AtMenuState>('atMenu');

// `@` only triggers on a word boundary, so `me@today.com` stays an address —
// the same rule the typed shorthands follow.
const TRIGGER = /(?:^|[^\w@])@(\w*)$/;

function scan(state: EditorState): { from: number; query: string } | null {
	const sel = state.selection;
	if (!sel.empty) return null;
	const $from = sel.$from;
	if (!$from.parent.isTextblock) return null;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
	const m = TRIGGER.exec(before);
	if (!m) return null;
	return { from: $from.pos - m[1].length - 1, query: m[1] };
}

// --- items -------------------------------------------------------------------

type Item = {
	id: string;
	label: string;
	hint: string;
	insert: JSONContent | null; // null opens the picker instead of inserting
};

function dateNode(day: string): JSONContent {
	return { type: 'dateRef', attrs: { day } };
}

function nowTime(): string {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function items(): Item[] {
	const key = relativeDayKey;
	return [
		{ id: 'today', label: 'Today', hint: dayKeyMedium(key(0)), insert: dateNode(key(0)) },
		{ id: 'tomorrow', label: 'Tomorrow', hint: dayKeyMedium(key(1)), insert: dateNode(key(1)) },
		{ id: 'yesterday', label: 'Yesterday', hint: dayKeyMedium(key(-1)), insert: dateNode(key(-1)) },
		{ id: 'date', label: 'Pick a date…', hint: 'calendar', insert: null },
		{
			id: 'time',
			label: 'Time',
			hint: nowTime(),
			insert: { type: 'text', text: nowTime(), marks: [{ type: 'quirkTime' }] }
		}
	];
}

// Prefix match first — typing `t` should mean Today, not "anything with a t".
function filtered(query: string): Item[] {
	const all = items();
	const q = query.toLowerCase();
	if (!q) return all;
	const starts = all.filter((i) => i.id.startsWith(q));
	return starts.length ? starts : all.filter((i) => i.id.includes(q));
}

// --- commands ----------------------------------------------------------------

function setState(editor: Editor, next: AtMenuState) {
	editor.view.dispatch(editor.state.tr.setMeta(atMenuKey, next));
}

// Replace `@query` with the chosen content in one transaction, so a single
// undo puts the typed text back rather than stranding a half-eaten trigger.
function commit(editor: Editor, content: JSONContent) {
	const s = atMenuKey.getState(editor.state);
	if (!s) return;
	const to = editor.state.selection.from;
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.setMeta(atMenuKey, null);
			return true;
		})
		.deleteRange({ from: s.from, to })
		.insertContent(content)
		.run();
}

function choose(editor: Editor, item: Item) {
	const s = atMenuKey.getState(editor.state);
	if (!s) return;
	if (item.insert) commit(editor, item.insert);
	else setState(editor, { ...s, picker: { cursor: relativeDayKey(0) } });
}

function moveCursor(editor: Editor, next: string) {
	const s = atMenuKey.getState(editor.state);
	if (!s?.picker) return;
	setState(editor, { ...s, picker: { cursor: next } });
}

// Stepping a month has to clamp the day: 31 Aug + 1 month is 30 Sep, not the
// 31st of a month that has no 31st.
function cursorMonth(cursor: string, delta: number): string {
	const month = stepMonth(cursor.slice(0, 7), delta);
	const days = monthCells(month).filter(Boolean).length;
	const day = Math.min(Number(cursor.slice(8, 10)), days);
	return `${month}-${String(day).padStart(2, '0')}`;
}

// --- rendering ---------------------------------------------------------------

function renderList(menu: HTMLElement, editor: Editor, s: NonNullable<AtMenuState>) {
	const list = filtered(s.query);
	list.forEach((item, i) => {
		const row = document.createElement('button');
		row.type = 'button';
		row.className = i === s.index ? 'at-item active' : 'at-item';
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(i === s.index));
		const label = document.createElement('span');
		label.className = 'at-label';
		label.textContent = item.label;
		const hint = document.createElement('span');
		hint.className = 'at-hint';
		hint.textContent = item.hint;
		row.append(label, hint);
		row.addEventListener('click', () => choose(editor, item));
		menu.appendChild(row);
	});
}

function renderPicker(menu: HTMLElement, editor: Editor, cursor: string) {
	menu.classList.add('at-picker');
	const month = cursor.slice(0, 7);
	const today = relativeDayKey(0);

	const head = document.createElement('div');
	head.className = 'at-cal-head';
	const title = document.createElement('span');
	title.className = 'at-cal-title';
	title.textContent = monthTitle(month);
	const nav = document.createElement('span');
	nav.className = 'at-cal-nav';
	for (const [delta, label, glyph] of [
		[-1, 'Previous month', '‹'],
		[1, 'Next month', '›']
	] as const) {
		const b = document.createElement('button');
		b.type = 'button';
		b.setAttribute('aria-label', label);
		b.textContent = glyph;
		b.addEventListener('click', () => moveCursor(editor, cursorMonth(cursor, delta)));
		nav.appendChild(b);
	}
	head.append(title, nav);

	const grid = document.createElement('div');
	grid.className = 'at-cal-grid';
	DOW.forEach((d, i) => {
		const el = document.createElement('span');
		el.className = 'at-cal-dow';
		el.setAttribute('aria-hidden', 'true');
		el.textContent = d;
		el.dataset.i = String(i);
		grid.appendChild(el);
	});
	for (const cell of monthCells(month)) {
		if (!cell) {
			const blank = document.createElement('span');
			blank.className = 'at-cal-day blank';
			grid.appendChild(blank);
			continue;
		}
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'at-cal-day';
		if (cell.key === cursor) b.classList.add('active');
		if (cell.key === today) b.classList.add('today');
		b.textContent = String(cell.n);
		b.setAttribute('aria-label', dayKeyMedium(cell.key));
		b.addEventListener('click', () => commit(editor, dateNode(cell.key)));
		grid.appendChild(b);
	}

	const foot = document.createElement('div');
	foot.className = 'at-cal-foot';
	foot.textContent = `${dateRefLabel(cursor)} · enter to insert`;

	menu.append(head, grid, foot);
}

function renderMenu(editor: Editor, s: NonNullable<AtMenuState>): HTMLElement {
	// zero-size inline anchor: the popover is absolutely positioned inside it, so
	// it never reflows the line of prose it was triggered from
	const anchor = document.createElement('span');
	anchor.className = 'at-anchor';
	const menu = document.createElement('div');
	menu.className = 'at-menu';
	menu.setAttribute('role', 'listbox');
	anchor.appendChild(menu);

	// mousedown default would blur the editor, dropping the selection the commit
	// needs — clicks still fire, the caret just never leaves
	menu.addEventListener('mousedown', (e) => e.preventDefault());

	if (s.picker) renderPicker(menu, editor, s.picker.cursor);
	else renderList(menu, editor, s);

	// clamp into the viewport once there is a box to measure
	requestAnimationFrame(() => {
		const r = menu.getBoundingClientRect();
		if (r.bottom > window.innerHeight - 8) menu.classList.add('flip');
		if (r.right > window.innerWidth - 8) menu.classList.add('shift');
	});
	return anchor;
}

// --- extension ---------------------------------------------------------------

export const AtMenu = Extension.create({
	name: 'atMenu',

	addProseMirrorPlugins() {
		const editor = this.editor;
		return [
			new Plugin<AtMenuState>({
				key: atMenuKey,
				state: {
					init: () => null,
					apply(tr, value, _old, next) {
						// A read-only entry still takes selections, so clicking after a
						// literal "@today" in old prose would otherwise pop a menu the
						// reader cannot act on — and whose commit would try to write to a
						// document that isn't editable.
						if (!editor.isEditable) return null;
						const meta = tr.getMeta(atMenuKey) as AtMenuState | undefined;
						if (meta !== undefined) return meta; // explicit set (or null to close)
						if (!tr.docChanged && !tr.selectionSet) return value;
						// the picker is modal — arrow keys move its cursor without
						// touching the document, and must not re-trigger the scan
						if (value?.picker && !tr.docChanged) return value;
						const hit = scan(next);
						if (!hit) return null;
						if (!filtered(hit.query).length) return null; // typed past every item
						if (value && value.from === hit.from && value.query === hit.query) return value;
						// a changed query invalidates the highlight and closes the picker
						return { from: hit.from, query: hit.query, index: 0, picker: null };
					}
				},
				props: {
					decorations(state) {
						const s = atMenuKey.getState(state);
						if (!s) return null;
						const widget = Decoration.widget(state.selection.from, () => renderMenu(editor, s), {
							side: 1,
							// key covers everything the DOM depends on, so ProseMirror
							// rebuilds the popover when — and only when — it changes
							key: `at-menu:${s.query}:${s.index}:${s.picker?.cursor ?? ''}`,
							ignoreSelection: true,
							stopEvent: () => true
						});
						return DecorationSet.create(state.doc, [widget]);
					}
				}
			})
		];
	},

	// Tab is deliberately unbound — the reflection ghost owns it
	// (tiptap-suggestion.ts), and Enter is enough to commit.
	addKeyboardShortcuts() {
		const editor = this.editor;
		const state = () => atMenuKey.getState(editor.state);

		// list mode moves the highlight, picker mode walks the grid
		const step = (rows: number, days: number) => () => {
			const s = state();
			if (!s) return false;
			if (s.picker) {
				moveCursor(editor, shiftDayKey(s.picker.cursor, days));
				return true;
			}
			const list = filtered(s.query);
			if (!list.length) return false;
			setState(editor, { ...s, index: (s.index + rows + list.length) % list.length });
			return true;
		};

		// horizontal arrows only mean something to the grid; in list mode let the
		// caret move, which closes the menu on the next scan
		const day = (days: number) => () => {
			const s = state();
			if (!s?.picker) return false;
			moveCursor(editor, shiftDayKey(s.picker.cursor, days));
			return true;
		};

		return {
			ArrowDown: step(1, 7),
			ArrowUp: step(-1, -7),
			ArrowRight: day(1),
			ArrowLeft: day(-1),
			Enter: () => {
				const s = state();
				if (!s) return false;
				if (s.picker) {
					commit(editor, dateNode(s.picker.cursor));
					return true;
				}
				const list = filtered(s.query);
				const item = list[Math.min(s.index, list.length - 1)];
				if (!item) return false;
				choose(editor, item);
				return true;
			},
			Escape: () => {
				const s = state();
				if (!s) return false;
				// the picker steps back to the list rather than closing outright
				setState(editor, s.picker ? { ...s, picker: null } : null);
				return true;
			}
		};
	}
});
