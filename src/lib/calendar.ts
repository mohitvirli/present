import { dayKeyOf } from './day';

// Month-grid math, shared by the timeline's gutter calendar and the editor's
// `@date` picker. Single-sourced on purpose: both render day keys, and a second
// copy of this arithmetic is a second chance to drift off the UTC convention.

export const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export type MonthCell = { key: string; n: number } | null;

// Sunday-first cells for a 'YYYY-MM' key, leading blanks included. UTC
// throughout — day keys are UTC (see day.ts), and taking the lead offset in
// local time shifts the whole grid by a day west of the meridian.
export function monthCells(monthKey: string): MonthCell[] {
	const y = Number(monthKey.slice(0, 4));
	const mo = Number(monthKey.slice(5, 7));
	const lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
	const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	const out: MonthCell[] = Array(lead).fill(null);
	for (let d = 1; d <= days; d++) {
		out.push({ key: `${monthKey}-${String(d).padStart(2, '0')}`, n: d });
	}
	return out;
}

// The 'YYYY-MM' key `delta` months away.
export function stepMonth(monthKey: string, delta: number): string {
	const d = new Date(
		Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1 + delta, 1)
	);
	return d.toISOString().slice(0, 7);
}

// Built from parts — new Date('2026-06') is UTC midnight, which renders as the
// previous month in negative-offset timezones.
export function monthTitle(monthKey: string): string {
	const d = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1);
	return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function monthKeyOf(at: Date | number = Date.now()): string {
	return dayKeyOf(at).slice(0, 7);
}
