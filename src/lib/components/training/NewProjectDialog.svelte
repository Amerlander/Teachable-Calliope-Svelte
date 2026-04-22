<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import type { ProjectMode } from '$lib/stores/projects';

  let {
    isOpen = $bindable(false),
    onsubmit,
    oncancel
  }: {
    isOpen?: boolean;
    onsubmit?: (name: string, mode: ProjectMode) => void;
    oncancel?: () => void;
  } = $props();

  let name = $state('');
  let mode = $state<ProjectMode>('image');

  function defaultName(): string {
    return `Neues Projekt ${new Date().toLocaleDateString('de-DE')}`;
  }

  $effect(() => {
    if (isOpen && !name) {
      name = defaultName();
    }
  });

  function submit() {
    const trimmed = name.trim() || defaultName();
    onsubmit?.(trimmed, mode);
    reset();
  }

  function cancel() {
    oncancel?.();
    reset();
  }

  function reset() {
    isOpen = false;
    name = '';
    mode = 'image';
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') submit();
  }
</script>

<Modal title="Neues Projekt" {isOpen} onclose={cancel}>
  {#snippet children()}
    <div class="form">
      <label class="field">
        <span class="field-label">Name</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" bind:value={name} onkeydown={onNameKey} autofocus />
      </label>

      <div class="field">
        <span class="field-label">Projekttyp</span>
        <div class="mode-grid">
          <button
            type="button"
            class="mode-card"
            class:selected={mode === 'image'}
            onclick={() => (mode = 'image')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 309.5 198">
              <rect fill="#9ec41a" width="309.5" height="198" rx="5.6" ry="5.6" />
              <path
                fill="#58b364"
                d="M227.1,80.7c-2.1-3.6-7.4-3.6-9.4,0l-9.7,16.8c-2.1,3.6-7.4,3.6-9.4,0l-28.2-48.9c-2.1-3.6-7.4-3.6-9.4,0l-36.5,59c-2.1,3.4-7,3.3-9,0l-15.9-27.6c-2.1-3.6-7.3-3.6-9.4,0l-38.3,66.3c-2.1,3.6.5,8.2,4.7,8.2h114.9c4.2,0,6.8-4.6,4.7-8.2l-9.5-16.4,24.9-.4,22.4,1.5,45.9-1.7-32.6-48.3Z"
              />
              <rect fill="#fff" x="130.8" y="123.7" width="158.7" height="39.7" rx="2.8" ry="2.8" />
              <rect fill="rgba(158,196,26,0.5)" x="136.4" y="146.4" width="146.5" height="11.3" rx=".9" ry=".9" />
              <rect fill="#9ec41a" x="136.4" y="146.4" width="18.3" height="11.3" rx=".9" ry=".9" />
              <rect fill="rgba(158,196,26,0.5)" x="136.4" y="129.4" width="146.5" height="11.3" rx=".9" ry=".9" />
              <rect fill="#9ec41a" x="136.4" y="129.4" width="137.2" height="11.3" rx=".9" ry=".9" />
            </svg>
            <div class="name">Objekt</div>
            <div class="desc">Mit Kamerabildern trainieren</div>
          </button>

          <button
            type="button"
            class="mode-card"
            class:selected={mode === 'pose'}
            onclick={() => (mode = 'pose')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 309.5 198">
              <rect fill="#00e5ff" width="309.5" height="198" rx="5.6" ry="5.6" />
              <path
                fill="#42a5f5"
                d="M158.3,87.7c-18.9,0-34.2-15.3-34.2-34.2s15.4-34.2,34.2-34.2,34.2,15.4,34.2,34.2-15.4,34.2-34.2,34.2ZM158.3,28.2c-13.9,0-25.3,11.3-25.3,25.3s11.3,25.3,25.3,25.3,25.3-11.3,25.3-25.3-11.3-25.3-25.3-25.3Z"
              />
              <path
                fill="#5d3d99"
                d="M173.1,168.5h-29.7c-9.1,0-12.5-6-13.1-9.2v-49.1h8.9v47.7c.3.6,1.2,1.7,4.2,1.7h29.7c3,0,3.9-1.1,4.2-1.7v-47.7h8.9v48.4c-.6,3.9-4,10-13.1,10Z"
              />
              <path
                fill="#d8b6ff"
                d="M213.6,168.6l-37.3-58.8c-1.7-1.7-9-8.4-14.6-8.4h-6.8c-5.6,0-13,6.7-15.1,9l-36.8,58.2-7.5-4.8,37.3-58.8c1.6-1.8,11.6-12.6,22.2-12.6h6.8c10.6,0,20.6,10.7,21.7,12l37.7,59.4-7.5,4.8Z"
              />
              <rect fill="#fff" x="140.8" y="117.7" width="149.7" height="39.7" rx="2.8" ry="2.8" />
              <rect fill="#f2e9ff" x="146.4" y="140.4" width="137.5" height="11.3" rx=".9" ry=".9" />
              <rect fill="#d8b6ff" x="146.4" y="140.4" width="18.3" height="11.3" rx=".9" ry=".9" />
              <rect fill="#f2e9ff" x="146.4" y="123.4" width="137.5" height="11.3" rx=".9" ry=".9" />
              <rect fill="#d8b6ff" x="146.4" y="123.4" width="128.2" height="11.3" rx=".9" ry=".9" />
            </svg>
            <div class="name">Pose</div>
            <div class="desc">Mit Körperposen trainieren</div>
          </button>
        </div>
        <div class="hint">Der Projekttyp kann nachträglich nicht mehr geändert werden.</div>
      </div>
    </div>
  {/snippet}

  {#snippet actions()}
    <button class="ghost" onclick={cancel}>Abbrechen</button>
    <button onclick={submit}>Projekt anlegen</button>
  {/snippet}
</Modal>

<style lang="scss">
  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgb(var(--md-on-surface-variant));
  }
  .mode-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .mode-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px;
    background: rgb(var(--md-surface-variant));
    border: 2px solid transparent;
    border-radius: var(--md-radius-md);
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: none;
    min-height: unset;
    color: rgb(var(--md-on-surface));
    svg {
      width: 100%;
      max-width: 140px;
      height: auto;
      border-radius: var(--md-radius-sm);
    }
    .name {
      font-size: 15px;
      font-weight: 600;
    }
    .desc {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      text-align: center;
    }
    &:hover {
      border-color: rgba(var(--md-primary), 0.4);
    }
    &.selected {
      border-color: rgb(var(--md-primary));
      background: rgb(var(--md-primary-container));
    }
  }
  .hint {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
</style>
