import { Extension, Mark, InputRule, mergeAttributes } from '@tiptap/core';

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

// Sibling of QuirkTime for the `@date` shorthand. Same non-inclusive behaviour;
// distinct tag/class so it can carry its own styling if it ever diverges.
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

// Edit quirks: typed shorthands that expand inline. `@time` -> current time and
// `@date` -> today's date, each applied with its own mark. The rule fires the
// moment the trailing character lands. Add more quirks to the array as the set
// grows.
export const Quirks = Extension.create({
	name: 'quirks',
	addInputRules() {
		const timeMark = this.editor.schema.marks.quirkTime;
		const dateMark = this.editor.schema.marks.quirkDate;
		return [
			new InputRule({
				find: /@time$/,
				handler: ({ range, chain }) => {
					const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
					chain()
						.deleteRange(range)
						.insertContent({
							type: 'text',
							text: now,
							marks: [{ type: timeMark.name }]
						})
						.run();
				}
			}),
			new InputRule({
				find: /@date$/,
				handler: ({ range, chain }) => {
					const today = new Date().toLocaleDateString([], {
						weekday: 'short',
						month: 'short',
						day: 'numeric'
					});
					chain()
						.deleteRange(range)
						.insertContent({
							type: 'text',
							text: today,
							marks: [{ type: dateMark.name }]
						})
						.run();
				}
			})
		];
	}
});
