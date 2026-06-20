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

// Edit quirks: typed shorthands that expand inline. `@time` -> current time in
// the user's locale, applied with the QuirkTime mark. The rule fires the moment
// the trailing `e` lands. Add more quirks to the array as the set grows.
export const Quirks = Extension.create({
	name: 'quirks',
	addInputRules() {
		const timeMark = this.editor.schema.marks.quirkTime;
		return [
			new InputRule({
				find: /@time$/,
				handler: ({ range, chain }) => {
					const now = new Date().toLocaleTimeString();
					chain()
						.deleteRange(range)
						.insertContent({
							type: 'text',
							text: now,
							marks: [{ type: timeMark.name }]
						})
						.run();
				}
			})
		];
	}
});
