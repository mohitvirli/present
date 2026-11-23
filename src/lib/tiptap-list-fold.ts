import { Extension } from '@tiptap/core';
import {
	Plugin,
	PluginKey,
	TextSelection,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// Outliner-style folding for list rows: a row with a nested list gets a caret
// in (or beside) its marker, and folding it hides the sublist. While editing,
// the state is a node attribute (`collapsed`), so a fold survives a reload and
// follows the entry to other devices, the way an outliner keeps it.
//
// A read-only view can't write to the entry, so folding there is a view-only
// override held in plugin state: it starts from the saved folds, never touches
// the document, and is dropped once the view becomes editable again.

const ITEM_TYPES = ['listItem', 'taskItem'];
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

type FoldState = {
	decos: DecorationSet;
	/** read-only folds, by row position: wins over the row's own attribute */
	overrides: Map<number, boolean>;
};
type FoldMeta = { set: [number, boolean] } | { clear: true };

const foldKey = new PluginKey<FoldState>('listFold');

function isCollapsed(state: EditorState, pos: number, node: PMNode): boolean {
	return foldKey.getState(state)?.overrides.get(pos) ?? !!node.attrs.collapsed;
}

// A row only folds when there is something under it to hide.
function hasSublist(node: PMNode): boolean {
	for (let i = 1; i < node.childCount; i++) {
		if (LIST_TYPES.has(node.child(i).type.name)) return true;
	}
	return false;
}

function isItem(node: PMNode) {
	return ITEM_TYPES.includes(node.type.name);
}

// Innermost list row around the selection that can fold, or null.
function foldableAtSelection(state: EditorState): { pos: number; node: PMNode } | null {
	const { $from } = state.selection;
	for (let d = $from.depth; d > 0; d--) {
		const node = $from.node(d);
		if (isItem(node) && hasSublist(node)) return { pos: $from.before(d), node };
	}
	return null;
}

function setCollapsed(tr: Transaction, pos: number, node: PMNode, collapsed: boolean) {
	tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed });
	// Folding is how you look at the outline, not an edit to it — keep it out of
	// undo so Cmd+Z goes back to the last thing actually written.
	tr.setMeta('addToHistory', false);
	return tr;
}

// Changing the attribute makes ProseMirror redraw the row, so the caret is a
// brand-new element afterwards and a CSS transition has nothing to run from.
// The row just toggled is remembered briefly; its new caret plays the turn as
// a keyframe instead. Everything else (page load, remote edits) draws still.
let lastToggle: { pos: number; at: number } | null = null;

function toggle(view: EditorView, pos: number, collapsed?: boolean) {
	const node = view.state.doc.nodeAt(pos);
	if (!node || !isItem(node) || !hasSublist(node)) return false;
	const current = isCollapsed(view.state, pos, node);
	const next = collapsed ?? !current;
	if (next === current) return true;
	lastToggle = { pos, at: performance.now() };

	if (!view.editable) {
		const meta: FoldMeta = { set: [pos, next] };
		view.dispatch(view.state.tr.setMeta(foldKey, meta));
		return true;
	}

	const tr = setCollapsed(view.state.tr, pos, node, next);

	// A caret inside the part being hidden would be typing into nothing, so it
	// moves up to the end of the row's own first line.
	if (next) {
		const { from } = view.state.selection;
		const firstEnd = pos + 1 + node.child(0).nodeSize;
		if (from >= firstEnd && from < pos + node.nodeSize) {
			tr.setSelection(TextSelection.near(tr.doc.resolve(firstEnd - 1), -1));
		}
	}
	view.dispatch(tr);
	return true;
}

function itemPosAround(view: EditorView, at: number): number | null {
	const $at = view.state.doc.resolve(at);
	for (let d = $at.depth; d > 0; d--) {
		if (isItem($at.node(d))) return $at.before(d);
	}
	return null;
}

const CARET =
	'<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
	'<path d="M2.5 3.75 5 6.25 7.5 3.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
	'</svg>';

// The toggle. On a bullet row it takes the bullet's place outright — a caret
// instead of a dot; numbered and todo rows keep their number or checkbox and
// get the same caret beside it.
function foldButton(
	view: EditorView,
	getPos: () => number | undefined,
	collapsed: boolean,
	bullet: boolean
) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = bullet ? 'list-fold list-fold--bullet' : 'list-fold list-fold--chevron';
	btn.contentEditable = 'false';
	btn.tabIndex = -1;
	btn.setAttribute('aria-expanded', String(!collapsed));
	btn.setAttribute('aria-label', collapsed ? 'Expand nested items' : 'Collapse nested items');
	btn.innerHTML = CARET;
	const at = getPos();
	if (
		lastToggle &&
		at != null &&
		lastToggle.pos === at - 1 &&
		performance.now() - lastToggle.at < 300
	) {
		btn.classList.add('is-turning');
	}
	// mousedown would move the caret into the row and blur nothing useful
	btn.addEventListener('mousedown', (e) => e.preventDefault());
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const at = getPos();
		// the widget sits at the row's content start, one inside the row itself
		const item = at == null ? null : itemPosAround(view, at);
		if (item != null) toggle(view, item);
	});
	return btn;
}

// How many rows a fold is holding, at any depth.
function hiddenCount(node: PMNode): number {
	let n = 0;
	node.forEach((child, _o, i) => {
		if (i === 0) return;
		child.descendants((d) => {
			if (isItem(d)) n++;
			return true;
		});
	});
	return n;
}

// The tag after a folded row's text saying there's more under it. Clicking it
// opens the fold, same as the caret.
function moreTag(view: EditorView, getPos: () => number | undefined, count: number) {
	const tag = document.createElement('button');
	tag.type = 'button';
	tag.className = 'list-fold-more';
	tag.contentEditable = 'false';
	tag.tabIndex = -1;
	tag.textContent = `+${count}`;
	tag.setAttribute('aria-label', `Show ${count} hidden ${count === 1 ? 'item' : 'items'}`);
	tag.addEventListener('mousedown', (e) => e.preventDefault());
	tag.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const at = getPos();
		const item = at == null ? null : itemPosAround(view, at);
		if (item != null) toggle(view, item, false);
	});
	return tag;
}

function buildDecorations(doc: PMNode, overrides: Map<number, boolean>): DecorationSet {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!isItem(node) || !hasSublist(node)) return true;
		const override = overrides.get(pos);
		const collapsed = override ?? !!node.attrs.collapsed;
		// A read-only fold restyles the row through an attribute of its own.
		// Overwriting data-collapsed instead would not survive the override being
		// dropped: ProseMirror removes a decoration's attribute outright, taking
		// the row's own saved value with it.
		if (override != null) {
			decos.push(
				Decoration.node(pos, pos + node.nodeSize, { 'data-fold': override ? 'closed' : 'open' })
			);
		}
		const bullet = doc.resolve(pos).parent.type.name === 'bulletList';
		decos.push(
			Decoration.widget(pos + 1, (view, getPos) => foldButton(view, getPos, collapsed, bullet), {
				side: -1,
				ignoreSelection: true,
				stopEvent: () => true,
				// a new key per state, so the button is rebuilt with the right label
				key: `fold-${bullet ? 'b' : 'v'}-${collapsed ? 'c' : 'o'}`
			})
		);
		if (collapsed) {
			const count = hiddenCount(node);
			// inside the row's first block, after its last character; side 1 keeps
			// a caret typed at the end of the line in front of the tag
			const end = pos + 1 + node.child(0).nodeSize - 1;
			decos.push(
				Decoration.widget(end, (view, getPos) => moreTag(view, getPos, count), {
					side: 1,
					ignoreSelection: true,
					stopEvent: () => true,
					key: `more-${count}`
				})
			);
		}
		return true;
	});
	return DecorationSet.create(doc, decos);
}

// Enter at the end of a folded row. Left to the list's own split, the hidden
// children would move into the new blank row and the fold would be lost; an
// outliner instead starts the next sibling below the whole folded subtree.
function newRowAfterFold(view: EditorView): boolean {
	const { selection, schema } = view.state;
	if (!selection.empty) return false;
	const { $from } = selection;
	if ($from.parentOffset !== $from.parent.content.size) return false;
	const d = $from.depth - 1;
	if (d < 1) return false;
	const item = $from.node(d);
	if (!isItem(item) || !item.attrs.collapsed || $from.index(d) !== 0) return false;

	const paragraph = schema.nodes.paragraph;
	const attrs = item.type.name === 'taskItem' ? { checked: false } : null;
	const row = item.type.createAndFill(attrs, paragraph.create());
	if (!row) return false;
	const at = $from.after(d);
	const tr = view.state.tr.insert(at, row);
	tr.setSelection(TextSelection.create(tr.doc, at + 2));
	view.dispatch(tr.scrollIntoView());
	return true;
}

export const ListFold = Extension.create({
	name: 'listFold',
	// ahead of the list items' own Enter, which would split the folded row
	priority: 200,

	addGlobalAttributes() {
		return [
			{
				types: ITEM_TYPES,
				attributes: {
					collapsed: {
						default: false,
						// a row split off a folded one starts open
						keepOnSplit: false,
						parseHTML: (el) => el.getAttribute('data-collapsed') === 'true',
						renderHTML: (attrs) => (attrs.collapsed ? { 'data-collapsed': 'true' } : {})
					}
				}
			}
		];
	},

	addKeyboardShortcuts() {
		// Outliner keys: fold and unfold the row under the caret. Outside a
		// foldable row they fall through to the usual jump to top / bottom.
		const fold = (collapsed: boolean) => () => {
			const found = foldableAtSelection(this.editor.state);
			if (!found || isCollapsed(this.editor.state, found.pos, found.node) === collapsed)
				return false;
			return toggle(this.editor.view, found.pos, collapsed);
		};
		return {
			Enter: () => newRowAfterFold(this.editor.view),
			'Mod-ArrowUp': fold(true),
			'Mod-ArrowDown': fold(false)
		};
	},

	addProseMirrorPlugins() {
		// Mirrors view.editable for appendTransaction, which only sees state. In a
		// read-only view nothing here may write to the document — the entry would
		// save a change nobody made.
		let editable = true;

		return [
			new Plugin<FoldState>({
				key: foldKey,
				state: {
					init: (_, state) => ({
						decos: buildDecorations(state.doc, new Map()),
						overrides: new Map()
					}),
					apply: (tr, prev) => {
						const meta = tr.getMeta(foldKey) as FoldMeta | undefined;
						if (!tr.docChanged && !meta) return prev;
						let overrides = prev.overrides;
						if (tr.docChanged && overrides.size) {
							const mapped = new Map<number, boolean>();
							for (const [pos, v] of overrides) {
								const r = tr.mapping.mapResult(pos, 1);
								if (!r.deleted) mapped.set(r.pos, v);
							}
							overrides = mapped;
						}
						if (meta && 'clear' in meta) overrides = new Map();
						else if (meta) overrides = new Map(overrides).set(...meta.set);
						return { decos: buildDecorations(tr.doc, overrides), overrides };
					}
				},
				props: {
					decorations: (state) => foldKey.getState(state)?.decos
				},
				view: (view) => {
					editable = view.editable;
					return {
						update: (view) => {
							editable = view.editable;
							// back in edit mode, the attributes are the truth again
							if (editable && foldKey.getState(view.state)?.overrides.size) {
								const meta: FoldMeta = { clear: true };
								queueMicrotask(() => view.dispatch(view.state.tr.setMeta(foldKey, meta)));
							}
						}
					};
				},
				appendTransaction(trs, _old, state) {
					if (!editable) return null;
					if (!trs.some((t) => t.docChanged || t.selectionSet)) return null;
					let tr: Transaction | null = null;

					// A fold with nothing left under it would silently swallow the next
					// sublist made there, so it is dropped once the children are gone.
					if (trs.some((t) => t.docChanged)) {
						state.doc.descendants((node, pos) => {
							if (isItem(node) && node.attrs.collapsed && !hasSublist(node)) {
								tr = setCollapsed(tr ?? state.tr, pos, node, false);
							}
							return true;
						});
					}

					// The caret landed inside a folded part — arrow keys, undo, a jump
					// from search. Open the folds around it rather than leave it hidden.
					const { $from } = state.selection;
					for (let d = $from.depth; d > 0; d--) {
						const node = $from.node(d);
						if (isItem(node) && node.attrs.collapsed && $from.index(d) > 0) {
							tr = setCollapsed(tr ?? state.tr, $from.before(d), node, false);
						}
					}
					return tr;
				}
			})
		];
	}
});
