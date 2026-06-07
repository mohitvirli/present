import { env } from '$env/dynamic/private';
import { createAnthropic } from '@ai-sdk/anthropic';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';

// server endpoint (Vercel function) — not prerendered; pages stay static
export const prerender = false;

const schema = z.object({
	question: z
		.string()
		.describe(
			'One short, open-ended, gentle follow-up question (max ~15 words) that invites the writer to go a little deeper. No quotes, ends with a question mark.'
		)
});

export const POST: RequestHandler = async ({ request }) => {
	const key = env.ANTHROPIC_API_KEY;
	if (!key) throw error(503, 'AI is not configured.');

	const { text } = await request.json().catch(() => ({ text: '' }));
	if (typeof text !== 'string' || text.trim().length < 20) {
		throw error(400, 'Not enough text to reflect on.');
	}

	// Pin baseURL: a dev shell may export ANTHROPIC_BASE_URL (proxy), which the
	// provider picks up by default and routes our key to the wrong endpoint.
	const anthropic = createAnthropic({ apiKey: key, baseURL: 'https://api.anthropic.com/v1' });

	try {
		const { object } = await generateObject({
			model: anthropic('claude-haiku-4-5'),
			schema,
			system:
				'You gently help someone journaling go a little deeper. Given their entry so far, offer ONE short, open-ended follow-up question that invites them to keep writing. Be warm and curious. Never give advice, never judge, never summarize, never praise. Ground the question in what they actually wrote, in their own register. Keep it under ~15 words.',
			prompt: `Journal entry so far:\n\n${text.slice(0, 8000)}`
		});
		return json(object);
	} catch (e) {
		console.error('reflect failed', e);
		throw error(502, 'Could not reflect on the entry.');
	}
};
