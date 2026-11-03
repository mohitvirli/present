import type { JSONContent } from '@tiptap/core';
import { dayKeyOf } from './day';
import { extractText } from './tiptap';
import type { Entry, Mood } from './db';

// Monthly recap: a letter about a month, written from the full text of its
// entries and saved as an ordinary entry (editable, synced, encrypted). The
// numbers are counted here, on-device — the model only ever writes prose, so a
// figure in the stats card can never be made up.

export type Tone = 'positive' | 'neutral' | 'negative';

// one slot per day of the month: the day's tone, 'written' when there's an
// entry but no tone to colour it with, null when nothing was written
export type SpineDay = Tone | 'written' | null;

export interface RecapStats {
	month: string; // 'YYYY-MM' (UTC, like every day key)
	entries: number;
	daysWritten: number;
	daysInMonth: number;
	words: number;
	longestStreak: number;
	busiestWeekday?: string; // 'Sunday'
	timeOfDay?: 'mornings' | 'afternoons' | 'evenings' | 'late nights';
	moods: Partial<Record<Mood, number>>;
	topTags: { tag: string; count: number }[];
	newTags: string[]; // first used this month
	spine: SpineDay[];
}

// what /api/recap returns — prose only
export interface RecapLetter {
	title: string;
	opening: string;
	threads: { heading: string; body: string; days: string[] }[];
	arc: string;
	lookingAhead: string | null;
	closingQuestion: string;
	emotions: string[];
	tone: Tone;
	secondaryEmotion: string | null;
	dayTones: { day: string; tone: Tone }[];
}

export const MIN_RECAP_ENTRIES = 3;

// a stable id per month: two devices that both write October's letter converge
// on one entry through sync's last-write-wins instead of duplicating it
export const recapId = (month: string) => `recap-${month}`;

export const isRecap = (e: Entry) => !!e.metadata.recap;

// The month before the current one (UTC, matching the timeline's month groups).
export function previousMonthKey(now = new Date()): string {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	return d.toISOString().slice(0, 7);
}

// Every past month (newest first) with enough writing for a letter and no
// letter yet. The current month is never offered — it isn't over.
export function recapOffers(all: Entry[], now = new Date()): { month: string; count: number }[] {
	const current = now.toISOString().slice(0, 7);
	const written = new Set(all.filter(isRecap).map((e) => e.metadata.recap));
	const counts = new Map<string, number>();
	for (const e of all) {
		if (e.deleted || e.metadata.tutorial || isRecap(e)) continue;
		const m = dayKeyOf(e.createdAt).slice(0, 7);
		if (m < current && !written.has(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
	}
	return [...counts]
		.filter(([, n]) => n >= MIN_RECAP_ENTRIES)
		.sort((a, b) => (a[0] < b[0] ? 1 : -1))
		.map(([month, count]) => ({ month, count }));
}

export function monthName(month: string, style: 'long' | 'short' = 'long'): string {
	const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
	return d.toLocaleDateString(undefined, { month: style });
}

function daysIn(month: string): number {
	return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

// The entries a recap reads: the month's own writing — never the seeded
// examples, and never an earlier letter.
export function monthEntries(all: Entry[], month: string): Entry[] {
	return all
		.filter(
			(e) =>
				!e.deleted &&
				!e.metadata.tutorial &&
				!isRecap(e) &&
				dayKeyOf(e.createdAt).slice(0, 7) === month
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partOfDay(ts: number): NonNullable<RecapStats['timeOfDay']> {
	const h = new Date(ts).getHours(); // local: "evenings" means the writer's evening
	if (h >= 5 && h < 12) return 'mornings';
	if (h >= 12 && h < 17) return 'afternoons';
	if (h >= 17 && h < 22) return 'evenings';
	return 'late nights';
}

// most frequent key, only when it actually stands out (ties → none)
function mode<T>(values: T[]): T | undefined {
	const counts = new Map<T, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
	return ranked[0][0];
}

export function computeStats(
	all: Entry[],
	month: string,
	dayTones: Record<string, Tone> = {}
): RecapStats {
	const list = monthEntries(all, month);
	const total = daysIn(month);

	const byDay = new Map<number, Entry[]>();
	for (const e of list) {
		const d = Number(dayKeyOf(e.createdAt).slice(8, 10));
		byDay.set(d, [...(byDay.get(d) ?? []), e]);
	}

	let longestStreak = 0;
	let run = 0;
	for (let d = 1; d <= total; d++) {
		run = byDay.has(d) ? run + 1 : 0;
		longestStreak = Math.max(longestStreak, run);
	}

	const spine: SpineDay[] = [];
	for (let d = 1; d <= total; d++) {
		const day = byDay.get(d);
		if (!day) {
			spine.push(null);
			continue;
		}
		const key = `${month}-${String(d).padStart(2, '0')}`;
		// the model's reading of the day wins; the entry's own tone (from Suggest)
		// covers a day the model skipped
		spine.push(dayTones[key] ?? day.find((e) => e.metadata.aiTone)?.metadata.aiTone ?? 'written');
	}

	const moods: RecapStats['moods'] = {};
	for (const e of list)
		if (e.metadata.mood) moods[e.metadata.mood] = (moods[e.metadata.mood] ?? 0) + 1;

	const tagCounts = new Map<string, { tag: string; count: number }>();
	for (const e of list)
		for (const raw of e.metadata.tags ?? []) {
			const tag = raw.trim();
			if (!tag) continue;
			const hit = tagCounts.get(tag.toLowerCase());
			if (hit) hit.count++;
			else tagCounts.set(tag.toLowerCase(), { tag, count: 1 });
		}
	const topTags = [...tagCounts.values()]
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
		.slice(0, 5);

	// a tag is new when no earlier entry (outside this month) ever carried it
	const start = list[0]?.createdAt ?? 0;
	const seenBefore = new Set<string>();
	let earlier = false;
	for (const e of all)
		if (!e.deleted && !e.metadata.tutorial && !isRecap(e) && e.createdAt < start) {
			earlier = true;
			for (const t of e.metadata.tags ?? []) seenBefore.add(t.trim().toLowerCase());
		}
	// in a first month every tag is "new" — saying so tells the writer nothing
	const newTags = !earlier
		? []
		: [...tagCounts.keys()]
				.filter((k) => !seenBefore.has(k))
				.map((k) => tagCounts.get(k)!.tag)
				.slice(0, 4);

	return {
		month,
		entries: list.length,
		daysWritten: byDay.size,
		daysInMonth: total,
		words: list.reduce((n, e) => n + (e.metadata.wordCount ?? 0), 0),
		longestStreak,
		busiestWeekday: mode(list.map((e) => WEEKDAYS[new Date(e.createdAt).getDay()])),
		timeOfDay: mode(list.map((e) => partOfDay(e.createdAt))),
		moods,
		topTags,
		newTags,
		spine
	};
}

// --- payload -------------------------------------------------------------------

// Characters of entry text sent per recap. A full month of daily writing is
// ~15k words (~90k chars); beyond the budget every entry is trimmed by the same
// share, so a long day can't crowd out the rest of the month.
const TEXT_BUDGET = 90_000;

export interface RecapEntryPayload {
	day: string;
	time: string; // 'HH:MM', local — lets the letter say "late at night"
	title?: string;
	mood?: Mood;
	tags?: string[];
	text: string;
}

export function recapPayload(list: Entry[]): RecapEntryPayload[] {
	const texts = list.map((e) => extractText(e.content));
	const size = texts.reduce((n, t) => n + t.length, 0);
	const share = size > TEXT_BUDGET ? TEXT_BUDGET / size : 1;
	return list.map((e, i) => {
		const t = texts[i];
		const cut = share < 1 ? Math.max(400, Math.floor(t.length * share)) : t.length;
		return {
			day: dayKeyOf(e.createdAt),
			time: new Date(e.createdAt).toTimeString().slice(0, 5),
			title: e.metadata.title || undefined,
			mood: e.metadata.mood,
			tags: e.metadata.tags?.length ? e.metadata.tags : undefined,
			text: cut < t.length ? `${t.slice(0, cut)}…` : t
		};
	});
}

// --- the letter as a TipTap doc -------------------------------------------------

const text = (t: string, marks?: JSONContent['marks']): JSONContent =>
	marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

export function buildRecapDoc(
	letter: RecapLetter,
	stats: RecapStats,
	written: Set<string>
): JSONContent {
	// the title lives in metadata (the Context panel), like any titled entry
	const content: JSONContent[] = [
		{ type: 'recapStats', attrs: { stats } },
		para(text(letter.opening))
	];

	for (const t of letter.threads) {
		// only cite days that really hold an entry — the chips are links back
		const days = [...new Set(t.days)].filter((d) => written.has(d)).sort();
		const chips = days.flatMap((day) => [text(' '), { type: 'dateRef', attrs: { day } }]);
		content.push(para(text(`${t.heading}. `, [{ type: 'bold' }]), text(t.body), ...chips));
	}

	content.push(para(text(letter.arc)));
	if (letter.lookingAhead) content.push(para(text(letter.lookingAhead)));
	content.push({
		type: 'blockquote',
		content: [para(text('P.S. ', [{ type: 'bold' }]), text(letter.closingQuestion))]
	});

	return { type: 'doc', content };
}

// The stats card inside a recap doc, if the letter still has one.
export function statsOf(content: Entry['content']): RecapStats | undefined {
	if (typeof content === 'string') return undefined;
	const node = content.content?.find((n) => n.type === 'recapStats');
	return node?.attrs?.stats as RecapStats | undefined;
}

// --- generate --------------------------------------------------------------------

// Reads the month, asks for the letter, and returns everything needed to save
// it. Throws with a readable message on failure.
export async function writeRecap(
	all: Entry[],
	month: string
): Promise<{ content: JSONContent; letter: RecapLetter; stats: RecapStats }> {
	const list = monthEntries(all, month);
	if (list.length < MIN_RECAP_ENTRIES) throw new Error('Not enough entries this month.');

	const draft = computeStats(all, month);
	const res = await fetch('/api/recap', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			month,
			monthName: `${monthName(month)} ${month.slice(0, 4)}`,
			entries: recapPayload(list),
			stats: draft
		})
	});
	if (!res.ok)
		throw new Error((await res.json().catch(() => ({}))).message || 'Could not write the letter.');
	const letter = (await res.json()) as RecapLetter;

	const written = new Set(list.map((e) => dayKeyOf(e.createdAt)));
	const dayTones: Record<string, Tone> = {};
	for (const d of letter.dayTones ?? []) if (written.has(d.day)) dayTones[d.day] = d.tone;
	const stats = computeStats(all, month, dayTones);

	return { content: buildRecapDoc(letter, stats, written), letter, stats };
}

// The letter's first paragraph — the envelope card quotes it on the timeline.
export function letterOpening(content: Entry['content']): string {
	if (typeof content === 'string') return content;
	const p = content.content?.find((n) => n.type === 'paragraph' && n.content?.length);
	return p ? extractText(p) : '';
}
