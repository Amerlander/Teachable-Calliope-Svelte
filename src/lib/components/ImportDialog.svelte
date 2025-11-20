<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { classes, addClass, activeClass } from '$lib/stores';
  export let open = false;
  export let images: string[] = [];
  export let detectedClass: string | null = null;
  const dispatch = createEventDispatcher();
  let selectedClass: string | null = detectedClass || null;
  let newClassName = '';

  onMount(() => {
    if (!selectedClass) {
      selectedClass = detectedClass || ($activeClass || null);
    }
  });

  function cancel() {
    open = false;
    dispatch('cancel');
  }
  function confirm() {
    if (!selectedClass && newClassName.trim()) {
      addClass(newClassName.trim());
      selectedClass = newClassName.trim();
      newClassName = '';
    }
    dispatch('confirm', { images, selectedClass });
    open = false;
  }
</script>

{#if open}
  <div class="dialog-overlay" role="button" tabindex="0" aria-label="Close import dialog" on:click={cancel} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') cancel(); }}></div>
  <div class="import-dialog">
    <h3>Bilder importieren</h3>
    <p id="import-message">{images.length} Bilder importieren. Wähle eine Klasse:</p>
    <div class="import-classes">
      <div role="group" aria-label="Vorhandene Klassen">
        <div class="class-list">
          {#each $classes as c}
            <button type="button" class="class-item {c === selectedClass ? 'selected' : ''}" on:click={() => selectedClass = c} aria-pressed={c === selectedClass}>{c}</button>
          {/each}
        </div>
      </div>
      <div style="margin-top:8px;">
        <label for="new-class">Neue Klasse erstellen:</label>
        <div style="display:flex;gap:4px;margin-top:4px;">
          <input id="new-class" type="text" bind:value={newClassName} placeholder="Name für neue Klasse" />
          <button class="ghost" on:click={() => { if (newClassName.trim()) { addClass(newClassName.trim()); selectedClass = newClassName.trim(); newClassName=''; } }}>Erstellen</button>
        </div>
      </div>
    </div>
    <div class="buttons">
      <button class="ghost" on:click={cancel}>Abbrechen</button>
      <button on:click={confirm}>Importieren</button>
    </div>
  </div>
{/if}
