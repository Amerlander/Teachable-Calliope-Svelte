import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// The widget's live source checkout in the superrepo. Used in dev only — see
// `_linkWidget` below.
const _widgetSrc = fileURLToPath(
	new URL('../../../lib/mini-connection-widget/src/index.ts', import.meta.url)
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
		plugins: [
			sveltekit(),
			paraglideVitePlugin({
				project: './project.inlang',
				outdir: './src/lib/paraglide'
			})
		],
		resolve: {
			// The widget checkout carries its own node_modules, so without this the
			// linked copy would pull a second svelte / microbit-connection /
			// nrf-intel-hex instance instead of sharing ours.
			dedupe: ['svelte', '@microbit/microbit-connection', 'nrf-intel-hex'],
			alias: _linkWidget ? { '@calliope-edu/mini-connection-widget': _widgetSrc } : {}
		},
		optimizeDeps: {
			// The widget ships unbuilt source: its entry is `src/index.ts` and it
			// imports `.svelte` files, which esbuild has no loader for. Harmless while
			// it was a `link:` dep (Vite treats linked packages as source), but it is
			// pinned to a commit now and installs as a real node_modules package, so
			// the dep optimizer would try to prebundle it and fail.
			exclude: ['@calliope-edu/mini-connection-widget'],
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
