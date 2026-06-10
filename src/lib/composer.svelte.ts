// Shared composer state so the layout header can act on the entry being
// written/viewed in the /entry route (delete, edit) without prop drilling.
export const composer = $state<{
	entryId: string | null;
	readonly: boolean; // true while viewing an existing entry (not editing)
	createdAt: number | null; // existing entry's created time (header clock)
	delete: (() => void) | null;
	edit: (() => void) | null;
	share: (() => void) | null; // captures the entry as an image (set while it has content)
	sharing: boolean; // capture in progress — header button shows busy state
	// after a clipboard copy the button flashes a check ('copied') then offers
	// a download for a while ('download') before settling back to 'idle'
	shareState: 'idle' | 'copied' | 'download';
	reflection: boolean; // AI "reflection mode" — ghost follow-up questions at the caret
	canReflect: boolean; // whether the header should offer the reflection toggle
	newEntryNonce: number; // bumped to force a fresh /entry mount even when already there
}>({
	entryId: null,
	readonly: false,
	createdAt: null,
	delete: null,
	edit: null,
	share: null,
	sharing: false,
	shareState: 'idle',
	reflection: false,
	canReflect: false,
	newEntryNonce: 0
});
