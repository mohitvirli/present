import { Node, mergeAttributes } from '@tiptap/core';
import { tagStyle } from './tag-color';

// A tag *reference* — the inline twin of `dateRef` (tiptap-date.ts).
//
// Inserted by the `#` menu (tiptap-tag-menu.ts), which also mirrors the tag into
// the entry's chip list. Only the label is stored; the swatch is recomputed on
// every render from tagSwatch(), so a chip in prose and the same chip in the
// Context header always agree — and both recolor on a theme switch.
export const TagRef = Node.create({
	name: 'tagRef',
	group: 'inline',
	inline: true,
	atom: true, // one indivisible chip — backspace removes the whole thing
	selectable: true,

	addAttributes() {
		return {
			tag: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute('data-tag-ref'),
				renderHTML: (attributes: Record<string, unknown>) =>
					attributes.tag ? { 'data-tag-ref': attributes.tag } : {}
			}
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-tag-ref]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const tag = String(node.attrs.tag ?? '');
		return [
			'span',
			mergeAttributes(HTMLAttributes, { class: 'tag-ref', style: tagStyle(tag) }),
			`#${tag}`
		];
	},

	// getText() and clipboard copy would otherwise see an empty gap where the
	// chip sits — hand them the same label the reader sees.
	renderText({ node }) {
		return `#${node.attrs.tag ?? ''}`;
	}
});
