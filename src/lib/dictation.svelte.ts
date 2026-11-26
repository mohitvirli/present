// Live dictation via the browser's built-in Web Speech API.
//
// Free and dependency-free. Safari transcribes on-device; Chrome/Edge stream
// audio to their vendor's speech service. Firefox has no support, so the mic
// button stays hidden there (see `supported`).
//
// Nothing connects until the user presses the mic. Browsers end a continuous
// session on their own after a silence or ~60s; we restart it while the user
// is still recording, but give up after a few quick failures instead of
// looping forever.

export type DictationStatus = 'idle' | 'connecting' | 'recording' | 'error';

// Minimal shapes for the parts of the API we use (not in every TS DOM lib).
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechErrorEvent = { error: string };
type Recognition = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onstart: (() => void) | null;
	onresult: ((e: SpeechResultEvent) => void) | null;
	onerror: ((e: SpeechErrorEvent) => void) | null;
	onend: (() => void) | null;
	start: () => void;
	stop: () => void;
	abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		SpeechRecognition?: RecognitionCtor;
		webkitSpeechRecognition?: RecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Errors that mean "don't try again" — retrying would just fail the same way.
const FATAL: Record<string, string> = {
	'not-allowed': 'Microphone access denied.',
	'service-not-allowed': 'Speech recognition is blocked in this browser.',
	'audio-capture': 'No microphone found.',
	network: 'Speech service unreachable.',
	'language-not-supported': 'Language not supported for dictation.'
};

const MAX_QUICK_RESTARTS = 3; // consecutive restarts that died within RESTART_WINDOW_MS
const RESTART_WINDOW_MS = 2000;

// onTranscript fires for every result: isFinal=false for volatile interim
// updates (replace previous), isFinal=true when a segment is locked in.
export function createDictation(onTranscript: (text: string, isFinal: boolean) => void) {
	let status = $state<DictationStatus>('idle');
	let error = $state('');
	let elapsed = $state(0);

	const Ctor = getCtor();
	const supported = !!Ctor;

	let rec: Recognition | null = null;
	let wantRecording = false; // user intent; drives auto-restart on 'end'
	let sessionStartedAt = 0;
	let quickRestarts = 0;
	let timer: ReturnType<typeof setInterval> | null = null;

	function fail(message: string) {
		wantRecording = false;
		status = 'error';
		error = message;
		stopTimer();
	}

	function stopTimer() {
		if (timer) clearInterval(timer);
		timer = null;
	}

	function launch() {
		if (!Ctor) return;
		const r = new Ctor();
		r.lang = navigator.language || 'en-US';
		r.continuous = true;
		r.interimResults = true;

		r.onstart = () => {
			sessionStartedAt = Date.now();
			if (status !== 'recording') {
				status = 'recording';
				elapsed = 0;
				stopTimer();
				timer = setInterval(() => (elapsed += 1), 1000);
			}
		};

		r.onresult = (e) => {
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const res = e.results[i];
				const text = res[0].transcript.trim();
				if (!text) continue;
				if (res.isFinal) onTranscript(text, true);
				else interim += (interim ? ' ' : '') + text;
			}
			if (interim) onTranscript(interim, false);
		};

		r.onerror = (e) => {
			const fatal = FATAL[e.error];
			if (fatal) fail(fatal);
			// 'no-speech' / 'aborted' are routine; 'end' follows and decides
		};

		r.onend = () => {
			if (rec !== r) return; // superseded or torn down
			rec = null;
			if (!wantRecording) {
				if (status !== 'error') status = 'idle';
				stopTimer();
				return;
			}
			// Browser ended the session on its own — restart, but not in a tight loop.
			quickRestarts = Date.now() - sessionStartedAt < RESTART_WINDOW_MS ? quickRestarts + 1 : 0;
			if (quickRestarts >= MAX_QUICK_RESTARTS) {
				fail('Dictation keeps stopping. Try again.');
				return;
			}
			launch();
		};

		rec = r;
		try {
			r.start();
		} catch {
			rec = null;
			fail('Could not start dictation.');
		}
	}

	function start() {
		if (!supported || wantRecording) return;
		error = '';
		wantRecording = true;
		quickRestarts = 0;
		sessionStartedAt = Date.now();
		status = 'connecting';
		launch();
	}

	function stop() {
		wantRecording = false;
		// stop() (not abort) lets the browser flush the last phrase as a final result
		if (rec) rec.stop();
		else if (status !== 'error') status = 'idle';
	}

	function toggle() {
		if (wantRecording) stop();
		else start();
	}

	// Hard teardown for page destroy / entry becoming read-only.
	function unmount() {
		wantRecording = false;
		const r = rec;
		rec = null;
		r?.abort();
		stopTimer();
		status = 'idle';
		error = '';
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
		unmount
	};
}
