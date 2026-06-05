import { env } from '$env/dynamic/private';
import { createAnthropic } from '@ai-sdk/anthropic';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';

// server endpoint (Vercel function) — not prerendered; pages stay static
export const prerender = false;

const schema = z.object({
	title: z.string().describe('A short, evocative title, max 6 words. No quotes, no trailing period.'),
	tags: z.array(z.string()).max(4).describe('2 to 4 lowercase single-word or short topical tags.'),
	summary: z.string().describe('One calm sentence capturing the essence of the entry.'),
	emotion: z
		.string()
		.describe(
			'A single evocative, lowercase word for the DOMINANT emotion in the entry (e.g. calm, wistful, hopeful, anxious, content, restless).'
		),
	tone: z.enum(['positive', 'neutral', 'negative']).describe('Overall valence of the dominant emotion.'),
	secondaryEmotion: z
		.string()
		.nullable()
		.describe(
			'A second, clearly distinct emotion if the entry genuinely holds mixed feelings (lowercase single word). Null when one emotion dominates.'
		)
});

export const POST: RequestHandler = async ({ request }) => {
	const key = env.ANTHROPIC_API_KEY;
	if (!key) throw error(503, 'AI is not configured.');

	const { text } = await request.json().catch(() => ({ text: '' }));
	if (typeof text !== 'string' || text.trim().length < 8) {
		throw error(400, 'Not enough text to analyze.');
	}

	// Pin baseURL: a dev shell may export ANTHROPIC_BASE_URL (proxy), which the
	// provider picks up by default and routes our key to the wrong endpoint.
	const anthropic = createAnthropic({ apiKey: key, baseURL: 'https://api.anthropic.com/v1' });

	try {
		const { object } = await generateObject({
			model: anthropic('claude-haiku-4-5'),
			schema,
			system:
				'You analyze personal journal entries. Be concise, warm, and faithful to the writer’s voice. Never invent facts not present in the text.',
			prompt: `Journal entry:\n\n${text.slice(0, 8000)}`
		});
		return json(object);
	} catch (e) {
		console.error('analyze failed', e);
		throw error(502, 'Could not analyze the entry.');
	}
};
