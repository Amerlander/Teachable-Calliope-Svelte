<script lang="ts">
	import { goto } from '$app/navigation';
	function openTraining() {
		goto('/training');
	}
</script>

<main style="padding: 24px;">
	<h1>Welcome — Teachable Calliope</h1>
	<p>This SvelteKit project hosts a modern port of the legacy Teachable Machine UI.</p>
	<div style="margin-top: 24px;">
		<button on:click={openTraining} class="primary-action">Open Training</button>
		<a href="/tryout" style="margin-left:12px;" class="header-btn">Open Tryout</a>
	</div>
</main>
