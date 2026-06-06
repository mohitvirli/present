import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { DeepgramClient } from '@deepgram/sdk';

// server endpoint (Vercel function) — mints a short-lived JWT so the browser can
// open a WebSocket straight to Deepgram without ever seeing the master API key.
export const prerender = false;

// Token is only used at the WS handshake, but a longer TTL means a mid-session
// reconnect (network blip) can re-handshake without re-fetching.
const TTL_SECONDS = 300;

export const POST: RequestHandler = async () => {
	const key = env.DEEPGRAM_API_KEY;
	if (!key) throw error(503, 'Live transcription is not configured.');

	try {
		const dg = new DeepgramClient({ apiKey: key });
		const res = await dg.auth.v1.tokens.grant({ ttl_seconds: TTL_SECONDS });
		if (!res.access_token) throw new Error('No token returned.');
		return json({ accessToken: res.access_token, expiresIn: res.expires_in ?? TTL_SECONDS });
	} catch (e) {
		console.error('deepgram token grant failed', e);
		throw error(502, 'Could not start live transcription.');
	}
};
