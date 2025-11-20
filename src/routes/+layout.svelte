<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/components/Header.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import '$lib/styles/legacy.css';
	import { onMount } from 'svelte';
	import { init as initApp } from '$lib/machine';

	let { children } = $props();
	onMount(() => { initApp(); });
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Toast />

<Header />

 
<div class="app">
{@render children()}
</div>

