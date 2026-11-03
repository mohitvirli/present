import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { monthName, type RecapStats } from './recap';

// The stats card at the top of a monthly recap letter — a block atom carrying
// the figures as one attribute. Counted on-device when the letter is written
// (recap.ts) and frozen there; the card is read-only, so backspace removes it
// whole rather than letting a number be hand-edited into a lie.

const MOOD_ORDER = ['great', 'good', 'neutral', 'low', 'bad'] as const;

function figures(s: RecapStats): { n: number; of?: number; label: string }[] {
	return [
		{ n: s.daysWritten, of: s.daysInMonth, label: 'days written' },
		{ n: s.entries, label: s.entries === 1 ? 'entry' : 'entries' },
		{ n: s.words, label: 'words' },
		{ n: s.longestStreak, label: 'day streak' }
	];
}

// the sentence-ish lines under the figures — only what the month actually had
function lines(s: RecapStats): string[] {
	const out: string[] = [];
	const when = [
		s.timeOfDay && `Mostly ${s.timeOfDay}`,
		s.busiestWeekday && `${s.busiestWeekday}s were fullest`
	]
		.filter(Boolean)
		.join(' · ');
	if (when) out.push(when);
	const moods = MOOD_ORDER.filter((m) => s.moods[m]).map((m) => `${s.moods[m]} ${m}`);
	if (moods.length) out.push(`Moods: ${moods.join(', ')}`);
	if (s.topTags.length) out.push(`Most tagged: ${s.topTags.map((t) => `#${t.tag}`).join(' ')}`);
	if (s.newTags.length) out.push(`New this month: ${s.newTags.map((t) => `#${t}`).join(' ')}`);
	return out;
}

export function recapStatsSpec(s: RecapStats, attrs: Record<string, unknown> = {}): DOMOutputSpec {
	const spine: DOMOutputSpec[] = s.spine.map((t, i) => [
		'span',
		{ class: `spine-day${t ? ` t-${t}` : ''}`, title: `${monthName(s.month, 'short')} ${i + 1}` }
	]);
	const figs: DOMOutputSpec[] = figures(s).map((f) => [
		'div',
		{ class: 'recap-fig' },
		[
			'dd',
			{},
			['span', { class: 'recap-num', 'data-n': String(f.n) }, f.n.toLocaleString()],
			...(f.of ? [['span', { class: 'recap-of' }, ` / ${f.of}`] as DOMOutputSpec] : [])
		],
		['dt', {}, f.label]
	]);
	const extra: DOMOutputSpec[] = lines(s).map((l) => ['p', { class: 'recap-line' }, l]);
	return [
		'div',
		mergeAttributes(attrs, { class: 'recap-stats', contenteditable: 'false' }),
		['div', { class: 'recap-spine', 'aria-hidden': 'true' }, ...spine],
		['dl', { class: 'recap-figures' }, ...figs],
		...extra
	] as DOMOutputSpec;
}

export const RecapStatsNode = Node.create({
	name: 'recapStats',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			stats: {
				default: null,
				parseHTML: (el: HTMLElement) => {
					try {
						return JSON.parse(el.getAttribute('data-recap-stats') ?? 'null');
					} catch {
						return null;
					}
				},
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs.stats ? { 'data-recap-stats': JSON.stringify(attrs.stats) } : {}
			}
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-recap-stats]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const stats = node.attrs.stats as RecapStats | null;
		if (!stats) return ['div', mergeAttributes(HTMLAttributes, { class: 'recap-stats' })];
		return recapStatsSpec(stats, HTMLAttributes);
	}
});

// Plain-text form for markdown export.
export function recapStatsMarkdown(node: JSONContent): string {
	const s = node.attrs?.stats as RecapStats | undefined;
	if (!s) return '';
	const head = figures(s)
		.map((f) => `**${f.n.toLocaleString()}${f.of ? ` / ${f.of}` : ''}** ${f.label}`)
		.join(' · ');
	return [head, ...lines(s)].join('  \n');
}
