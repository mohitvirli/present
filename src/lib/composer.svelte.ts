// Shared composer state so the layout header can act on the entry being
// written/viewed in the /entry route (delete, edit) without prop drilling.
export const composer = $state<{
	entryId: string | null;
	readonly: boolean; // true while viewing an existing entry (not editing)
	delete: (() => void) | null;
	edit: (() => void) | null;
}>({
	entryId: null,
	readonly: false,
	delete: null,
	edit: null
});
