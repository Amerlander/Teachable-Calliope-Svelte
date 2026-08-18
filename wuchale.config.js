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
	// `'add'` instead of the default `'refs'`. The catalog index is positional and
	// recomputed from scratch by every process that loads the plugin: it numbers
	// the *still-referenced* .po entries densely, so the moment an entry loses its
	// last reference it drops out of the numbering and every entry after it shifts
	// — while the running dev server keeps the old numbers baked into the modules
	// it has already transformed. `'refs'` is what removes those references (see
	// `modifyExistingRefs` in wuchale/dist/handler/index.js), and editing a single
	// German string was enough to trigger it: the whole UI came back scrambled.
	// `'add'` still extracts new strings live, but never un-references an existing
	// one, so the .po — and with it the numbering — only ever grows. Dead entries
	// pile up until `npm run i18n:clean`, which prunes them properly because the
	// CLI does update references.
	dev: 'add',
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
