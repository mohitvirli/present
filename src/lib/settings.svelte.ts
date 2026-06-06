import { browser } from '$app/environment';

const AI_KEY = 'present:ai-enabled';
const MIC_KEY = 'present:mic-enabled';

// AI features are opt-in: off unless the user explicitly enabled them before.
function initialAi(): boolean {
	if (!browser) return false;
	return localStorage.getItem(AI_KEY) === '1';
}

// Microphone features default on.
function initialMic(): boolean {
	if (!browser) return true;
	return localStorage.getItem(MIC_KEY) !== '0';
}

export const aiSettings = $state<{ enabled: boolean }>({ enabled: initialAi() });
export const micSettings = $state<{ enabled: boolean }>({ enabled: initialMic() });

export function setAiEnabled(on: boolean): void {
	aiSettings.enabled = on;
	if (browser) localStorage.setItem(AI_KEY, on ? '1' : '0');
}

export function setMicEnabled(on: boolean): void {
	micSettings.enabled = on;
	if (browser) localStorage.setItem(MIC_KEY, on ? '1' : '0');
}
