import { browser } from '$app/environment';
import { SOURCE_LANG, setLang } from '$lib/stores/app';

export const prerender = true;
export const ssr = false;
// Static hosts map a URL to a file, so `/training` only resolves if Apache is
// content-negotiating it into `training.html` — Strato's is not. With the
// trailing slash the prerender step writes `training/index.html` instead, which
// every server serves as a directory index without any config.
export const trailingSlash = 'always';

// wuchale serves placeholders until a catalog has been registered for the active
// locale — including the source one — so the first paint has to wait for it.
// This runs in the browser only: with `ssr = false` the prerender step emits a
// shell and never calls `load`.
export const load = async () => {
	if (browser) await setLang(SOURCE_LANG);
};
