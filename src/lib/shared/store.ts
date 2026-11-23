import * as Y from 'yjs';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Schema } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import {
	decryptBytes,
	encryptBytes,
	importEntryKey,
	newEntryKeyBytes,
	openSealed,
	sealTo,
	type Sealed
} from '$lib/crypto';
import { loadIdentity } from '$lib/keystore';
import { applyDerived, getEntry, purgeEntries, putRemote, type Entry } from '$lib/db';
import type { SharedListItem } from '../../routes/api/shared/+server';
import type { UpdatesPage } from '../../routes/api/shared/[id]/updates/+server';

// Shared entries on this device. Each is a Y.Doc: the XML fragment 'default'
// holds the TipTap content (what Collaboration binds to) and the map 'meta'
// holds title, tags and the entry's date. Docs persist here as Y state; edits
// not yet on the server queue as one merged `pending` update. After every
// change the doc is mirrored into the normal entries store as a plain Entry
// (metadata.shared set), so the timeline, search and calendar need no changes.
//
// The server sees only ciphertext: updates and snapshots are encrypted with
// the entry key, which arrives sealed to this user's identity key.

const FRAGMENT = 'default';
const REMOTE = 'shared-remote'; // origin for updates that came from the server
const LOAD = 'shared-load'; // origin for state loaded from disk (not undoable)
const COMPACT_AFTER = 100; // updates since the last snapshot before uploading a new one

interface SharedRecord {
	id: string;
	key: CryptoKey; // non-extractable entry key
	wrappedKey?: Sealed; // the same key sealed to us — unsealed again to invite others
	epoch: number;
	role: 'owner' | 'editor';
	state: Uint8Array; // Y.encodeStateAsUpdate of the doc
	pending: Uint8Array | null; // local edits not yet on the server
	cursor: number; // last server seq applied
	sinceSnapshot: number;
	seenAt: string; // server updatedAt when last caught up
}

interface SharedDB extends DBSchema {
	docs: { key: string; value: SharedRecord };
}

let dbPromise: Promise<IDBPDatabase<SharedDB>> | null = null;
function getDB() {
	dbPromise ??= openDB<SharedDB>('present-shared', 1, {
		upgrade(db) {
			db.createObjectStore('docs', { keyPath: 'id' });
		}
	});
	return dbPromise;
}

export interface SharedMeta {
	title?: string;
	tags?: string[];
	createdAt: number; // the entry's date on everyone's timeline
}

// ---- open docs -------------------------------------------------------------
// One live Y.Doc per entry per tab, shared by the editor and the sync loop.

const live = new Map<string, { doc: Y.Doc; record: SharedRecord; refs: number }>();

async function loadLive(id: string) {
	const hit = live.get(id);
	if (hit) return hit;
	const record = await (await getDB()).get('docs', id);
	if (!record) return null;
	const doc = new Y.Doc();
	Y.applyUpdate(doc, record.state, LOAD);
	const entry = { doc, record, refs: 0 };
	doc.on('update', (u: Uint8Array, origin: unknown) => onDocUpdate(id, u, origin));
	live.set(id, entry);
	return entry;
}

// For the editor: the doc stays loaded (and synced) until dispose().
export async function openShared(id: string): Promise<{ doc: Y.Doc; dispose: () => void } | null> {
	const entry = await loadLive(id);
	if (!entry) return null;
	entry.refs++;
	return {
		doc: entry.doc,
		dispose: () => {
			entry.refs--;
			if (entry.refs <= 0) void flush(id);
		}
	};
}

export function sharedMeta(doc: Y.Doc): Y.Map<unknown> {
	return doc.getMap('meta');
}

// ---- local changes -----------------------------------------------------------

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PUSH_DEBOUNCE_MS = 1000;

function onDocUpdate(id: string, update: Uint8Array, origin: unknown) {
	const entry = live.get(id);
	if (!entry || origin === LOAD) return;
	if (origin !== REMOTE) {
		const { record } = entry;
		record.pending = record.pending ? Y.mergeUpdates([record.pending, update]) : update;
	}
	clearTimeout(saveTimers.get(id));
	saveTimers.set(
		id,
		setTimeout(() => void flush(id), origin === REMOTE ? 0 : PUSH_DEBOUNCE_MS)
	);
}

// Persist the doc, refresh the mirror, push pending edits. Serialized per entry.
const chains = new Map<string, Promise<void>>();
function flush(id: string): Promise<void> {
	const next = (chains.get(id) ?? Promise.resolve())
		.then(() => doFlush(id))
		.catch((e) => {
			console.warn('shared flush failed', id, e);
		});
	chains.set(id, next);
	return next;
}

async function doFlush(id: string) {
	const entry = live.get(id);
	if (!entry) return;
	const { doc, record } = entry;
	record.state = Y.encodeStateAsUpdate(doc);
	await (await getDB()).put('docs', record);
	await writeMirror(record, doc);
	await pushPending(record);
	if (entry.refs <= 0 && !record.pending) live.delete(id);
}

async function pushPending(record: SharedRecord) {
	const sending = record.pending;
	if (!sending) return;
	const envelope = await encryptBytes(record.key, sending);
	const res = await fetch(`/api/shared/${record.id}/updates`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ updates: [envelope] })
	});
	if (!res.ok) throw new Error(`push ${res.status}`);
	// edits made while sending stay queued
	record.pending = record.pending === sending ? null : record.pending;
	record.sinceSnapshot++;
	await (await getDB()).put('docs', record);
}

// ---- mirror into the entries store ------------------------------------------

async function writeMirror(record: SharedRecord, doc: Y.Doc) {
	const meta = sharedMeta(doc);
	const content = yDocToProsemirrorJSON(doc, FRAGMENT) as JSONContent;
	const existing = await getEntry(record.id);
	const now = Date.now();
	const changed = JSON.stringify(existing?.content) !== JSON.stringify(content);
	const createdAt = (meta.get('createdAt') as number | undefined) ?? existing?.createdAt ?? now;
	const tags = meta.get('tags') as string[] | undefined;
	const title = meta.get('title') as string | undefined;
	const mirror: Entry = {
		id: record.id,
		content,
		metadata: applyDerived(
			{
				...(existing?.metadata ?? {}),
				...(title ? { title } : { title: undefined }),
				...(tags?.length ? { tags } : { tags: undefined }),
				shared: { role: record.role }
			},
			content
		),
		createdAt,
		updatedAt: changed || !existing ? now : existing.updatedAt,
		touchedAt: now
	};
	await putRemote(mirror);
}

// ---- create --------------------------------------------------------------------

// Turn content into a new shared entry owned by this user. `schema` is the
// editor's (needed to build the Y XML fragment). The content is written into
// the doc before any editor binds to it, so it is never on anyone's undo stack.
export async function createShared(opts: {
	id?: string;
	content: JSONContent;
	meta: SharedMeta;
	schema: Schema;
}): Promise<string> {
	const identity = await loadIdentity();
	if (!identity) throw new Error('No identity keys on this device yet.');
	const id = opts.id ?? crypto.randomUUID();

	const doc = new Y.Doc();
	doc.transact(() => {
		prosemirrorJSONToYXmlFragment(opts.schema, opts.content, doc.getXmlFragment(FRAGMENT));
		const meta = sharedMeta(doc);
		meta.set('createdAt', opts.meta.createdAt);
		if (opts.meta.title) meta.set('title', opts.meta.title);
		if (opts.meta.tags?.length) meta.set('tags', opts.meta.tags);
	}, LOAD);
	const state = Y.encodeStateAsUpdate(doc);

	const raw = newEntryKeyBytes();
	const key = await importEntryKey(raw);
	const wrappedKey = await sealTo(identity.publicJwk, raw);
	raw.fill(0);
	const snapshot = await encryptBytes(key, state);

	const res = await fetch('/api/shared', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id, wrappedKey, snapshot })
	});
	if (!res.ok) throw new Error(`Could not create shared entry (${res.status}).`);

	const record: SharedRecord = {
		id,
		key,
		wrappedKey,
		epoch: 1,
		role: 'owner',
		state,
		pending: null,
		cursor: 0,
		sinceSnapshot: 0,
		seenAt: ''
	};
	await (await getDB()).put('docs', record);
	await writeMirror(record, doc);
	doc.destroy();
	return id;
}

// ---- sync with the server ------------------------------------------------------

let syncing: Promise<void> | null = null;

// Catch up every shared entry: adopt new ones, apply others' updates, push our
// own, compact when the log grows, and drop entries we're no longer in.
export function syncShared(): Promise<void> {
	syncing ??= runSync().finally(() => (syncing = null));
	return syncing;
}

async function runSync() {
	const res = await fetch('/api/shared');
	if (!res.ok) throw new Error(`shared list ${res.status}`);
	const items = (await res.json()) as SharedListItem[];
	const db = await getDB();
	const known = new Set(await db.getAllKeys('docs'));

	for (const item of items) {
		known.delete(item.id);
		if (item.deleted) {
			await forget(item.id);
			continue;
		}
		try {
			await catchUp(item);
		} catch (e) {
			console.warn('shared catch-up failed', item.id, e);
		}
	}
	// local docs the server no longer lists for us (removed, or a stale account)
	for (const id of known) await forget(id);
}

async function catchUp(item: SharedListItem) {
	const db = await getDB();
	let record = live.get(item.id)?.record ?? (await db.get('docs', item.id));
	if (!record || record.epoch !== item.epoch) {
		const identity = await loadIdentity();
		if (!identity) throw new Error('No identity keys on this device.');
		const raw = await openSealed(identity.privateKey, item.wrappedKey);
		const key = await importEntryKey(raw);
		raw.fill(0);
		record = record
			? { ...record, key, wrappedKey: item.wrappedKey, epoch: item.epoch, role: item.role }
			: {
					id: item.id,
					key,
					wrappedKey: item.wrappedKey,
					epoch: item.epoch,
					role: item.role,
					state: Y.encodeStateAsUpdate(new Y.Doc()),
					pending: null,
					cursor: 0,
					sinceSnapshot: 0,
					seenAt: ''
				};
		await db.put('docs', record);
	}
	if (record.seenAt === item.updatedAt && !record.pending) return;

	const entry = await loadLive(item.id);
	if (!entry) return;
	entry.record = record;
	let more = true;
	while (more) {
		const page = await fetchPage(item.id, record.cursor);
		const remote: Uint8Array[] = [];
		if (page.snapshot) {
			remote.push(await decryptBytes(record.key, page.snapshot.envelope));
			record.sinceSnapshot = 0;
		}
		for (const u of page.updates) remote.push(await decryptBytes(record.key, u.envelope));
		if (remote.length) Y.applyUpdate(entry.doc, Y.mergeUpdates(remote), REMOTE);
		record.sinceSnapshot += page.updates.length;
		record.cursor = page.cursor;
		more = page.more;
	}
	record.seenAt = item.updatedAt;
	await flush(item.id);
	if (record.sinceSnapshot >= COMPACT_AFTER && !record.pending) await compact(record, entry.doc);
}

async function fetchPage(id: string, after: number): Promise<UpdatesPage> {
	const res = await fetch(`/api/shared/${id}/updates?after=${after}`);
	if (!res.ok) throw new Error(`updates ${res.status}`);
	return res.json();
}

async function compact(record: SharedRecord, doc: Y.Doc) {
	const snapshot = await encryptBytes(record.key, Y.encodeStateAsUpdate(doc));
	const res = await fetch(`/api/shared/${record.id}/snapshot`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ snapshot, seq: record.cursor })
	});
	if (res.ok) {
		record.sinceSnapshot = 0;
		await (await getDB()).put('docs', record);
	}
}

async function forget(id: string) {
	live.get(id)?.doc.destroy();
	live.delete(id);
	await (await getDB()).delete('docs', id);
	await purgeEntries([id]);
}

// Sign-out: shared docs belong to the account, not the device.
export async function clearShared(): Promise<void> {
	for (const { doc } of live.values()) doc.destroy();
	live.clear();
	const db = await getDB();
	const ids = await db.getAllKeys('docs');
	await db.clear('docs');
	await purgeEntries(ids);
}

// ---- for invites -------------------------------------------------------------

// The entry key's raw bytes, unsealed with this user's identity. Only to seal
// it again for someone else; callers zero it when done.
export async function entryKeyBytes(id: string): Promise<{ raw: Uint8Array; epoch: number }> {
	const db = await getDB();
	const record = live.get(id)?.record ?? (await db.get('docs', id));
	let sealed = record?.wrappedKey;
	let epoch = record?.epoch ?? 1;
	if (!sealed) {
		const res = await fetch('/api/shared');
		const item = res.ok
			? ((await res.json()) as SharedListItem[]).find((i) => i.id === id)
			: undefined;
		if (!item) throw new Error('Not a member of this entry.');
		sealed = item.wrappedKey;
		epoch = item.epoch;
	}
	const identity = await loadIdentity();
	if (!identity) throw new Error('No identity keys on this device yet.');
	return { raw: await openSealed(identity.privateKey, sealed), epoch };
}

// Member display names: userId → name, encrypted with everything else.
export function sharedNames(doc: Y.Doc): Y.Map<string> {
	return doc.getMap('names');
}
