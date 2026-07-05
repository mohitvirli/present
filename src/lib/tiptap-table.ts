import { Extension } from '@tiptap/core';
import { Table, TableKit } from '@tiptap/extension-table';
import { columnResizing, tableEditing } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import type { Schema, Node as PMNode } from '@tiptap/pm/model';

// Upstream Table only installs columnResizing when the editor is editable *at
// creation time* — our entry editor is created read-only and flipped editable
// later, so resizing never activated. Install the plugin unconditionally; its
// own handlers check view.editable on every event, so it stays inert while
// viewing.
const ResizableTable = Table.extend({
	addProseMirrorPlugins() {
		return [
			columnResizing({
				handleWidth: this.options.handleWidth,
				cellMinWidth: this.options.cellMinWidth,
				defaultCellMinWidth: this.options.cellMinWidth,
				View: this.options.View,
				lastColumnResizable: this.options.lastColumnResizable
			}),
			tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection })
		];
	}
});

// Editor: interactive tables with draggable column resizing. TableKit still
// provides row/header/cell; the table node itself comes from ResizableTable.
export const Tables = [
	TableKit.configure({ table: false }),
	ResizableTable.configure({ resizable: true })
];

// Static render (generateHTML): plugins/NodeViews never run there, so plain
// TableKit is enough — the schema (and the colwidth attr that renderHTML
// turns into a <colgroup>) is identical, keeping resized widths in previews.
export const TablesStatic = TableKit;

// A pipe row: starts and ends with |, at least 2 cells, not all empty,
// and not a `|---|---|` separator-only row. Typography rewrites typed `--`
// into –/— before we ever see the text, so those count as dashes too.
function parsePipeRow(text: string): string[] | null {
	const t = text.trim();
	if (!/^\|.*\|$/.test(t)) return null;
	const cells = t
		.slice(1, -1)
		.split('|')
		.map((c) => c.trim());
	if (cells.length < 2) return null;
	if (cells.every((c) => c === '')) return null;
	if (cells.every((c) => /^:?[-–—]+:?$/.test(c))) return null;
	return cells;
}

function buildTable(schema: Schema, cells: string[]): PMNode {
	const { table, tableRow, tableHeader, tableCell, paragraph } = schema.nodes;
	const headerRow = tableRow.create(
		null,
		cells.map((text) =>
			tableHeader.create(null, paragraph.create(null, text ? schema.text(text) : null))
		)
	);
	const bodyRow = tableRow.create(
		null,
		cells.map(() => tableCell.create(null, paragraph.create()))
	);
	return table.create(null, [headerRow, bodyRow]);
}

// Backspace inside a completely empty table deletes the whole table — the
// inverse of the pipe-row gesture, so a table can be removed the same way it
// was created, without reaching for a menu. Only fires when every cell is
// empty, so no content can be lost.
export const TableBackspaceDelete = Extension.create({
	name: 'tableBackspaceDelete',
	priority: 1000,

	addKeyboardShortcuts() {
		return {
			Backspace: () => {
				const { $from, empty } = this.editor.state.selection;
				if (!empty || $from.parentOffset !== 0) return false;
				let tableDepth = 0;
				for (let d = $from.depth; d > 0; d--) {
					if ($from.node(d).type.name === 'table') {
						tableDepth = d;
						break;
					}
				}
				if (!tableDepth) return false;
				if ($from.node(tableDepth).textContent !== '') return false;
				return this.editor.commands.deleteTable();
			}
		};
	}
});

// Markdown-style table creation: typing `| a | b |` and pressing Enter turns
// the paragraph into a table with those header cells and one empty body row —
// the same gesture feel as `# `, `- ` and `[ ]`. Every guard returns false so
// a non-matching Enter falls through to the default keymap untouched.
export const TablePipeRow = Extension.create({
	name: 'tablePipeRow',
	priority: 1000,

	addKeyboardShortcuts() {
		return {
			Enter: () => {
				const { state, view } = this.editor;
				const { $from, empty } = state.selection;
				if (!empty) return false;
				// Top-level paragraph only — excludes code blocks, table cells,
				// lists and blockquotes in one check.
				if ($from.depth !== 1 || $from.parent.type.name !== 'paragraph') return false;
				if ($from.parentOffset !== $from.parent.content.size) return false;
				const cells = parsePipeRow($from.parent.textContent);
				if (!cells) return false;

				const from = $from.before(1);
				const to = $from.after(1);
				const tableNode = buildTable(state.schema, cells);
				const tr = state.tr.replaceRangeWith(from, to, tableNode);
				// into table (+1), past the header row, into body row + first
				// cell + its paragraph (+3)
				const cursor = from + 1 + tableNode.child(0).nodeSize + 3;
				tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)));
				view.dispatch(tr.scrollIntoView());
				return true;
			}
		};
	}
});
