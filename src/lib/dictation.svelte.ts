// Live dictation via Deepgram streaming WebSocket.
//
// The socket is opened once on mount() and held open (KeepAlive pings) for the
// whole session, so pressing the mic starts recording instantly — no per-click
// handshake, no "Connecting". Deepgram bills per audio sent, not idle time, so
// a quiet open socket costs ~nothing. A short-lived JWT (minted server-side)
// keeps the API key off the client; it's only needed at the handshake.

export type DictationStatus = 'idle' | 'connecting' | 'recording' | 'error';

function pickMime(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
	if (typeof MediaRecorder === 'undefined') return '';
	return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

// Minimal shape of Deepgram's "Results" message we rely on.
type DeepgramResults = {
	type: string;
	is_final?: boolean;
	channel: { alternatives: { transcript: string }[] };
};

type DgConnection = {
	on: (e: string, cb: (arg?: unknown) => void) => void;
	connect: () => void;
	sendMedia: (b: Blob | ArrayBuffer) => void;
	sendKeepAlive: (m: { type: string }) => void;
	sendFinalize: (m: { type: string }) => void;
	close: () => void;
};

// Cache the SDK import so the (first-time) bundle load happens once.
let sdkModule: Promise<typeof import('@deepgram/sdk')> | null = null;
function loadSdk() {
	return (sdkModule ??= import('@deepgram/sdk'));
}

const KEEPALIVE_MS = 8000; // Deepgram closes an idle socket after ~10s

// onTranscript fires for every result: isFinal=false for volatile interim
// updates (replace previous), isFinal=true when a segment is locked in.
export function createDictation(onTranscript: (text: string, isFinal: boolean) => void) {
	let status = $state<DictationStatus>('idle');
	let error = $state('');
	let elapsed = $state(0);

	let mounted = false;
	let connection: DgConnection | null = null;
	let socketReady = false;
	let opening: Promise<void> | null = null; // de-dupes concurrent open attempts

	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let keepAlive: ReturnType<typeof setInterval> | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | null = null;

	const supported =
		typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';

	function fetchToken(): Promise<string> {
		return fetch('/api/deepgram-token', { method: 'POST' }).then(async (res) => {
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(body.message || 'Could not start live transcription.');
			}
			return ((await res.json()) as { accessToken: string }).accessToken;
		});
	}

	function startKeepAlive() {
		stopKeepAlive();
		keepAlive = setInterval(() => connection?.sendKeepAlive({ type: 'KeepAlive' }), KEEPALIVE_MS);
	}
	function stopKeepAlive() {
		if (keepAlive) clearInterval(keepAlive);
		keepAlive = null;
	}

	// Open (or reopen) the persistent socket. Idempotent while one is in flight.
	function openSocket(): Promise<void> {
		if (socketReady) return Promise.resolve();
		if (opening) return opening;

		opening = (async () => {
			const [accessToken, sdk] = await Promise.all([fetchToken(), loadSdk()]);
			if (!mounted) return;

			const dg = new sdk.DeepgramClient({ accessToken });
			const args = {
				model: 'nova-3',
				language: 'en',
				smart_format: true,
				interim_results: true,
				punctuate: true,
				utterance_end_ms: 1000
			} as unknown as Parameters<typeof dg.listen.v1.connect>[0];
			const conn = (await dg.listen.v1.connect(args)) as unknown as DgConnection;
			connection = conn;

			// Resolve the open() only once the socket is actually OPEN — connect()
			// returns synchronously, well before the handshake completes, so a
			// caller that awaits must wait for this event, not for connect().
			let resolveOpen!: () => void;
			let rejectOpen!: (e: Error) => void;
			const opened = new Promise<void>((res, rej) => {
				resolveOpen = res;
				rejectOpen = rej;
			});

			conn.on('open', () => {
				socketReady = true;
				if (status === 'connecting') status = 'idle';
				if (!recorder) startKeepAlive(); // pings only while not streaming audio
				resolveOpen();
			});
			conn.on('message', (msg) => {
				const m = msg as DeepgramResults;
				if (m?.type !== 'Results') return;
				const text = m.channel?.alternatives?.[0]?.transcript ?? '';
				if (!text) return;
				onTranscript(text, !!m.is_final);
			});
			conn.on('error', () => {
				socketReady = false;
				rejectOpen(new Error('Live transcription connection error.'));
				if (status === 'recording' || status === 'connecting') {
					status = 'error';
					error = 'Live transcription connection error.';
				}
			});
			conn.on('close', () => {
				socketReady = false;
				connection = null;
				stopKeepAlive();
				rejectOpen(new Error('Connection closed.'));
				// auto-reopen so the next click stays instant — unless we're tearing down
				if (mounted) scheduleReopen();
			});

			conn.connect(); // opens the WS → fires 'open'

			// wait for the actual handshake (or fail fast) so callers awaiting
			// openSocket() see a truly-ready socket
			const timeout = setTimeout(() => rejectOpen(new Error('Connection timed out.')), 10000);
			await opened.finally(() => clearTimeout(timeout));
		})();

		opening.catch(() => {
			/* surfaced via status where it matters; mount() open is best-effort */
		});
		return opening.finally(() => {
			opening = null;
		});
	}

	function scheduleReopen() {
		if (reopenTimer || !mounted) return;
		reopenTimer = setTimeout(() => {
			reopenTimer = null;
			if (mounted && !socketReady) openSocket().catch(() => {});
		}, 1500);
	}

	// Pre-acquire mic on pointerdown so the click→record gap hides its init.
	function prewarm() {
		if (!supported || stream || status === 'recording') return;
		navigator.mediaDevices
			.getUserMedia({ audio: true })
			.then((s) => {
				if (status === 'recording' || mounted === false) {
					if (stream) s.getTracks().forEach((t) => t.stop());
					else stream = s;
				} else {
					stream = s;
				}
			})
			.catch(() => {
				/* permission handled on actual start() */
			});
	}

	async function ensureMic(): Promise<MediaStream> {
		if (stream && stream.active) return stream;
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		return stream;
	}

	async function start() {
		if (status === 'recording') return;
		error = '';

		// socket should already be open from mount(); fall back if not
		if (!socketReady) {
			status = 'connecting';
			try {
				await openSocket();
			} catch (e) {
				status = 'error';
				error = e instanceof Error ? e.message : 'Could not connect.';
				return;
			}
			if (!socketReady) {
				status = 'error';
				error = 'Could not connect.';
				return;
			}
		}

		let mic: MediaStream;
		try {
			mic = await ensureMic();
		} catch {
			status = 'error';
			error = 'Microphone access denied.';
			return;
		}

		stopKeepAlive(); // live audio keeps the socket alive on its own
		const mime = pickMime();
		recorder = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0 && connection) connection.sendMedia(e.data);
		};
		recorder.start(120); // small chunks → snappier interim results
		status = 'recording';
		elapsed = 0;
		if (timer) clearInterval(timer);
		timer = setInterval(() => (elapsed += 1), 1000);
	}

	function stopRecorder() {
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		recorder = null;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (timer) clearInterval(timer);
		timer = null;
	}

	function stop() {
		if (status !== 'recording' && status !== 'connecting') return;
		stopRecorder();
		// flush the last utterance, keep the socket open for next time
		if (socketReady && connection) {
			connection.sendFinalize({ type: 'Finalize' });
			startKeepAlive();
		}
		status = 'idle';
	}

	function toggle() {
		if (status === 'recording' || status === 'connecting') stop();
		else start();
	}

	// ---- lifecycle: call from the page's onMount / onDestroy ----
	function mount() {
		if (mounted) return;
		mounted = true;
		openSocket().catch(() => {}); // best-effort; start() retries if needed
	}

	function unmount() {
		mounted = false;
		if (reopenTimer) clearTimeout(reopenTimer);
		reopenTimer = null;
		stopRecorder();
		stopKeepAlive();
		socketReady = false;
		try {
			connection?.close();
		} catch {
			/* already closed */
		}
		connection = null;
		status = 'idle';
	}

	return {
		get status() {
			return status;
		},
		get error() {
			return error;
		},
		get elapsed() {
			return elapsed;
		},
		supported,
		start,
		stop,
		toggle,
		prewarm,
		mount,
		unmount
	};
}
