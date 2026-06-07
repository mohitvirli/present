import { wrappingInputRule } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';

export { TaskList };

// Typing `[[]]` at the start of a line turns it into a checkbox todo. The
// built-in `[ ]` / `[x]` markdown shortcuts keep working too (parent rules).
const todoInputRegex = /^\s*\[\[\]\]$/;

export const TaskItemBracket = TaskItem.extend({
	addInputRules() {
		return [
			...(this.parent?.() ?? []),
			wrappingInputRule({ find: todoInputRegex, type: this.type })
		];
	}
});
