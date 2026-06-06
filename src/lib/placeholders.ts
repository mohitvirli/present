// Time-of-day + weekend aware editor placeholders, mixing three registers
// (plain, poetic, playful) so each new entry greets you a little differently.

const ANCHOR = "Be present. Write what's here now.";

const BUCKETS: Record<string, string[]> = {
	// 0–4
	late: [
		'Still up? What’s keeping you awake?',
		'Can’t sleep? What’s going on?',
		'The hour is honest. What’s keeping you company tonight?',
		'In the dark, things feel truer. What’s true right now?',
		'It’s late and you know it. What’s the thought?',
		'3am brain hits different. What’s it saying?'
	],
	// 5–7
	early: [
		'Good morning. What’s on your mind?',
		'How are you starting today?',
		'The light is still deciding. What do you want today to hold?',
		'Morning hasn’t asked anything of you yet. What will you ask of it?',
		'Up early, huh? Spill it.',
		'Brain’s booting. What’s the first thought in the queue?'
	],
	// 8–10
	morning: [
		'What’s the plan for today?',
		'What matters most this morning?',
		'The day is wide open. What deserves your attention before the rush takes it?',
		'Somewhere today a small kindness waits. Where might you leave one?',
		'Coffee in? Good. What are we doing today?',
		'Today’s still a blank page. Don’t waste it on autopilot.'
	],
	// 11–13
	midday: [
		'How’s the day going so far?',
		'Taking a break? What’s up?',
		'The day is half-spoken. What has it told you so far?',
		'If you stopped pretending you’re fine for a second — how are you, really?',
		'Halftime. What’s the score?',
		'Quick gut check: today — winning or surviving?'
	],
	// 14–17
	afternoon: [
		'How are you feeling right now?',
		'What’s been on your mind today?',
		'The light is slanting now. What’s softened since this morning?',
		'Name one thing you’re grateful for that you almost walked past.',
		'Afternoon slump or second wind? Talk.',
		'What’s living rent-free in your head today?'
	],
	// 18–21
	evening: [
		'How was your day?',
		'What happened today?',
		'The day is folding in. What of it do you want to keep?',
		'What did you feel today that you didn’t say out loud?',
		'Debrief time. How’d today actually go?',
		'Best part, worst part — go.'
	],
	// 22–23
	night: [
		'Winding down? What’s on your mind?',
		'How are you ending the day?',
		'The day has gone quiet. What’s still awake in you?',
		'Lay it down here. What are you ready to stop carrying?',
		'One last thought before lights out?',
		'Dump the mental tabs before bed. Go.'
	]
};

const WEEKEND: string[] = [
	'It’s the weekend. What’s on your mind?',
	'No hands on the clock today. Where does your mind drift?',
	'Weekend mode. What’s good?'
];

const SUNDAY_EVENING = 'One week closes, another waits. What do you leave behind here?';

function bucketFor(hour: number): string {
	if (hour < 5) return 'late';
	if (hour < 8) return 'early';
	if (hour < 11) return 'morning';
	if (hour < 14) return 'midday';
	if (hour < 18) return 'afternoon';
	if (hour < 22) return 'evening';
	return 'night';
}

// Pick a placeholder appropriate to the current day/time. Pass a Date for tests.
export function pickPlaceholder(now: Date = new Date()): string {
	const hour = now.getHours();
	const day = now.getDay(); // 0 Sun … 6 Sat
	const weekend = day === 0 || day === 6;

	const pool = [...BUCKETS[bucketFor(hour)], ANCHOR];
	if (weekend) pool.push(...WEEKEND);
	if (day === 0 && hour >= 18) pool.push(SUNDAY_EVENING);

	return pool[Math.floor(Math.random() * pool.length)];
}
