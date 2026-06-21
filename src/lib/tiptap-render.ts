import { generateHTML, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItemBracket } from './tiptap-task';
import { QuirkTime, QuirkDate } from './tiptap-quirks';

// Same schema the editor uses, so timeline previews render exactly as written
// (headings, lists, todos, links, marks, quirk timestamps) rather than
// flattened to plain text.
const RENDER_EXTENSIONS = [StarterKit, TaskList, TaskItemBracket, QuirkTime, QuirkDate];

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function renderEntryHTML(
	content: JSONContent | string | null | undefined,
	opts: { dropLeadingHeading?: boolean } = {}
): string {
	if (content == null) return '';
	// legacy plain/markdown entries — render as a single escaped paragraph
	if (typeof content === 'string') return content ? `<p>${escapeHtml(content)}</p>` : '';

	let doc = content;
	if (opts.dropLeadingHeading && Array.isArray(content.content) && content.content[0]?.type === 'heading') {
		doc = { ...content, content: content.content.slice(1) };
	}

	try {
		return generateHTML(doc, RENDER_EXTENSIONS);
	} catch {
		return '';
	}
}
