import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Split out of vite.config.ts on purpose.
//
// The vitest setup used `projects: [{ extends: './vite.config.ts', … }]`, i.e.
// vite.config.ts pointed `extends` back at itself. That re-evaluated the config
// while it was already being loaded, so `sveltekit()` produced more than one
// vite-plugin-svelte instance — and the instance answering a component's
// `?svelte&type=style` request was not the one that had compiled the component
// and cached its CSS. The cache missed, Vite's CSS pipeline read the .svelte
// file off disk instead, and the raw source was injected as a stylesheet. Every
// component in the app lost part of its styling that way; the app header lost
// its background entirely because its rule sits first in the block, where the
// browser's CSS parser was still recovering from the `<script>` text.
//
// Here `extends` refers to a different module, and `vite dev` never loads this
// file at all. vitest prefers vitest.config.* over vite.config.*, so the test
// scripts need no change.
export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
