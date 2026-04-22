<script lang="ts">
  import '$lib/styles/global.scss';
  import favicon from '$lib/assets/favicon.svg';
  import Header from '$lib/components/Header.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import LanguageOverlay from '$lib/components/LanguageOverlay.svelte';
  import AIInfoOverlay from '$lib/components/AIInfoOverlay.svelte';
  import { onMount } from 'svelte';
  import { initApp } from '$lib/machine';

  let { children } = $props();

  onMount(() => { initApp(); });
</script>

<svelte:head>
  <title>Calliope Teachable Machine</title>
  <link rel="icon" href={favicon} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<LanguageOverlay />
<AIInfoOverlay />
<Toast />
<Header />

<div class="app">
  {@render children()}
</div>
