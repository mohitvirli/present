// Shared composer state so the layout header can act on the entry being
// written/viewed in the /entry route (delete, edit) without prop drilling.
export const composer = $state<{
	entryId: string | null;
	readonly: boolean; // true while viewing an existing entry (not editing)
	createdAt: number | null; // existing entry's created time (header clock)
	delete: (() => void) | null;
	edit: (() => void) | null;
	reflection: boolean; // AI "reflection mode" — ghost follow-up questions at the caret
	canReflect: boolean; // whether the header should offer the reflection toggle
}>({
	entryId: null,
	readonly: false,
	createdAt: null,
	delete: null,
	edit: null,
	reflection: false,
	canReflect: false
});
