import * as Y from 'yjs';
import {
	type Awareness,
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates
} from 'y-protocols/awareness';
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import { decryptBytes, encryptBytes, isEnvelope, type Envelope } from '$lib/crypto';
import { REMOTE, liveEntryKey, sharedTopic, syncShared } from './store';
import type { RealtimeConfig } from '../../routes/api/shared/realtime/+server';

// Live editing for an open shared entry over Supabase Realtime broadcast.
// Same message shapes as the Phase 0 BroadcastProvider — doc updates,
// awareness (carets, names) and a hello carrying a state vector, answered with
// what the newcomer lacks — but every payload is AES-GCM sealed with the entry
// key and the topic is derived from that key. Broadcast is best-effort: the
// server's update log stays the source of truth, and joining a channel (or
// rejoining after a drop) also catches up from it.

type Wire = { t: 'y' | 'a' | 'hello'; e: Envelope };

// Realtime caps a message's size; anything bigger arrives via the log instead.
const MAX_BYTES = 200_000;

let config: Promise<RealtimeConfig> | null = null;
let client: RealtimeClient | null = null;

async function getClient(): Promise<RealtimeClient> {
	config ??= fetch('/api/shared/realtime').then(async (r) => {
		if (!r.ok) throw new Error(`realtime config ${r.status}`);
		return r.json();
	});
	const { url, key } = await config.catch((e) => {
		config = null;
		throw e;
	});
	if (!client) {
		client = new RealtimeClient(url, { params: { apikey: key } });
		await client.setAuth(key);
	}
	return client;
}

export interface LiveSession {
	destroy: () => void;
}

// Attach an entry's doc and awareness (owned by the caller, created before the
// editor so carets work whether or not this connects) to its live channel.
export async function connectLive(
	entryId: string,
	doc: Y.Doc,
	awareness: Awareness
): Promise<LiveSession> {
	const key = liveEntryKey(entryId);
	if (!key) throw new Error('Shared entry is not open.');
	const [rt, topic] = await Promise.all([getClient(), sharedTopic(entryId)]);

	const channel: RealtimeChannel = rt.channel(`present-shared-${topic}`, {
		config: { broadcast: { self: false }, private: false }
	});
	let destroyed = false;

	async function send(t: Wire['t'], bytes: Uint8Array) {
		if (destroyed || bytes.length > MAX_BYTES) return;
		const e = await encryptBytes(key!, bytes);
		await channel.send({ type: 'broadcast', event: 'm', payload: { t, e } satisfies Wire });
	}

	channel.on('broadcast', { event: 'm' }, async ({ payload }) => {
		const msg = payload as Partial<Wire> | undefined;
		if (!msg || !isEnvelope(msg.e)) return;
		let bytes: Uint8Array;
		try {
			bytes = await decryptBytes(key, msg.e);
		} catch {
			return; // not sealed with this entry's key — ignore
		}
		if (destroyed) return;
		if (msg.t === 'y') Y.applyUpdate(doc, bytes, REMOTE);
		else if (msg.t === 'a') applyAwarenessUpdate(awareness, bytes, REMOTE);
		else if (msg.t === 'hello') {
			// a peer just arrived: send what it lacks (unpushed edits too) and our caret
			const diff = Y.encodeStateAsUpdate(doc, bytes);
			if (diff.length > 2) void send('y', diff);
			void send('a', encodeAwarenessUpdate(awareness, [doc.clientID]));
		}
	});

	const onDocUpdate = (u: Uint8Array, origin: unknown) => {
		if (origin !== REMOTE) void send('y', u);
	};
	const onAwareness = (
		{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown
	) => {
		if (origin === REMOTE) return;
		void send('a', encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
	};
	doc.on('update', onDocUpdate);
	awareness.on('update', onAwareness);

	channel.subscribe((status) => {
		if (status !== 'SUBSCRIBED' || destroyed) return;
		void send('hello', Y.encodeStateVector(doc));
		void send('a', encodeAwarenessUpdate(awareness, [doc.clientID]));
		// anything broadcast while we weren't listening is in the log
		void syncShared().catch(() => {});
	});

	const onHide = () => destroy();
	window.addEventListener('pagehide', onHide);

	function destroy() {
		if (destroyed) return;
		// tell peers our caret is gone before leaving
		// clearing our state broadcasts it (onAwareness), so peers drop our caret now
		removeAwarenessStates(awareness, [doc.clientID], 'local');
		destroyed = true;
		window.removeEventListener('pagehide', onHide);
		doc.off('update', onDocUpdate);
		awareness.off('update', onAwareness);
		void rt.removeChannel(channel);
	}

	return { destroy };
}
