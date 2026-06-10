import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Keep the caret visible after Enter. ProseMirror's own scrollIntoView aligns
// the caret to the layout viewport — which, on mobile, can sit *behind* the
// soft keyboard. Here we measure against `visualViewport` (the real visible
// region) and the floating docks, then nudge the page so the new line lands
// comfortably above the keyboard.
const KEYBOARD_MARGIN = 32; // breathing room between caret and obstruction

function scrollCaretIntoView(view: EditorView) {
	if (!view.hasFocus()) return;
	const { from } = view.state.selection;
	let caret: { bottom: number };
	try {
		caret = view.coordsAtPos(from); // viewport (layout) coordinates
	} catch {
		return;
	}
	const vv = window.visualViewport;
	// bottom edge of the actually-visible area, in layout-viewport coords
	const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
	const limit = visibleBottom - KEYBOARD_MARGIN;
	if (caret.bottom > limit) {
		window.scrollBy({ top: caret.bottom - limit, behavior: 'smooth' });
	}
}

export const ScrollOnEnter = Extension.create({
	name: 'scrollOnEnter',
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleKeyDown(view, event) {
						// Let ProseMirror split the block first; scroll on the next
						// frame once the new line exists and layout has settled.
						if (event.key === 'Enter') {
							requestAnimationFrame(() => scrollCaretIntoView(view));
						}
						return false; // never swallow the key
					}
				}
			})
		];
	}
});
