import { browser } from '$app/environment';
import {
	applyDerived,
	clearSyncMarks,
	clearTutorialEntries,
	clockOf,
	getEntries,
	listDirty,
	markSynced,
	putRemote,
	putSynced,
	type Entry
} from './db';
import { markOnboarded } from './onboarding';
import { PRF_SALT, deriveKey, encryptJSON, decryptJSON, isEnvelope, type Envelope } from './crypto';
import { saveAesKey, loadAesKey, clearAesKey } from './keystore';

// Private Sync — passkey identity + server-proxied Supabase sync. Content is
// end-to-end encrypted when the passkey supports PRF.

const ENABLED_KEY = 'present:sync-enabled';
const CURSOR_KEY = 'present:sync-cursor';
const SYNCED_AT_KEY = 'present:sync-at';
const LEGACY_SINCE_KEY = 'present:sync-since'; // pre-cursor builds

type Status = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

export const syncState = $state<{
	enabled: boolean;
	status: Status;
	error: string;
	rev: number; // bumped when a pull mutates local data, so views can refresh
	encrypted: boolean; // PRF-derived key is active → entries sync end-to-end encrypted
	syncedAt: number; // end of the last clean sync, 0 = never
}>({
	enabled: browser ? localStorage.getItem(ENABLED_KEY) === '1' : false,
	status: 'idle',
	error: '',
	rev: 0,
	encrypted: false,
	syncedAt: browser ? Number(localStorage.getItem(SYNCED_AT_KEY)) || 0 : 0
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
	// persist so reloads don't need another passkey ceremony to decrypt
	try {
		await saveAesKey(aesKey);
	} catch {
		/* non-fatal — falls back to re-deriving via ceremony */
	}
}

// Load the persisted (non-extractable) key into memory without prompting.
async function loadKey(): Promise<boolean> {
	if (aesKey) return true;
	try {
		const stored = await loadAesKey();
		if (stored) {
			aesKey = stored;
			syncState.encrypted = true;
			return true;
		}
	} catch {
		/* ignore */
	}
	return false;
}

// Get the key: persisted copy first (silent), else a passkey ceremony.
async function ensureKey(): Promise<boolean> {
	if (await loadKey()) return true;
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

// Pull position: the last row the server returned, by its own write time.
type Cursor = { ts: string; id: string };

function getCursor(): Cursor | null {
	if (!browser) return null;
	try {
		const c = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? 'null') as Cursor | null;
		return c && typeof c.ts === 'string' && typeof c.id === 'string' ? c : null;
	} catch {
		return null;
	}
}
function setCursor(c: Cursor) {
	if (browser) localStorage.setItem(CURSOR_KEY, JSON.stringify(c));
}
function setSyncedAt(ms: number) {
	syncState.syncedAt = ms;
	if (browser) localStorage.setItem(SYNCED_AT_KEY, String(ms));
}

// dynamic import keeps the WebAuthn SDK out of SSR
const loadSdk = () => import('@simplewebauthn/browser');

const jsonPost = (url: string, body?: unknown) =>
	fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

// Some platforms (esp. a freshly-set-up device) throw a transient
// "operation failed for an operation-specific reason" on the first WebAuthn
// call, then succeed on retry. Retry once after a short delay.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		const msg = e instanceof Error ? e.message : '';
		if (/operation-specific|operation failed/i.test(msg)) {
			await new Promise((r) => setTimeout(r, 600));
			return await fn();
		}
		throw e;
	}
}

// ----- passkey ceremonies -----

async function register(): Promise<boolean> {
	const optRes = await jsonPost('/api/sync/register/options');
	if (!optRes.ok) throw new Error('Could not start passkey setup.');
	const optionsJSON = await optRes.json();
	// inject the PRF eval salt as raw bytes client-side (the SDK forwards
	// extensions but won't convert a base64url salt to a BufferSource)
	optionsJSON.extensions = {
		...(optionsJSON.extensions ?? {}),
		prf: { eval: { first: PRF_SALT } }
	};
	const { startRegistration } = await loadSdk();
	const attResp = await withRetry(() => startRegistration({ optionsJSON }));
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
	optionsJSON.extensions = {
		...(optionsJSON.extensions ?? {}),
		prf: { eval: { first: PRF_SALT } }
	};
	const { startAuthentication } = await loadSdk();
	const authResp = await withRetry(() => startAuthentication({ optionsJSON }));
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

function resetLocalSyncState(): void {
	setEnabledFlag(false);
	syncState.enabled = false;
	syncState.status = 'idle';
	syncState.error = '';
	aesKey = null;
	syncState.encrypted = false;
	void clearAesKey();
	// the next account starts from nothing: pull everything, push everything
	if (browser) {
		localStorage.removeItem(CURSOR_KEY);
		localStorage.removeItem(SYNCED_AT_KEY);
		localStorage.removeItem(LEGACY_SINCE_KEY);
	}
	syncState.syncedAt = 0;
	void clearSyncMarks();
}

// Sign this device out of sync. Server data stays — the user can sign back in
// from this or another device with their passkey. Local entries are kept too.
export async function disableSync(): Promise<void> {
	try {
		await fetch('/api/sync/session', { method: 'DELETE' });
	} catch {
		/* ignore */
	}
	resetLocalSyncState();
}

// Permanently delete the sync account: all server-side entries, all registered
// passkeys, and the session. Local entries are left untouched so the user still
// has their journal on this device.
export async function deleteSyncAccount(): Promise<boolean> {
	try {
		const res = await fetch('/api/sync/account', { method: 'DELETE' });
		if (!res.ok && res.status !== 401) {
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			syncState.status = 'error';
			syncState.error = body.message || 'Could not delete sync account.';
			return false;
		}
	} catch {
		syncState.status = 'error';
		syncState.error = 'Could not reach the sync server.';
		return false;
	}
	resetLocalSyncState();
	return true;
}

// Called on app start: if the user had sync on, sync straight away. No separate
// session check — an expired session answers the pull with a 401, which turns
// sync off the same way, one round trip sooner.
export async function initSync(): Promise<void> {
	if (!browser || !syncState.enabled) return;
	localStorage.removeItem(LEGACY_SINCE_KEY);
	await loadKey(); // silent — avoids a passkey ceremony on every open
	await fullSync();
}

// ----- engine -----

// Re-read this much before the saved cursor on every pull. synced_at is stamped
// when a push transaction starts, so a slow push can commit a row older than one
// a pull already returned; the overlap catches it. Re-reads are cheap: rows that
// match the local copy are skipped before decrypting.
const REWIND_MS = 10_000;
// Push request budget, well under Vercel's 4.5 MB function body limit.
const PUSH_BYTES = 1_500_000;
const PUSH_ROWS = 200;

let syncing = false;
let rerun = false;

const errorMessage = (e: unknown, fallback: string) =>
	e instanceof TypeError
		? "Couldn't reach the sync server."
		: e instanceof Error
			? e.message
			: fallback;

// Pull, then push: pulling first lets this device merge a concurrent edit
// before its own copy goes up, instead of overwriting it on the server first.
// A call made while a pass is running queues one more pass, so a change saved
// mid-sync isn't left waiting for the next edit.
export async function fullSync(): Promise<void> {
	if (!syncState.enabled) return;
	if (syncing) {
		rerun = true;
		return;
	}
	syncing = true;
	syncState.status = 'syncing';
	syncState.error = '';
	let failure: string;
	try {
		do {
			rerun = false;
			failure = '';
			try {
				await pull();
			} catch (e) {
				// a 401 disables sync (handle401) and must stop the cycle
				if (!syncState.enabled) throw e;
				failure = errorMessage(e, 'Could not pull entries.');
			}
			try {
				await push();
			} catch (e) {
				if (!syncState.enabled) throw e;
				failure ||= errorMessage(e, 'Could not push entries.');
			}
		} while (rerun && syncState.enabled);
		if (failure) throw new Error(failure);
		setSyncedAt(Date.now());
		syncState.status = 'synced';
	} catch (e) {
		syncState.status = 'error';
		syncState.error = errorMessage(e, 'Sync failed.');
	} finally {
		syncing = false;
	}
}

function handle401(): never {
	setEnabledFlag(false);
	syncState.enabled = false;
	throw new Error('Sync session expired — enable again.');
}

// Only what changed since the server last saw it, in requests small enough for
// the function body limit. Each batch is marked clean as soon as it lands, so a
// failure part way resumes where it stopped.
async function push(): Promise<void> {
	const dirty = await listDirty();
	if (!dirty.length) return;

	// When a key is available, encrypt {content, metadata} into the content
	// envelope and blank the server-visible metadata (E2E). Else push plaintext.
	const wire = await Promise.all(
		dirty.map(async (e) => ({
			id: e.id,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
			touchedAt: clockOf(e),
			deleted: !!e.deleted,
			...(aesKey
				? {
						content: await encryptJSON(aesKey, { content: e.content, metadata: e.metadata }),
						metadata: {}
					}
				: { content: e.content, metadata: e.metadata })
		}))
	);

	let start = 0;
	while (start < wire.length) {
		let end = start;
		let bytes = 0;
		while (end < wire.length && end - start < PUSH_ROWS) {
			bytes += JSON.stringify(wire[end]).length;
			if (end > start && bytes > PUSH_BYTES) break;
			end++;
		}
		const res = await jsonPost('/api/sync/push', { entries: wire.slice(start, end) });
		if (res.status === 401) handle401();
		if (!res.ok) throw new Error('Could not push entries.');
		await markSynced(dirty.slice(start, end));
		start = end;
	}
}

type PullPage = { entries: Entry[]; cursor: Cursor | null; more: boolean };

async function pull(): Promise<void> {
	const saved = getCursor();
	let after: Cursor | null = saved
		? { ts: new Date(Date.parse(saved.ts) - REWIND_MS).toISOString(), id: '' }
		: null;
	let changed = false;
	for (;;) {
		const qs = after
			? `?ts=${encodeURIComponent(after.ts)}&id=${encodeURIComponent(after.id)}`
			: '';
		const res = await fetch(`/api/sync/pull${qs}`);
		if (res.status === 401) handle401();
		if (!res.ok) throw new Error('Could not pull entries.');
		const page = (await res.json()) as PullPage;
		if (await applyPulled(page.entries)) changed = true;
		// saved per page: a big first pull that fails part way resumes, not restarts
		if (page.cursor) {
			setCursor(page.cursor);
			after = page.cursor;
		}
		if (!page.more || !page.cursor) break;
	}
	if (changed) syncState.rev += 1; // signal views to re-read
}

// Unwrap the envelope back into the real content + metadata.
async function decrypt(remote: Entry): Promise<Entry> {
	if (!isEnvelope(remote.content as unknown)) return remote;
	if (!(await ensureKey())) throw new Error('Passkey needed to decrypt synced entries.');
	const dec = await decryptJSON<{ content: Entry['content']; metadata: Entry['metadata'] }>(
		aesKey!,
		remote.content as unknown as Envelope
	);
	return { ...remote, content: dec.content, metadata: dec.metadata };
}

// Two clocks per entry: updatedAt for content, touchedAt for everything. Each
// half is last-write-wins on its own clock, so a pin on one device doesn't wipe
// a text edit made on another. Returns whether the local store changed.
async function applyPulled(remotes: Entry[]): Promise<boolean> {
	if (!remotes.length) return false;
	const locals = await getEntries(remotes.map((r) => r.id));
	const clean: Entry[] = []; // the server's copy, as is
	const merged: Entry[] = []; // a mix of both — left dirty so it goes back up
	const same: Entry[] = []; // already identical — just record that

	for (const remote of remotes) {
		const local = locals.get(remote.id);
		if (local) {
			const newerContent = remote.updatedAt > local.updatedAt;
			const newerMeta = clockOf(remote) > clockOf(local);
			if (!newerContent && !newerMeta) {
				// identical clocks: nothing to write, but the server holds it as is
				if (remote.updatedAt === local.updatedAt && clockOf(remote) === clockOf(local))
					same.push(local);
				continue; // otherwise local is newer, and stays dirty for the push
			}
			const olderContent = remote.updatedAt < local.updatedAt;
			const olderMeta = clockOf(remote) < clockOf(local);
			if (olderContent || olderMeta) {
				merged.push(mergeEntry(local, await decrypt(remote)));
				continue;
			}
		}
		clean.push(await decrypt(remote));
	}

	await putSynced(clean);
	await markSynced(same);
	for (const entry of merged) await putRemote(entry);
	return clean.length + merged.length > 0;
}

// One side has the newer text, the other the newer metadata (pin, title,
// tags…). Keep both. Derived fields follow the content that won.
function mergeEntry(local: Entry, remote: Entry): Entry {
	const content = remote.updatedAt > local.updatedAt ? remote.content : local.content;
	const meta = clockOf(remote) > clockOf(local) ? remote : local;
	return {
		id: local.id,
		content,
		metadata: applyDerived({ ...meta.metadata }, content),
		createdAt: local.createdAt,
		updatedAt: Math.max(local.updatedAt, remote.updatedAt),
		// past both clocks, or the server's guard would refuse the merged row
		touchedAt: Math.max(Date.now(), clockOf(local) + 1, clockOf(remote) + 1),
		...(meta.deleted ? { deleted: true } : {})
	};
}

// Debounced push after a local change (call from autosave).
let queueTimer: ReturnType<typeof setTimeout> | null = null;
export function queueSync(): void {
	if (!browser || !syncState.enabled) return;
	if (queueTimer) clearTimeout(queueTimer);
	queueTimer = setTimeout(() => void fullSync(), 1500);
}
