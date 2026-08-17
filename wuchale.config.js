// @ts-check
import { defineConfig } from 'wuchale';
import { adapter as svelte, svelteDefaultHeuristic } from '@wuchale/svelte';
import { adapter as js, defaultArgs as jsDefaults } from 'wuchale/adapter-vanilla';

/**
 * `KeyboardEvent.key` values. wuchale's default heuristic sees `e.key === 'Enter'`
 * as a capitalised string inside a function and happily extracts it — a translated
 * `'Enter'` would silently break every keyboard handler in the app. There is no
 * syntactic signal to key off, so the names are denied by value.
 */
const DOM_KEY_NAMES = new Set([
	'Enter',
	'Escape',
	'Tab',
	'Delete',
	'Backspace',
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Home',
	'End',
	'PageUp',
	'PageDown',
	'Shift',
	'Control',
	'Alt',
	'Meta'
]);

/**
 * Product, architecture and algorithm names. They read like UI text and sit in
 * label maps, but they are the same in every language — keeping them out of the
 * catalogs saves translators from confirming 10 identical strings.
 */
const PROPER_NOUNS = new Set([
	'MobileNet v1',
	'MobileNet v2',
	'MobileNet v1 Lite',
	'MobileNet v1 (α=1.0)',
	'MobileNet v2 (α=1.0)',
	'MobileNet v1 Lite (α=0.5)',
	'Adam',
	'SGD',
	'RMSProp',
	'JavaScript',
	'Python',
	'Teachable',
	'Teachable Project',
	'Teachable Machine Model'
]);

const isVerbatim = (msg) => {
	const text = msg.msgStr.join('');
	return DOM_KEY_NAMES.has(text) || PROPER_NOUNS.has(text);
};

// Each adapter's own default has to be called explicitly: passing `heuristic`
// *replaces* it rather than extending it, and returning `undefined` then falls
// back to the generic default, not the adapter's. For Svelte that silently
// dropped the rule which extracts top-level `const` strings — the language
// picker's labels vanished from the catalog until this was composed by hand.
const denying = (base) => (msg) => (isVerbatim(msg) ? false : base(msg));

// The UI is written in German, so `de` is the source locale (first entry) and
// `en` is the only translation target — matching the two languages the app has
// ever actually shipped.
export default defineConfig({
	locales: ['de', 'en'],
	adapters: {
		// Components. `loader: 'svelte'` rather than `'sveltekit'`: the app runs
		// with `ssr = false` (see src/routes/+layout.ts), so it is a prerendered
		// SPA and there is no per-request locale on a server to isolate.
		main: svelte({
			loader: 'svelte',
			heuristic: denying(svelteDefaultHeuristic),
			files: {
				include: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
				ignore: ['src/stories/**', 'src/**/*.spec.*']
			}
		}),
		// Plain modules: stores and helpers that carry status texts and
		// notification messages.
		js: js({
			loader: 'vite',
			heuristic: denying(jsDefaults.heuristic),
			files: {
				include: ['src/**/*.{js,ts}'],
				ignore: [
					'src/**/*.spec.*',
					'src/**/*.d.ts',
					'src/locales/**',
					// Code generators, not UI: these build MakeCode project files, so
					// their strings are TypeScript identifiers, pxt.json fields and
					// README text that ships inside the generated extension.
					'src/lib/makecode/**',
					// Low-level BLE helper — everything quotable in there is either a
					// GATT device name filter or a debug log line.
					'src/lib/bluetooth/**',
					// Unreferenced reference copy from the micro:bit ml-trainer.
					'src/lib/components/training/React1.js'
				]
			}
		})
	}
});
