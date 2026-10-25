// ProseMirror JSON → Markdown, for the data export.
//
// TipTap ships generateHTML (tiptap-render.ts) and nothing for markdown, and a
// serializer dependency would be heavier than the walk below. The node set here
// mirrors RENDER_EXTENSIONS: if the timeline can render it, this must be able to
// write it out.
//
// Never throws and never drops an entry — an unknown node falls back to its own
// text content, because a slightly flattened paragraph beats a missing one in a
// file the user is keeping as a backup.

import type { JSONContent } from '@tiptap/core';
import { hasCoords, placeOf } from './place';

type Nodes = JSONContent[] | undefined;

// Marks that wrap their text, innermost first. `code` short-circuits: backticks
// win and emphasis inside them would be literal characters, not formatting.
function applyMarks(text: string, marks: JSONContent['marks']): string {
	if (!marks?.length || !text) return text;
	if (marks.some((m) => m.type === 'code')) return `\`${text}\``;
	let out = text;
	for (const mark of marks) {
		switch (mark.type) {
			case 'bold':
				out = `**${out}**`;
				break;
			case 'italic':
				out = `*${out}*`;
				break;
			case 'strike':
				out = `~~${out}~~`;
				break;
			case 'link': {
				const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
				out = href ? `[${out}](${href})` : out;
				break;
			}
			// quirkTime / quirkDate / textStyle / underline are presentational —
			// markdown has no equivalent, so the text passes through unwrapped
		}
	}
	return out;
}

function inline(nodes: Nodes): string {
	if (!nodes?.length) return '';
	let out = '';
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				out += applyMarks(node.text ?? '', node.marks);
				break;
			case 'hardBreak':
				// two trailing spaces: a line break inside one paragraph
				out += '  \n';
				break;
			case 'dateRef':
				// the chip stores a day key and regenerates its label; write the key,
				// which is what @-typing produces and what stays true next week
				out += `@${node.attrs?.day ?? ''}`;
				break;
			case 'tagRef':
				out += `#${node.attrs?.tag ?? ''}`;
				break;
			default:
				out += inline(node.content);
		}
	}
	return out;
}

function indent(text: string, pad: string): string {
	return text
		.split('\n')
		.map((line) => (line ? pad + line : line))
		.join('\n');
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

// A list item's own blocks, with everything after the first line aligned under
// the marker so nested lists and second paragraphs stay inside the item. A
// nested list hugs its parent item (no blank line), or markdown renders the
// whole list loose and every item grows a paragraph gap.
function listItem(node: JSONContent, marker: string): string {
	let body = '';
	for (const child of node.content ?? []) {
		const text = block(child);
		if (!text.trim()) continue;
		if (body) body += LIST_TYPES.has(child.type ?? '') ? '\n' : '\n\n';
		body += text;
	}
	const pad = ' '.repeat(marker.length);
	return marker + indent(body, pad).slice(pad.length);
}

function cell(node: JSONContent): string {
	// a cell is paragraphs; a pipe inside one would break the row
	return inline(node.content?.flatMap((p) => p.content ?? []))
		.replace(/\|/g, '\\|')
		.replace(/\n/g, ' ')
		.trim();
}

function table(node: JSONContent): string {
	const rows = (node.content ?? []).map((row) => (row.content ?? []).map(cell));
	if (!rows.length) return '';
	const width = Math.max(...rows.map((r) => r.length));
	const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
	const [head, ...rest] = rows.map(pad);
	const line = (r: string[]) => `| ${r.join(' | ')} |`;
	return [line(head), `| ${Array(width).fill('---').join(' | ')} |`, ...rest.map(line)].join('\n');
}

function block(node: JSONContent): string {
	switch (node.type) {
		case 'paragraph':
			return inline(node.content);
		case 'heading': {
			const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
			return `${'#'.repeat(level)} ${inline(node.content)}`;
		}
		case 'bulletList':
			return (node.content ?? []).map((item) => listItem(item, '- ')).join('\n');
		case 'orderedList': {
			const start = Number(node.attrs?.start ?? 1) || 1;
			return (node.content ?? []).map((item, i) => listItem(item, `${start + i}. `)).join('\n');
		}
		case 'taskList':
			return (node.content ?? [])
				.map((item) => listItem(item, item.attrs?.checked ? '- [x] ' : '- [ ] '))
				.join('\n');
		case 'blockquote':
			return indent(blocks(node.content).join('\n\n'), '> ').replace(/^> $/gm, '>');
		case 'codeBlock': {
			const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
			return `\`\`\`${lang}\n${inline(node.content)}\n\`\`\``;
		}
		case 'horizontalRule':
			return '***'; // not `---`, which would read as a frontmatter fence
		case 'table':
			return table(node);
		case 'listItem':
		case 'taskItem':
			// only reachable from a malformed doc — render it as a bullet anyway
			return listItem(node, '- ');
		default:
			return inline(node.content);
	}
}

function blocks(nodes: Nodes): string[] {
	return (nodes ?? []).map(block).filter((s) => s.trim() !== '');
}

export function renderEntryMarkdown(content: JSONContent | string | null | undefined): string {
	if (content == null) return '';
	// legacy plain/markdown entries are already text — but a bare `---` line in
	// one would read as the next entry's frontmatter fence, so rewrite it the way
	// horizontalRule is written
	if (typeof content === 'string') return content.trim().replace(/^[ \t]*---+[ \t]*$/gm, '***');
	try {
		return blocks(content.content).join('\n\n').trim();
	} catch {
		return '';
	}
}

// --- frontmatter --------------------------------------------------------------

function yamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function yamlLine(key: string, value: unknown): string | null {
	if (value == null || value === '' || value === false) return null;
	if (Array.isArray(value)) {
		const items = value.filter((v) => typeof v === 'string' && v.trim());
		return items.length ? `${key}: [${items.map(yamlString).join(', ')}]` : null;
	}
	if (typeof value === 'number') return Number.isFinite(value) ? `${key}: ${value}` : null;
	if (typeof value === 'boolean') return `${key}: true`;
	return `${key}: ${yamlString(String(value))}`;
}

function placeLines(raw: unknown): (string | null)[] {
	const p = placeOf(raw);
	if (!p) return [];
	return [
		yamlLine('location', p.name),
		yamlLine('area', p.area),
		hasCoords(p) ? `coords: [${p.lat}, ${p.lon}]` : null
	];
}

// Keys are omitted when absent, the same convention the stored metadata follows.
export function entryFrontmatter(meta: {
	title?: string;
	day: string;
	created: number;
	updated: number;
	[key: string]: unknown;
}): string {
	const lines = [
		yamlLine('title', meta.title),
		yamlLine('day', meta.day),
		yamlLine('created', new Date(meta.created).toISOString()),
		yamlLine('updated', new Date(meta.updated).toISOString()),
		yamlLine('tags', meta.tags),
		yamlLine('mood', meta.mood),
		...placeLines(meta.location),
		yamlLine('words', meta.wordCount),
		yamlLine('views', meta.views),
		yamlLine('pinned', meta.pinned),
		yamlLine('dates', meta.dates),
		yamlLine('aiSummary', meta.aiSummary),
		yamlLine('aiTags', meta.aiTags),
		yamlLine('aiEmotion', meta.aiEmotion),
		yamlLine('aiEmotion2', meta.aiEmotion2),
		yamlLine('aiTone', meta.aiTone),
		yamlLine('tutorial', meta.tutorial)
	].filter((l): l is string => l !== null);
	return lines.join('\n');
}
