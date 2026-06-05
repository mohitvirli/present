import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// An empty/placeholder var in the ambient shell (e.g. ANTHROPIC_API_KEY="")
// shadows the value in .env, because process.env takes precedence over .env
// files in Vite/SvelteKit. Parse the .env files directly (bypassing that
// precedence) and restore any value the ambient env is missing or has blank.
function restoreBlankEnvFromFiles(mode: string) {
	const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
	for (const file of files) {
		const path = resolve(process.cwd(), file);
		if (!existsSync(path)) continue;
		for (const line of readFileSync(path, 'utf8').split('\n')) {
			const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			const key = m[1];
			const val = m[2].replace(/^(['"`])(.*)\1$/, '$2');
			if (val && !process.env[key]) process.env[key] = val;
		}
	}
}

export default defineConfig(({ mode }) => {
	restoreBlankEnvFromFiles(mode);

	return {
		plugins: [sveltekit()]
	};
});
