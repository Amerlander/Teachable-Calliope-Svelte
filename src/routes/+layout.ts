import { browser } from '$app/environment';
import { SOURCE_LANG, setLang } from '$lib/stores/app';

export const prerender = true;
export const ssr = false;

// wuchale serves placeholders until a catalog has been registered for the active
// locale — including the source one — so the first paint has to wait for it.
// This runs in the browser only: with `ssr = false` the prerender step emits a
// shell and never calls `load`.
export const load = async () => {
	if (browser) await setLang(SOURCE_LANG);
};
