<script lang="ts">
  import '$lib/styles/global.scss';
  import favicon from '$lib/assets/favicon.svg';
  import Header from '$lib/components/Header.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import LanguageOverlay from '$lib/components/LanguageOverlay.svelte';
  import AIInfoOverlay from '$lib/components/AIInfoOverlay.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { initApp } from '$lib/machine';
  import {
    currentProject,
    getLastProjectId,
    loadProject,
    refreshProjectList,
  } from '$lib/stores/projects';
  import { loadClassifierFromArtifacts } from '$lib/machine';
  import {
    initializeCalliopeConnection,
    UsbPlugRequestModal,
    BlePairingInfoModal,
  } from '@calliope-edu/mini-connection-widget';

  let { children } = $props();

  // Hydrate the last-used project before any page renders so /training,
  // /tryout and /apply don't bounce back to the start screen on reload.
  let restored = $state(false);

  onMount(async () => {
    initApp();
    initializeCalliopeConnection();
    try {
      await refreshProjectList();
      if (!get(currentProject)) {
        const lastId = getLastProjectId();
        if (lastId) {
          const p = await loadProject(lastId);
          if (p?.modelArtifacts) {
            try { await loadClassifierFromArtifacts(p.modelArtifacts); } catch { /* ignore */ }
          }
        }
      }
    } finally {
      restored = true;
    }
  });
</script>

<svelte:head>
  <title>Calliope Teachable Machine</title>
  <link rel="icon" href={favicon} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<LanguageOverlay />
<AIInfoOverlay />
<UsbPlugRequestModal />
<BlePairingInfoModal />
<Toast />
<Header />

<div class="app">
  {#if restored}
    {@render children()}
  {/if}
</div>
