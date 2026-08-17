import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { wuchale } from 'wuchale/vite';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// The widget's live source checkout in the superrepo. Used in dev only — see
// `_linkWidget` below.
const _widgetSrc = fileURLToPath(
	new URL('../../../lib/mini-connection-widget/src/index.ts', import.meta.url)
);
// The `./makecode` subpath (embedded MakeCode host) needs its own alias: Vite
// matches string alias keys exactly, so the bare-specifier entry below does not
// cover it, and this import alone would fall back to the pinned copy.
const _widgetMakeCodeSrc = fileURLToPath(
	new URL('../../../lib/mini-connection-widget/src/makecode/index.ts', import.meta.url)
);

export default defineConfig(({ command }) => {
	// Serve the widget from its checkout during dev instead of the pinned
	// node_modules copy.
	//
	// This is not just a convenience: vite-plugin-svelte does not serve the
	// `?svelte&type=style` sub-request for .svelte files that live inside
	// node_modules, so Vite's CSS pipeline answers it by reading the file off
	// disk — the raw .svelte source ends up injected as a stylesheet. The
	// browser then parses whatever of it happens to be valid CSS (modern
	// browsers accept the SCSS-looking nesting), which is why the connect UI
	// rendered half-styled instead of visibly failing. From a path outside
	// node_modules the plugin handles the file normally and the SCSS compiles.
	//
	// Set WIDGET_PINNED=1 to force the node_modules copy (mirrors campus).
	const _linkWidget =
		command === 'serve' && process.env.WIDGET_PINNED !== '1' && existsSync(_widgetSrc);
	// eslint-disable-next-line no-console
	console.log(
		`[vite] mini-connection-widget: ${_linkWidget ? 'LINKED (live source) → ' + _widgetSrc : 'PINNED (package.json sha)'}`
	);

	return {
		// wuchale has to run before sveltekit so it sees the untransformed
		// components: it extracts the German source text and rewrites it into
		// catalog lookups. Configured in wuchale.config.js.
		plugins: [wuchale(), sveltekit()],
		resolve: {
			// The widget checkout carries its own node_modules, so without this the
			// linked copy would pull a second svelte / microbit-connection /
			// nrf-intel-hex instance instead of sharing ours.
			// `@microbit/makecode-embed` is listed for resolution as much as dedupe:
			// the linked widget source sits outside this tree and has no copy of it,
			// so the MakeCode host's imports must resolve from our root.
			dedupe: [
				'svelte',
				'@microbit/microbit-connection',
				'nrf-intel-hex',
				'@microbit/makecode-embed'
			],
			// Typed as a record so both ternary branches share one shape; an
			// inferred union of "two keys" and "no keys" doesn't satisfy
			// AliasOptions.
			alias: (_linkWidget
				? {
						// Longest specifier first — Vite replaces on exact match.
						'@calliope-edu/mini-connection-widget/makecode': _widgetMakeCodeSrc,
						'@calliope-edu/mini-connection-widget': _widgetSrc
					}
				: {}) as Record<string, string>
		},
		optimizeDeps: {
			// The widget ships unbuilt source: its entry is `src/index.ts` and it
			// imports `.svelte` files, which esbuild has no loader for. Harmless while
			// it was a `link:` dep (Vite treats linked packages as source), but it is
			// pinned to a commit now and installs as a real node_modules package, so
			// the dep optimizer would try to prebundle it and fail.
			exclude: [
				'@calliope-edu/mini-connection-widget',
				'@calliope-edu/mini-connection-widget/makecode'
			],
			// Excluding the widget means Vite never crawls its imports, so its
			// transitive deps go un-prebundled too. `nrf-intel-hex` (imported as
			// MemoryMap by four widget modules) ships a UMD `browser` build with no
			// ESM exports, which Vite prefers over its `module` entry — the import
			// then fails with "does not provide an export named 'default'".
			// Force-include it so esbuild converts it to ESM with a real default.
			include: ['nrf-intel-hex']
		},
		server: {
			// Let Vite serve the widget checkout (three levels up, under lib/) and
			// its node_modules. Only needed while `_linkWidget` is on.
			fs: { allow: ['..', '../..', '../../..'] }
		}
	};
});
