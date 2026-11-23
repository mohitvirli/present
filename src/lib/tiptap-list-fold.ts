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

// Outliner-style folding for list rows: a row with a nested list gets a chevron
// beside its marker, and folding it hides the sublist. The state is a node
// attribute (`collapsed`) rather than view-only state, so a fold survives a
// reload and follows the entry to other devices, the way an outliner keeps it.

const ITEM_TYPES = ['listItem', 'taskItem'];
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

const foldKey = new PluginKey<DecorationSet>('listFold');

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

function toggle(view: EditorView, pos: number, collapsed?: boolean) {
	const node = view.state.doc.nodeAt(pos);
	if (!node || !isItem(node) || !hasSublist(node)) return false;
	const next = collapsed ?? !node.attrs.collapsed;
	if (next === !!node.attrs.collapsed) return true;
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

function chevron(view: EditorView, getPos: () => number | undefined, collapsed: boolean) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'list-fold';
	btn.contentEditable = 'false';
	btn.tabIndex = -1;
	btn.setAttribute('aria-expanded', String(!collapsed));
	btn.setAttribute('aria-label', collapsed ? 'Expand nested items' : 'Collapse nested items');
	btn.innerHTML =
		'<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
		'<path d="M2.5 3.75 5 6.25 7.5 3.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>';
	// mousedown would move the caret into the row and blur nothing useful
	btn.addEventListener('mousedown', (e) => e.preventDefault());
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const at = getPos();
		if (at == null) return;
		// the widget sits at the row's content start, one inside the row itself
		const $at = view.state.doc.resolve(at);
		for (let d = $at.depth; d > 0; d--) {
			if (isItem($at.node(d))) {
				toggle(view, $at.before(d));
				break;
			}
		}
	});
	return btn;
}

function buildDecorations(doc: PMNode): DecorationSet {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!isItem(node) || !hasSublist(node)) return true;
		const collapsed = !!node.attrs.collapsed;
		decos.push(
			Decoration.widget(pos + 1, (view, getPos) => chevron(view, getPos, collapsed), {
				side: -1,
				ignoreSelection: true,
				stopEvent: () => true,
				// a new key per state, so the button is rebuilt with the right label
				key: `fold-${collapsed ? 'c' : 'o'}`
			})
		);
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
			if (!found || !!found.node.attrs.collapsed === collapsed) return false;
			return toggle(this.editor.view, found.pos, collapsed);
		};
		return {
			Enter: () => newRowAfterFold(this.editor.view),
			'Mod-ArrowUp': fold(true),
			'Mod-ArrowDown': fold(false)
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin<DecorationSet>({
				key: foldKey,
				state: {
					init: (_, state) => buildDecorations(state.doc),
					apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old)
				},
				props: {
					decorations: (state) => foldKey.getState(state)
				},
				appendTransaction(trs, _old, state) {
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
