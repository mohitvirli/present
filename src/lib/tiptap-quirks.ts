import { Extension, Mark, InputRule, mergeAttributes } from '@tiptap/core';
import { relativeDayKey } from './day';

// Inline mark that styles inserted quirk text (e.g. expanded timestamps) so it
// reads as distinct from the surrounding prose. `inclusive: false` keeps the
// style from bleeding into whatever the user types next.
export const QuirkTime = Mark.create({
	name: 'quirkTime',
	inclusive: false,
	parseHTML() {
		return [{ tag: 'span[data-quirk="time"]' }];
	},
	renderHTML({ HTMLAttributes }) {
		return ['span', mergeAttributes(HTMLAttributes, { 'data-quirk': 'time', class: 'quirk-time' }), 0];
	}
});

// Sibling of QuirkTime, left over from when `@date` stamped a formatted string.
// Nothing writes this mark any more — `@date` now opens the picker and inserts a
// dateRef atom (tiptap-at-menu.ts) — but it stays registered because every entry
// written before that change still carries it, and dropping it from the schema
// makes generateHTML throw on those docs.
export const QuirkDate = Mark.create({
	name: 'quirkDate',
	inclusive: false,
	parseHTML() {
		return [{ tag: 'span[data-quirk="date"]' }];
	},
	renderHTML({ HTMLAttributes }) {
		return ['span', mergeAttributes(HTMLAttributes, { 'data-quirk': 'date', class: 'quirk-date' }), 0];
	}
});

// A shorthand only fires on a word boundary, so `me@today.com` stays an address
// instead of expanding mid-token. That boundary character is part of the match,
// so it has to be trimmed off the front of the replaced range or the expansion
// eats the space before it. Measured forward from `range.from` — counting back
// from `range.to` is off by one, because the character that triggered the rule
// is not in the document yet.
function shorthandRange(range: { from: number; to: number }, boundary: string) {
	return { from: range.from + boundary.length, to: range.to };
}

// Days each dated shorthand points at, relative to today.
const OFFSETS: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 };

// Edit quirks: typed shorthands that expand inline, the moment the trailing
// character lands.
//
// `@time` stamps the clock as styled text — a decoration, nothing reads it back.
// `@today` / `@tomorrow` / `@yesterday` insert a `dateRef` atom instead, which
// keeps the day machine-readable so the timeline can project it (see
// tiptap-date.ts).
//
// `@date` deliberately has no rule here: it has to stay un-expanded long enough
// for the `@` menu to offer the picker (tiptap-at-menu.ts). An input rule would
// fire on the final `e` and swallow the trigger before the menu ever saw it.
export const Quirks = Extension.create({
	name: 'quirks',
	addInputRules() {
		const timeMark = this.editor.schema.marks.quirkTime;
		return [
			new InputRule({
				find: /(^|[^\w@])@time$/,
				handler: ({ range, match, chain }) => {
					const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
					chain()
						.deleteRange(shorthandRange(range, match[1]))
						.insertContent({
							type: 'text',
							text: now,
							marks: [{ type: timeMark.name }]
						})
						.run();
				}
			}),
			new InputRule({
				find: /(^|[^\w@])@(today|tomorrow|yesterday)$/,
				handler: ({ range, match, chain }) => {
					const word = match[2];
					chain()
						.deleteRange(shorthandRange(range, match[1]))
						.insertContent({ type: 'dateRef', attrs: { day: relativeDayKey(OFFSETS[word]) } })
						.run();
				}
			})
		];
	}
});
