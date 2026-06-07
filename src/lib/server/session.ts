import { env } from '$env/dynamic/private';
import { SignJWT, jwtVerify } from 'jose';
import type { Cookies } from '@sveltejs/kit';

// Signed cookies for the sync session and the in-flight WebAuthn challenge.
// Challenge must survive across the two-step ceremony in a serverless setting,
// so we stash it in a short-lived signed cookie (not module memory).

const SESSION_COOKIE = 'present_sync';
const CHALLENGE_COOKIE = 'present_chal';
const SESSION_TTL = '30d';
const CHALLENGE_TTL = '5m';

function secret(): Uint8Array {
	if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set.');
	return new TextEncoder().encode(env.SESSION_SECRET);
}

async function sign(payload: Record<string, unknown>, exp: string): Promise<string> {
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(exp)
		.sign(secret());
}

async function verify<T>(token: string | undefined): Promise<T | null> {
	if (!token) return null;
	try {
		const { payload } = await jwtVerify(token, secret());
		return payload as T;
	} catch {
		return null;
	}
}

const baseCookie = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

// ----- session (userId) -----
export async function mintSession(cookies: Cookies, userId: string): Promise<void> {
	const jwt = await sign({ sub: userId }, SESSION_TTL);
	cookies.set(SESSION_COOKIE, jwt, { ...baseCookie, maxAge: 60 * 60 * 24 * 30 });
}

export async function readSession(cookies: Cookies): Promise<string | null> {
	const payload = await verify<{ sub?: string }>(cookies.get(SESSION_COOKIE));
	return payload?.sub ?? null;
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

// ----- ceremony challenge -----
export async function setChallenge(cookies: Cookies, challenge: string): Promise<void> {
	const jwt = await sign({ chal: challenge }, CHALLENGE_TTL);
	cookies.set(CHALLENGE_COOKIE, jwt, { ...baseCookie, maxAge: 300 });
}

export async function takeChallenge(cookies: Cookies): Promise<string | null> {
	const payload = await verify<{ chal?: string }>(cookies.get(CHALLENGE_COOKIE));
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	return payload?.chal ?? null;
}
