import { Node, mergeAttributes } from '@tiptap/core';
import { dateRefLabel } from './day';

// A date *reference* — an inline atom carrying a UTC day key.
//
// Unlike the `@time` quirk, which stamps a formatted string and forgets, this
// keeps the date machine-readable so the timeline can project it as a ghost
// entry on the day it points at. Only `day` is stored; the visible label is
// regenerated on every render (see dateRefLabel), so "Tomorrow" never rots.
export const DateRef = Node.create({
	name: 'dateRef',
	group: 'inline',
	inline: true,
	atom: true, // one indivisible chip — backspace removes the whole thing
	selectable: true,

	addAttributes() {
		return {
			day: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute('data-date-ref'),
				renderHTML: (attributes: Record<string, unknown>) =>
					attributes.day ? { 'data-date-ref': attributes.day } : {}
			}
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-date-ref]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, { class: 'date-ref' }),
			dateRefLabel(node.attrs.day)
		];
	},

	// getText() and clipboard copy would otherwise see an empty gap where the
	// chip sits — hand them the same label the reader sees.
	renderText({ node }) {
		return dateRefLabel(node.attrs.day);
	}
});
