// In-app replacements for confirm() and alert(), drawn by DialogHost (mounted
// once in the layout) in the same style as the Settings confirm dialogs.

export interface DialogRequest {
	title: string;
	body?: string;
	confirmLabel?: string;
	cancelLabel?: string | null; // null → a single button (an alert)
	danger?: boolean;
	resolve: (ok: boolean) => void;
}

export const dialogs = $state<{ current: DialogRequest | null }>({ current: null });

function open(req: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
	// a new dialog replaces one still open, which counts as cancelled
	dialogs.current?.resolve(false);
	return new Promise((resolve) => {
		dialogs.current = { ...req, resolve };
	});
}

export function confirmDialog(opts: {
	title: string;
	body?: string;
	confirmLabel?: string;
	danger?: boolean;
}): Promise<boolean> {
	return open({ cancelLabel: 'Cancel', confirmLabel: 'Continue', ...opts });
}

export async function alertDialog(opts: { title: string; body?: string }): Promise<void> {
	await open({ ...opts, confirmLabel: 'OK', cancelLabel: null });
}
