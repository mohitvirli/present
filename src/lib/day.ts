// Day keys are UTC ISO dates (`YYYY-MM-DD`) — the same convention the timeline
// groups by and the calendar renders against. Local-time math would drift a day
// for anyone west of UTC, landing a reference in the wrong day group.
//
// Dependency-free on purpose: db.ts and the timeline both need this, and
// neither should have to pull in the editor's ProseMirror schema to get it.

const DAY = 86_400_000;

export function dayKeyOf(at: Date | number = Date.now()): string {
	return new Date(at).toISOString().slice(0, 10);
}

// Day key `offset` days from today — relativeDayKey(1) is tomorrow. Offsetting
// in UTC ms (not local calendar math) keeps DST transitions from eating a day.
export function relativeDayKey(offset: number): string {
	return dayKeyOf(Date.now() + offset * DAY);
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is string {
	return typeof value === 'string' && DAY_KEY.test(value);
}

// Midnight UTC of a day key — only ever used to diff two keys by whole days.
function utcMs(key: string): number {
	return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

export function daysFromToday(key: string): number {
	return Math.round((utcMs(key) - utcMs(dayKeyOf())) / DAY);
}

// The day key `days` away from another. Shifting in UTC ms keeps a DST
// boundary from swallowing or repeating a day.
export function shiftDayKey(key: string, days: number): string {
	return dayKeyOf(utcMs(key) + days * DAY);
}

// A day key as a local Date. Built from parts, never `new Date(key)` — that
// parses as UTC midnight, which toLocaleDateString renders as the *previous*
// day in negative-offset timezones.
function localDate(key: string): Date {
	return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

// Human label for a day key. ALWAYS derived, never stored — a baked "Tomorrow"
// turns into a lie overnight.
export function dateRefLabel(key: unknown): string {
	if (!isDayKey(key)) return typeof key === 'string' ? key : '';
	const diff = daysFromToday(key);
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Tomorrow';
	if (diff === -1) return 'Yesterday';
	const d = localDate(key);
	// the week ahead reads as a plan — the weekday alone says enough
	if (diff > 1 && diff <= 6) return d.toLocaleDateString(undefined, { weekday: 'short' });
	const thisYear = key.slice(0, 4) === dayKeyOf().slice(0, 4);
	return d.toLocaleDateString(
		undefined,
		thisYear
			? { weekday: 'short', day: 'numeric', month: 'short' }
			: { day: 'numeric', month: 'short', year: 'numeric' }
	);
}

// The plain calendar date, with no relative wording — for places that show a
// key *alongside* its relative label and would otherwise read "Today (Today)".
export function dayKeyMedium(key: string): string {
	if (!isDayKey(key)) return '';
	return localDate(key).toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
}
