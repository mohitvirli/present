import { env } from '$env/dynamic/private';
import { createAnthropic } from '@ai-sdk/anthropic';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';

// server endpoint (Vercel function) — not prerendered; pages stay static
export const prerender = false;

const tone = z.enum(['positive', 'neutral', 'negative']);

const schema = z.object({
	title: z
		.string()
		.describe(
			'A title for the month the writer might have given it themselves, max 6 words, in their casing. No quotes, no trailing period.'
		),
	opening: z
		.string()
		.describe('One paragraph that opens the entry: what this month was like to live through.'),
	threads: z
		.array(
			z.object({
				heading: z
					.string()
					.describe('2–4 words naming the thread, in the writer’s casing, no period.'),
				body: z
					.string()
					.describe(
						'A short paragraph on this thread: what kept coming back, how it changed, specific details from the entries.'
					),
				days: z
					.array(z.string())
					.describe(
						'Day keys (YYYY-MM-DD) of the entries this thread draws on, from the input only.'
					)
			})
		)
		.min(2)
		.max(5)
		.describe('The recurring threads of the month — people, places, worries, projects, habits.'),
	arc: z
		.string()
		.describe('One paragraph on how the feeling of the month moved — beginning, middle, end.'),
	lookingAhead: z
		.string()
		.nullable()
		.describe(
			'One or two sentences on what I was heading toward, if the entries say. Null if not.'
		),
	closingQuestion: z
		.string()
		.describe(
			'One open question I am carrying into next month, as I would ask it of myself (max ~18 words), ends with a question mark.'
		),
	emotions: z
		.array(z.string())
		.min(1)
		.max(5)
		.describe('Lowercase single words for the month’s strongest emotions, strongest first.'),
	tone: tone.describe('Overall valence of the month.'),
	secondaryEmotion: z
		.string()
		.nullable()
		.describe(
			'A clearly distinct second emotion if the month genuinely held mixed feelings. Null otherwise.'
		),
	dayTones: z
		.array(z.object({ day: z.string(), tone }))
		.describe('One item per input day: that day’s overall valence.')
});

const SYSTEM = `You write a monthly recap for a private journal app called Present. You are given every entry one person wrote in a month, in full, plus counts computed from them.

Write it as one more entry in their journal: the writer, a few days after the month ended, reading it back. First person ("I"), in their own voice. The recap should read as if they wrote it themselves.

Match their voice from the entries, closely:
- Sentence length and rhythm, how they open and end thoughts, how formal or loose they are.
- Their vocabulary and phrases, their casing and punctuation habits, the language or mix of languages they write in.
- Their register for feelings: as plain or as open as they are. Use emoji, exclamation marks or slang only if they do.
- Do not polish it past how they write. Do not sound like a narrator, a therapist or a summary.

Content:
- Open with what the month was like to live through, not with how much was written.
- Be specific. Name the real people, places, plans and phrases from the entries. A detail beats a generalisation.
- Be faithful. Never invent events, feelings or facts that are not in the text. If something is ambiguous, leave it out.
- Notice what they might not have: what recurred, what quietly stopped, what changed between the start and the end.
- No advice, no lessons, no praise for journaling.
- Numbers: you may mention the provided counts, but never compute or state any other figure.
- Day keys you cite must come from the input entries.`;

export const POST: RequestHandler = async ({ request }) => {
	const key = env.ANTHROPIC_API_KEY;
	if (!key) throw error(503, 'AI is not configured.');

	const body = await request.json().catch(() => null);
	const entries = Array.isArray(body?.entries) ? body.entries : [];
	if (entries.length < 3) throw error(400, 'Not enough entries to recap.');

	// Pin baseURL: a dev shell may export ANTHROPIC_BASE_URL (proxy), which the
	// provider picks up by default and routes our key to the wrong endpoint.
	const anthropic = createAnthropic({ apiKey: key, baseURL: 'https://api.anthropic.com/v1' });

	const journal = entries
		.map(
			(e: Record<string, unknown>) =>
				`--- ${e.day} ${e.time ?? ''}${e.title ? ` · ${e.title}` : ''}${e.mood ? ` · mood: ${e.mood}` : ''}${
					Array.isArray(e.tags) && e.tags.length ? ` · tags: ${e.tags.join(', ')}` : ''
				}\n${String(e.text ?? '').slice(0, 20_000)}`
		)
		.join('\n\n');

	try {
		const { object } = await generateObject({
			// once a month, and the hard part is catching someone's voice — worth
			// the most capable model
			model: anthropic('claude-opus-5-5'),
			schema,
			// native JSON output: this model rejects the forced tool call the
			// provider's default structured-output mode relies on
			providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } },
			maxOutputTokens: 8000,
			system: SYSTEM,
			prompt: `Month: ${String(body?.monthName ?? body?.month ?? '')}\n\nCounts (exact, computed on-device):\n${JSON.stringify(
				body?.stats ?? {}
			)}\n\nEntries, oldest first:\n\n${journal}`
		});
		return json(object);
	} catch (e) {
		console.error('recap failed', e);
		throw error(502, 'Could not write the letter.');
	}
};
