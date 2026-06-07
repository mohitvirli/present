import { browser } from '$app/environment';
import { listForSync, putRemote, getEntry, type Entry } from './db';

// Private Sync — passkey identity + server-proxied Supabase sync.
// Phase 1–3: plaintext. Phase 4 will wrap content in encrypt/decrypt.

const ENABLED_KEY = 'present:sync-enabled';
const SINCE_KEY = 'present:sync-since';

type Status = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

export const syncState = $state<{
	enabled: boolean;
	status: Status;
	error: string;
	rev: number; // bumped when a pull mutates local data, so views can refresh
}>({
	enabled: browser ? localStorage.getItem(ENABLED_KEY) === '1' : false,
	status: 'idle',
	error: '',
	rev: 0
});

export const syncSupported =
	browser && typeof PublicKeyCredential !== 'undefined' && window.isSecureContext;

function setEnabledFlag(on: boolean) {
	if (browser) localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
}
function getSince(): number {
	if (!browser) return 0;
	return Number(localStorage.getItem(SINCE_KEY) ?? '0') || 0;
}
function setSince(ms: number) {
	if (browser) localStorage.setItem(SINCE_KEY, String(ms));
}

// dynamic import keeps the WebAuthn SDK out of SSR
const loadSdk = () => import('@simplewebauthn/browser');

const jsonPost = (url: string, body?: unknown) =>
	fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

// ----- passkey ceremonies -----

async function register(): Promise<boolean> {
	const optRes = await jsonPost('/api/sync/register/options');
	if (!optRes.ok) throw new Error('Could not start passkey setup.');
	const optionsJSON = await optRes.json();
	const { startRegistration } = await loadSdk();
	const attResp = await startRegistration({ optionsJSON });
	const verifyRes = await jsonPost('/api/sync/register/verify', attResp);
	return verifyRes.ok;
}

// Returns false when no passkey is registered for this RP (404), so the caller
// can fall back to registration.
async function authenticate(): Promise<boolean> {
	const optRes = await jsonPost('/api/sync/auth/options');
	if (!optRes.ok) throw new Error('Could not start passkey sign-in.');
	const optionsJSON = await optRes.json();
	const { startAuthentication } = await loadSdk();
	const authResp = await startAuthentication({ optionsJSON });
	const verifyRes = await jsonPost('/api/sync/auth/verify', authResp);
	if (verifyRes.status === 404) return false;
	return verifyRes.ok;
}

// ----- public controls -----

export async function enableSync(): Promise<void> {
	if (!syncSupported) {
		syncState.status = 'error';
		syncState.error = 'Passkeys need HTTPS on this device.';
		return;
	}
	syncState.status = 'connecting';
	syncState.error = '';
	try {
		// reuse a passkey already on this device, else create one
		let ok = false;
		try {
			ok = await authenticate();
		} catch {
			ok = false; // user cancelled the sign-in sheet, try registering
		}
		if (!ok) ok = await register();
		if (!ok) throw new Error('Passkey setup was cancelled.');

		setEnabledFlag(true);
		syncState.enabled = true;
		await fullSync();
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e instanceof Error ? e.message : 'Could not enable sync.';
	}
}

export async function disableSync(): Promise<void> {
	try {
		await fetch('/api/sync/session', { method: 'DELETE' });
	} catch {
		/* ignore */
	}
	setEnabledFlag(false);
	syncState.enabled = false;
	syncState.status = 'idle';
	syncState.error = '';
}

// Called on app start: if the user had sync on, confirm the session is still
// valid and do an initial sync; otherwise prompt re-auth on next action.
export async function initSync(): Promise<void> {
	if (!browser || !syncState.enabled) return;
	try {
		const res = await fetch('/api/sync/session');
		const { signedIn } = (await res.json()) as { signedIn: boolean };
		if (signedIn) await fullSync();
		else syncState.status = 'idle'; // session expired → re-enable re-auths
	} catch {
		/* offline — try again on focus */
	}
}

// ----- engine -----

let syncing = false;

export async function fullSync(): Promise<void> {
	if (!syncState.enabled || syncing) return;
	syncing = true;
	syncState.status = 'syncing';
	syncState.error = '';
	try {
		await push();
		await pull();
		syncState.status = 'synced';
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e instanceof Error ? e.message : 'Sync failed.';
	} finally {
		syncing = false;
	}
}

function handle401() {
	setEnabledFlag(false);
	syncState.enabled = false;
	throw new Error('Sync session expired — enable again.');
}

async function push(): Promise<void> {
	const all = await listForSync();
	if (!all.length) return;
	const res = await jsonPost('/api/sync/push', { entries: all });
	if (res.status === 401) handle401();
	if (!res.ok) throw new Error('Could not push entries.');
}

async function pull(): Promise<void> {
	const res = await fetch(`/api/sync/pull?since=${getSince()}`);
	if (res.status === 401) handle401();
	if (!res.ok) throw new Error('Could not pull entries.');
	const { entries, serverNow } = (await res.json()) as { entries: Entry[]; serverNow: number };

	let changed = false;
	for (const remote of entries) {
		const local = await getEntry(remote.id);
		// last-write-wins by updatedAt
		if (!local || remote.updatedAt > local.updatedAt) {
			await putRemote(remote);
			changed = true;
		}
	}
	setSince(serverNow);
	if (changed) syncState.rev += 1; // signal views to re-read
}

// Debounced push after a local change (call from autosave).
let queueTimer: ReturnType<typeof setTimeout> | null = null;
export function queueSync(): void {
	if (!browser || !syncState.enabled) return;
	if (queueTimer) clearTimeout(queueTimer);
	queueTimer = setTimeout(() => void fullSync(), 1500);
}
