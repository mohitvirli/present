import * as Y from 'yjs';
import {
	Awareness,
	encodeAwarenessUpdate,
	applyAwarenessUpdate,
	removeAwarenessStates
} from 'y-protocols/awareness';

// Phase 0 spike transport: syncs a Y.Doc and its awareness between tabs of the
// same browser over a BroadcastChannel. Same message shapes the Supabase
// Realtime provider will carry later (doc update, awareness update, sync
// request), minus encryption. Dev-only.

type Msg =
	| { t: 'update'; u: Uint8Array }
	| { t: 'awareness'; u: Uint8Array }
	| { t: 'hello'; sv: Uint8Array }; // state vector; peers answer with the diff

const REMOTE = Symbol('broadcast-remote');

export class BroadcastProvider {
	readonly awareness: Awareness;
	private channel: BroadcastChannel;

	constructor(
		readonly doc: Y.Doc,
		room: string
	) {
		this.awareness = new Awareness(doc);
		this.channel = new BroadcastChannel(`present:shared:${room}`);
		this.channel.onmessage = (e: MessageEvent<Msg>) => this.receive(e.data);
		doc.on('update', this.onDocUpdate);
		this.awareness.on('update', this.onAwarenessUpdate);
		this.channel.postMessage({ t: 'hello', sv: Y.encodeStateVector(doc) } satisfies Msg);
		window.addEventListener('pagehide', this.destroy);
	}

	private receive(m: Msg) {
		if (m.t === 'update') Y.applyUpdate(this.doc, m.u, REMOTE);
		else if (m.t === 'awareness') applyAwarenessUpdate(this.awareness, m.u, REMOTE);
		else if (m.t === 'hello') {
			// a peer just opened: send what it's missing, and our carets
			this.channel.postMessage({
				t: 'update',
				u: Y.encodeStateAsUpdate(this.doc, m.sv)
			} satisfies Msg);
			this.channel.postMessage({
				t: 'awareness',
				u: encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
			} satisfies Msg);
		}
	}

	private onDocUpdate = (u: Uint8Array, origin: unknown) => {
		if (origin !== REMOTE) this.channel.postMessage({ t: 'update', u } satisfies Msg);
	};

	private onAwarenessUpdate = (
		{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown
	) => {
		if (origin === REMOTE) return;
		const changed = [...added, ...updated, ...removed];
		this.channel.postMessage({
			t: 'awareness',
			u: encodeAwarenessUpdate(this.awareness, changed)
		} satisfies Msg);
	};

	destroy = () => {
		removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
		window.removeEventListener('pagehide', this.destroy);
		this.doc.off('update', this.onDocUpdate);
		this.awareness.off('update', this.onAwarenessUpdate);
		this.awareness.destroy();
		this.channel.close();
	};
}
