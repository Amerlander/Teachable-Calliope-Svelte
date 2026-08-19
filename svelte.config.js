import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		// `fallback` is the safety net for anything the prerender step did not emit
		// (see static/.htaccess). It is a plain SPA shell — with `ssr = false` that
		// is what the real pages are too, so nothing is lost by falling back to it.
		adapter: adapter({ fallback: '200.html' })
	},
	vitePlugin: {
		inspector: {
		  toggleKeyCombo: 'control-y'
		},
	},
};

export default config;
