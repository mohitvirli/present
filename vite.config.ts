import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Opt-in local HTTPS (set HTTPS=1, e.g. `npm run dev:https`). Serving over HTTPS
// gives a secure context so getUserMedia works on phones over the LAN. Off by
// default so the in-app http preview can still reach the dev server. The cert is
// signed by a local mkcert CA that isn't system-trusted, so browsers show a
// one-time warning to click through — no sudo, no plugin running at startup.
function localHttps() {
	if (!process.env.HTTPS) return undefined;
	const key = resolve(process.cwd(), '.certs/key.pem');
	const cert = resolve(process.cwd(), '.certs/cert.pem');
	if (existsSync(key) && existsSync(cert)) {
		return { key: readFileSync(key), cert: readFileSync(cert) };
	}
	return undefined;
}

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

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
	version: string;
};

export default defineConfig(({ mode }) => {
	restoreBlankEnvFromFiles(mode);

	return {
		define: {
			__APP_VERSION__: JSON.stringify(pkg.version)
		},
		plugins: [sveltekit()],
		// host:true binds 0.0.0.0 so the LAN (phone) can reach it; https from the
		// local cert when present. Git worktrees under .claude/worktrees/ have no
		// node_modules of their own — deps resolve up into the main repo, so Vite
		// must be allowed to serve files from there too.
		server: {
			host: true,
			https: localHttps(),
			fs: (() => {
				const m = process.cwd().match(/^(.*)\/\.claude\/worktrees\/[^/]+$/);
				return m ? { allow: [process.cwd(), m[1]] } : undefined;
			})()
		}
	};
});
