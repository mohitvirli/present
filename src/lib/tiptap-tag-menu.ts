import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { tagStyle } from './tag-color';

// The `#` menu: type `#` mid-prose and a popover offers every tag the journal
// already knows, newest query first. Picking one drops a `tagRef` chip in the
// text *and* mirrors the tag into the entry's chip list — so a tag can be
// written where it is meant rather than only in the Context header.
//
// Deliberately quiet: adding a tag from the body never opens the Context panel.
// The panel is for tags added there (see `openContext` in routes/entry).
//
// Same Plugin + PluginKey + widget-decoration shape as tiptap-at-menu.ts, and it
// borrows that menu's CSS (.at-anchor/.at-menu/.at-item) — the two popovers are
// the same object with different rows.

export type TagMenuState = {
	from: number; // document position of the '#'
	query: string; // what has been typed after it
	index: number; // highlighted row
} | null;

export const tagMenuKey = new PluginKey<TagMenuState>('tagMenu');

export type TagMenuOptions = {
	/** Known tags with their use counts, read fresh on every keystroke. */
	vocabulary: () => { tag: string; count: number }[];
	/** Tags already on this entry — shown as such, and re-picking one is a no-op. */
	current: () => string[];
	/** Mirror a picked tag into the entry's chip list. */
	onPick: (tag: string) => void;
};

// `#` only triggers on a word boundary, and never after another `#` — `## ` has
// to stay a markdown heading, and `C#5` stays a note name.
const TRIGGER = /(?:^|[^\w#])#([\w-]*)$/;

function scan(state: EditorState): { from: number; query: string } | null {
	const sel = state.selection;
	if (!sel.empty) return null;
	const $from = sel.$from;
	if (!$from.parent.isTextblock) return null;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
	const m = TRIGGER.exec(before);
	if (!m) return null;
	// A lone `#` at the start of a block is a half-typed markdown heading — hold
	// the menu back until a letter says otherwise, so `# ` never has a popover
	// over it and never has Enter stolen from it.
	if (!m[1] && before === '#') return null;
	return { from: $from.pos - m[1].length - 1, query: m[1] };
}

// --- items -------------------------------------------------------------------

type Item = {
	tag: string;
	hint: string;
	isNew: boolean;
};

// Prefix matches first — typing `w` should surface `work` before `homework` —
// then substring, then the escape hatch for a tag that doesn't exist yet.
function items(opts: TagMenuOptions, query: string): Item[] {
	const q = query.trim().toLowerCase();
	const have = new Set(opts.current().map((t) => t.toLowerCase()));
	const vocab = opts.vocabulary();
	const pool = q
		? [
				...vocab.filter((v) => v.tag.toLowerCase().startsWith(q)),
				...vocab.filter(
					(v) => !v.tag.toLowerCase().startsWith(q) && v.tag.toLowerCase().includes(q)
				)
			]
		: vocab;
	const list: Item[] = pool.slice(0, 12).map((v) => ({
		tag: v.tag,
		hint: have.has(v.tag.toLowerCase()) ? 'added' : String(v.count),
		isNew: false
	}));
	// an exact hit means the tag exists — no point offering to create it again
	if (q && !pool.some((v) => v.tag.toLowerCase() === q)) {
		list.push({ tag: query.trim(), hint: 'new tag', isNew: true });
	}
	return list;
}

// --- commands ----------------------------------------------------------------

function setState(editor: Editor, next: TagMenuState) {
	editor.view.dispatch(editor.state.tr.setMeta(tagMenuKey, next));
}

// Replace `#query` with the chip in one transaction, so a single undo puts the
// typed text back rather than stranding a half-eaten trigger.
function choose(editor: Editor, opts: TagMenuOptions, item: Item) {
	const s = tagMenuKey.getState(editor.state);
	if (!s) return;
	const to = editor.state.selection.from;
	editor
		.chain()
		.focus()
		.command(({ tr }) => {
			tr.setMeta(tagMenuKey, null);
			return true;
		})
		.deleteRange({ from: s.from, to })
		.insertContent({ type: 'tagRef', attrs: { tag: item.tag } })
		.run();
	opts.onPick(item.tag);
}

// --- rendering ---------------------------------------------------------------

function renderMenu(
	editor: Editor,
	opts: TagMenuOptions,
	s: NonNullable<TagMenuState>
): HTMLElement {
	// zero-size inline anchor: the popover is absolutely positioned inside it, so
	// it never reflows the line of prose it was triggered from
	const anchor = document.createElement('span');
	anchor.className = 'at-anchor';
	const menu = document.createElement('div');
	menu.className = 'at-menu tag-menu';
	menu.setAttribute('role', 'listbox');
	anchor.appendChild(menu);

	// mousedown default would blur the editor, dropping the selection the commit
	// needs — clicks still fire, the caret just never leaves
	menu.addEventListener('mousedown', (e) => e.preventDefault());

	items(opts, s.query).forEach((item, i) => {
		const row = document.createElement('button');
		row.type = 'button';
		row.className = i === s.index ? 'at-item active' : 'at-item';
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(i === s.index));
		const label = document.createElement('span');
		label.className = 'at-label tag-menu-label';
		// same swatch the chip gets, so a row and the tag it inserts match
		label.style.cssText = tagStyle(item.tag);
		label.textContent = `#${item.tag}`;
		const hint = document.createElement('span');
		hint.className = 'at-hint';
		hint.textContent = item.hint;
		row.append(label, hint);
		row.addEventListener('click', () => choose(editor, opts, item));
		menu.appendChild(row);
	});

	// clamp into the viewport once there is a box to measure
	requestAnimationFrame(() => {
		const r = menu.getBoundingClientRect();
		if (r.bottom > window.innerHeight - 8) menu.classList.add('flip');
		if (r.right > window.innerWidth - 8) menu.classList.add('shift');
		menu.querySelector('.at-item.active')?.scrollIntoView({ block: 'nearest' });
	});
	return anchor;
}

// --- extension ---------------------------------------------------------------

export const TagMenu = Extension.create<TagMenuOptions>({
	name: 'tagMenu',

	addOptions() {
		return {
			vocabulary: () => [],
			current: () => [],
			onPick: () => {}
		};
	},

	addProseMirrorPlugins() {
		const editor = this.editor;
		const opts = this.options;
		return [
			new Plugin<TagMenuState>({
				key: tagMenuKey,
				state: {
					init: () => null,
					apply(tr, value, _old, next) {
						// a read-only entry still takes selections, so clicking after a
						// literal "#work" in old prose would otherwise pop a menu the
						// reader cannot act on
						if (!editor.isEditable) return null;
						const meta = tr.getMeta(tagMenuKey) as TagMenuState | undefined;
						if (meta !== undefined) return meta; // explicit set (or null to close)
						if (!tr.docChanged && !tr.selectionSet) return value;
						const hit = scan(next);
						if (!hit) return null;
						// nothing to offer — a bare `#` in a journal with no tags yet, so
						// `# ` stays a heading with no popover flashing over it
						if (!items(opts, hit.query).length) return null;
						if (value && value.from === hit.from && value.query === hit.query) return value;
						return { from: hit.from, query: hit.query, index: 0 };
					}
				},
				props: {
					decorations(state) {
						const s = tagMenuKey.getState(state);
						if (!s) return null;
						const list = items(opts, s.query);
						const widget = Decoration.widget(
							state.selection.from,
							() => renderMenu(editor, opts, s),
							{
								side: 1,
								// key covers everything the DOM depends on, so ProseMirror
								// rebuilds the popover when — and only when — it changes.
								// The row count is in there because the vocabulary loads
								// async, after the menu can already be open.
								key: `tag-menu:${s.query}:${s.index}:${list.length}`,
								ignoreSelection: true,
								stopEvent: () => true
							}
						);
						return DecorationSet.create(state.doc, [widget]);
					}
				}
			})
		];
	},

	addKeyboardShortcuts() {
		const editor = this.editor;
		const opts = this.options;
		const state = () => tagMenuKey.getState(editor.state);

		const step = (delta: number) => () => {
			const s = state();
			if (!s) return false;
			const list = items(opts, s.query);
			if (!list.length) return false;
			setState(editor, { ...s, index: (s.index + delta + list.length) % list.length });
			return true;
		};

		return {
			ArrowDown: step(1),
			ArrowUp: step(-1),
			Enter: () => {
				const s = state();
				if (!s) return false;
				const list = items(opts, s.query);
				const item = list[Math.min(s.index, list.length - 1)];
				if (!item) return false;
				choose(editor, opts, item);
				return true;
			},
			Escape: () => {
				const s = state();
				if (!s) return false;
				setState(editor, null);
				return true;
			}
		};
	}
});
