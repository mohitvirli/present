import { browser } from '$app/environment';
import { listForSync, putRemote, getEntry, clearTutorialEntries, type Entry } from './db';
import { markOnboarded } from './onboarding';
import {
	PRF_SALT,
	deriveKey,
	encryptJSON,
	decryptJSON,
	isEnvelope,
	type Envelope
} from './crypto';

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
	encrypted: boolean; // PRF-derived key is active → entries sync end-to-end encrypted
}>({
	enabled: browser ? localStorage.getItem(ENABLED_KEY) === '1' : false,
	status: 'idle',
	error: '',
	rev: 0,
	encrypted: false
});

// AES-GCM key derived from the passkey PRF — memory only, never persisted.
let aesKey: CryptoKey | null = null;

// Read the PRF result off a ceremony response and derive the key (if present).
async function deriveKeyFrom(clientExtensionResults: unknown): Promise<void> {
	const prf = (clientExtensionResults as { prf?: { results?: { first?: ArrayBuffer | string } } })
		?.prf;
	const first = prf?.results?.first;
	if (!first) return;
	aesKey = await deriveKey(first);
	syncState.encrypted = true;
}

// Re-derive the key via a passkey ceremony when it's missing (after reload).
async function ensureKey(): Promise<boolean> {
	if (aesKey) return true;
	try {
		await authenticate(); // derives aesKey as a side effect on success
	} catch {
		/* cancelled */
	}
	return !!aesKey;
}

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
	// inject the PRF eval salt as raw bytes client-side (the SDK forwards
	// extensions but won't convert a base64url salt to a BufferSource)
	optionsJSON.extensions = { ...(optionsJSON.extensions ?? {}), prf: { eval: { first: PRF_SALT } } };
	const { startRegistration } = await loadSdk();
	const attResp = await startRegistration({ optionsJSON });
	const verifyRes = await jsonPost('/api/sync/register/verify', attResp);
	if (!verifyRes.ok) return false;
	// some platforms return PRF output already at creation
	await deriveKeyFrom(attResp.clientExtensionResults);
	return true;
}

// Returns false when no passkey is registered for this RP (404), so the caller
// can fall back to registration.
async function authenticate(): Promise<boolean> {
	const optRes = await jsonPost('/api/sync/auth/options');
	if (!optRes.ok) throw new Error('Could not start passkey sign-in.');
	const optionsJSON = await optRes.json();
	optionsJSON.extensions = { ...(optionsJSON.extensions ?? {}), prf: { eval: { first: PRF_SALT } } };
	const { startAuthentication } = await loadSdk();
	const authResp = await startAuthentication({ optionsJSON });
	const verifyRes = await jsonPost('/api/sync/auth/verify', authResp);
	if (verifyRes.status === 404) return false;
	if (!verifyRes.ok) return false;
	// derive the encryption key from this ceremony's PRF output
	await deriveKeyFrom(authResp.clientExtensionResults);
	return true;
}

// ----- public controls -----

function notSupported(): boolean {
	if (syncSupported) return false;
	syncState.status = 'error';
	syncState.error = 'Passkeys need HTTPS on this device.';
	return true;
}

// Mark synced + do the first sync. Clears the first-run tutorial examples first
// so they never get pushed to (and spread across) the user's real account.
async function startSyncing(): Promise<void> {
	setEnabledFlag(true);
	syncState.enabled = true;
	await clearTutorialEntries();
	markOnboarded();
	// make sure the encryption key is ready before the first push (registration
	// may not have returned PRF output; ensureKey runs a quick auth to get it).
	// If PRF is unsupported, we fall back to plaintext sync.
	if (!aesKey) await ensureKey();
	await fullSync();
}

// Enable = create a new passkey (and user) with this device's biometrics.
// Use when there's no passkey yet.
export async function enableSync(): Promise<void> {
	if (notSupported()) return;
	syncState.status = 'connecting';
	syncState.error = '';
	try {
		const ok = await register();
		if (!ok) throw new Error('Passkey setup was cancelled.');
		await startSyncing();
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e instanceof Error ? e.message : 'Could not enable sync.';
	}
}

// Sign in = use an existing passkey (existing user), e.g. on another device.
export async function signInSync(): Promise<void> {
	if (notSupported()) return;
	syncState.status = 'connecting';
	syncState.error = '';
	try {
		const ok = await authenticate();
		if (!ok) throw new Error('No passkey found for this account on this device.');
		await startSyncing();
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e instanceof Error ? e.message : 'Could not sign in.';
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
	aesKey = null;
	syncState.encrypted = false;
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

	// When a key is available, encrypt {content, metadata} into the content
	// envelope and blank the server-visible metadata (E2E). Else push plaintext.
	const wire = aesKey
		? await Promise.all(
				all.map(async (e) => ({
					...e,
					content: await encryptJSON(aesKey!, { content: e.content, metadata: e.metadata }),
					metadata: {}
				}))
			)
		: all;

	const res = await jsonPost('/api/sync/push', { entries: wire });
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
		let entry = remote;
		// decrypt the envelope back into the real content + metadata
		if (isEnvelope(remote.content as unknown)) {
			if (!(await ensureKey())) throw new Error('Passkey needed to decrypt synced entries.');
			const dec = await decryptJSON<{ content: Entry['content']; metadata: Entry['metadata'] }>(
				aesKey!,
				remote.content as unknown as Envelope
			);
			entry = { ...remote, content: dec.content, metadata: dec.metadata };
		}
		const local = await getEntry(entry.id);
		// last-write-wins by updatedAt
		if (!local || entry.updatedAt > local.updatedAt) {
			await putRemote(entry);
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
