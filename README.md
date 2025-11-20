# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Migrating legacy index.html

This project contains a port of the legacy `legacy/index.html` to SvelteKit.

Key files and components created during the migration:

- `src/lib/styles/legacy.css` — global CSS adapted from the legacy file
- `src/lib/components/Header.svelte` — top navigation and logo
- `src/lib/components/training/TrainingLeft.svelte` — left panel: class list, capture, model controls
- `src/lib/components/training/TrainingRight.svelte` — right panel: video, tabs, and prediction UI
- `src/lib/components/tryout/TryoutLeft.svelte` — tryout left panel with bluetooth controls
- `src/lib/components/tryout/TryoutRight.svelte` — MakeCode iframe container
- `src/lib/components/Thumbs.svelte` — thumbnail gallery for captured images
- `src/lib/components/ModelDetailsDialog.svelte` — modal with model statistics and charts
- `src/lib/components/ImportDialog.svelte` — basic import dialog wrapper
- `src/lib/machine.ts` — pure-client helper wrappers for camera, TensorFlow, and saving/loading
- `src/lib/stores.ts` — central Svelte stores for app state

Routes:
- `/training` — main training UI (left/right split)
- `/tryout` — tryout view with MakeCode embedding and Calliope integration

I removed the single-file JS/HTML approach and split the UI into modular Svelte components, with a central `machine.ts` helper and Svelte stores for shared state. This makes it easier to maintain and create tests/stories per component.


## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
