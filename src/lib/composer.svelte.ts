// Shared composer state so the layout header can act on the entry being
// written/viewed in the /entry route (delete, edit) without prop drilling.
export const composer = $state<{
	entryId: string | null;
	readonly: boolean; // true while viewing an existing entry (not editing)
	createdAt: number | null; // existing entry's created time (header clock)
	recapMonth: string | null; // 'YYYY-MM' when viewing a monthly recap — the header shows the month, not the time
	delete: (() => void) | null;
	edit: (() => void) | null;
	share: (() => void) | null; // captures the entry as an image (set while it has content)
	sharing: boolean; // capture in progress — header button shows busy state
	// after a clipboard copy the button flashes a check ('copied') then offers
	// a download for a while ('download') before settling back to 'idle'
	shareState: 'idle' | 'copied' | 'download';
	pin: (() => void) | null; // toggles the entry's pinned flag (set for saved entries)
	pinned: boolean; // entry's current pinned state — drives the header button
	collaborate: (() => void) | null; // turns this entry into a shared one (flagged)
	shared: boolean; // the open entry is co-written — header shows the shared mark
	openEditing: string | null; // entry id to open straight into edit mode (once)
	showMembers: boolean; // the shared entry's members sheet is open
	openMembers: string | null; // entry id to open with its members sheet showing (once)
	online: { name: string; color: string }[]; // others live in this shared entry now
	reflection: boolean; // AI "reflection mode" — ghost follow-up questions at the caret
	canReflect: boolean; // whether the header should offer the reflection toggle
	newEntryNonce: number; // bumped to force a fresh /entry mount even when already there
}>({
	entryId: null,
	readonly: false,
	createdAt: null,
	recapMonth: null,
	delete: null,
	edit: null,
	share: null,
	sharing: false,
	shareState: 'idle',
	pin: null,
	pinned: false,
	collaborate: null,
	shared: false,
	openEditing: null,
	showMembers: false,
	openMembers: null,
	online: [],
	reflection: false,
	canReflect: false,
	newEntryNonce: 0
});
