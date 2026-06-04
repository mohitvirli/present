import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(md: string): string {
	// async:false forces sync string return (marked types are string | Promise<string>)
	const rawHtml = marked.parse(md, { async: false });
	return DOMPurify.sanitize(rawHtml);
}
