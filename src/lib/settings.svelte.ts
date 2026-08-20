import { browser } from '$app/environment';

const AI_KEY = 'present:ai-enabled';
const MIC_KEY = 'present:mic-enabled';
const CAL_KEY = 'present:calendar-enabled';
const SPELL_KEY = 'present:spellcheck-enabled';

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

// The month calendar beside the timeline defaults on.
function initialCalendar(): boolean {
	if (!browser) return true;
	return localStorage.getItem(CAL_KEY) !== '0';
}

// Spell check defaults on, matching the browser's own default.
function initialSpellcheck(): boolean {
	if (!browser) return true;
	return localStorage.getItem(SPELL_KEY) !== '0';
}

export const aiSettings = $state<{ enabled: boolean }>({ enabled: initialAi() });
export const micSettings = $state<{ enabled: boolean }>({ enabled: initialMic() });
export const calendarSettings = $state<{ enabled: boolean }>({ enabled: initialCalendar() });
export const spellcheckSettings = $state<{ enabled: boolean }>({ enabled: initialSpellcheck() });

export function setAiEnabled(on: boolean): void {
	aiSettings.enabled = on;
	if (browser) localStorage.setItem(AI_KEY, on ? '1' : '0');
}

export function setMicEnabled(on: boolean): void {
	micSettings.enabled = on;
	if (browser) localStorage.setItem(MIC_KEY, on ? '1' : '0');
}

export function setCalendarEnabled(on: boolean): void {
	calendarSettings.enabled = on;
	if (browser) localStorage.setItem(CAL_KEY, on ? '1' : '0');
}

export function setSpellcheckEnabled(on: boolean): void {
	spellcheckSettings.enabled = on;
	if (browser) localStorage.setItem(SPELL_KEY, on ? '1' : '0');
}
