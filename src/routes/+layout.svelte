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
  import { ensureActiveModelLoaded } from '$lib/models';
  import {
    initializeCalliopeConnection,
    setSerialConsumer,
    UsbPlugRequestModal,
    BleOfflineModal,
    ConnectionChoiceModal,
    Mini2FlashFallbackModal,
    Mini2SerialOfferModal,
    Mini12VersionModal,
    ConnectionBanner,
  } from '@calliope-edu/mini-connection-widget';

  let { children } = $props();

  // Hydrate the last-used project before any page renders so /training,
  // /tryout and /apply don't bounce back to the start screen on reload.
  let restored = $state(false);

  // The banner's default layout is a fixed toast at `top: 16px` with z-index
  // 8000, which #main-header (z-index 100000000, a grid item, so it honours it)
  // would paint straight over. Portal it into the content row instead — it then
  // positions absolutely inside, landing just below the header.
  let appEl: HTMLDivElement | undefined = $state();

  onMount(async () => {
    initApp();
    initializeCalliopeConnection();
    // Teachable streams classification lines the whole time it runs, so it is
    // always a serial consumer. Declaring it lets the widget offer the mini 2's
    // CDC port when that board is linked flash-only — without the declaration
    // it stays silent and the streaming would go nowhere.
    setSerialConsumer('teachable', true);
    try {
      await refreshProjectList();
      if (!get(currentProject)) {
        const lastId = getLastProjectId();
        if (lastId) {
          const p = await loadProject(lastId);
          // Bring back the model the project had selected. Falls back to the
          // stored artifacts for projects whose model list predates them
          // being the single source of truth.
          try {
            const restored = await ensureActiveModelLoaded();
            if (!restored && p?.modelArtifacts) {
              await loadClassifierFromArtifacts(p.modelArtifacts);
            }
          } catch { /* ignore */ }
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
  <!-- The Inter webfont is declared in src/app.html, not here — see the comment there. -->
</svelte:head>

<LanguageOverlay />
<AIInfoOverlay />
<!-- Every widget modal below is a host-owned singleton driven by a store that
     carries a pending promise or callback, so each one has to be mounted or its
     flow dead-ends: the choice modal is what `flashCalliope()` awaits when
     nothing is connected, and the mini 2 / mini 1-vs-2 modals are the only exits
     from a failed USB transfer, a missing CDC link, and the BLE RAM-fit gate. -->
<UsbPlugRequestModal />
<BleOfflineModal />
<ConnectionChoiceModal />
<Mini2FlashFallbackModal />
<Mini2SerialOfferModal />
<Mini12VersionModal />
<Toast />
<Header />

<div class="app" bind:this={appEl}>
  {#if restored}
    {@render children()}
  {/if}
</div>

<!-- After `.app` so `appEl` is bound before the banner can mount. It portals
     itself, so its position here doesn't affect where it appears. This is also
     the only component that can reach `confirmReplug()`, so it owns the USB
     recovery ladder. -->
<ConnectionBanner container={appEl} />
