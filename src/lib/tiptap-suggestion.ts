import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Inline ghost suggestion (Reflection mode): renders a faded follow-up question
// at the caret. Tab accepts it as a prompt to answer; typing / caret move / Esc
// dismisses it. Set via tr.setMeta(suggestionKey, { pos, text }) or null to clear.

export const suggestionKey = new PluginKey<SuggestionState>('reflectSuggestion');
export type SuggestionState = { pos: number; text: string } | null;

export const SuggestionDecoration = Extension.create({
	name: 'reflectSuggestion',
	addProseMirrorPlugins() {
		return [
			new Plugin<SuggestionState>({
				key: suggestionKey,
				state: {
					init: () => null,
					apply(tr, value) {
						const meta = tr.getMeta(suggestionKey) as SuggestionState | undefined;
						if (meta !== undefined) return meta; // explicit set (or null to clear)
						if (value && (tr.docChanged || tr.selectionSet)) return null; // any edit/move dismisses
						return value;
					}
				},
				props: {
					decorations(state) {
						const s = suggestionKey.getState(state);
						if (!s) return null;
						const widget = Decoration.widget(
							s.pos,
							() => {
								const el = document.createElement('span');
								el.className = 'reflect-ghost';
								el.textContent = s.text;
								return el;
							},
							{ side: 1, key: 'reflect-ghost', ignoreSelection: true }
						);
						return DecorationSet.create(state.doc, [widget]);
					}
				}
			})
		];
	},

	addKeyboardShortcuts() {
		return {
			Tab: () => {
				const s = suggestionKey.getState(this.editor.state);
				if (!s) return false;
				const pos = s.pos;
				this.editor
					.chain()
					.command(({ tr }) => {
						tr.setMeta(suggestionKey, null);
						return true;
					})
					.insertContentAt(pos, [
						{
							type: 'blockquote',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: s.text.trim() }] }]
						},
						{ type: 'paragraph' }
					])
					.focus()
					.run();
				return true;
			},
			Escape: () => {
				const s = suggestionKey.getState(this.editor.state);
				if (!s) return false;
				this.editor.view.dispatch(this.editor.state.tr.setMeta(suggestionKey, null));
				return true;
			}
		};
	}
});
