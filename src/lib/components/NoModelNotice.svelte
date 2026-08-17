<script lang="ts">
  /**
   * Shown where a model is required but the project has none: above the program
   * list in Programmieren, and in place of the prediction in Anwenden. Both
   * ways out are offered right here — bring a model in from a ZIP, or go record
   * material and train one — so neither view dead-ends on an empty model list.
   */
  import { goto } from '$app/navigation';
  import { importModelFile } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';

  let {
    variant = 'banner',
    title = 'Noch kein Modell vorhanden',
    message = 'Trainiere ein Modell mit deinen eigenen Bildern oder importiere ein fertiges Modell.',
  }: { variant?: 'banner' | 'panel'; title?: string; message?: string } = $props();

  let fileEl: HTMLInputElement | null = $state(null);
  let importing = $state(false);

  async function onImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    importing = true;
    try {
      const model = await importModelFile(input.files[0]);
      showNotification(model ? 'Modell importiert' : 'Modell konnte nicht gelesen werden', {
        type: model ? 'success' : 'error',
      });
    } catch (err) {
      showNotification('Fehler beim Import: ' + (err as Error).message, { type: 'error' });
    } finally {
      importing = false;
      input.value = '';
    }
  }
</script>

<div class="no-model" class:panel={variant === 'panel'}>
  <div class="text">
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
  <div class="actions">
    <button type="button" class="primary" onclick={() => goto('/training')}>
      Modell trainieren
    </button>
    <button type="button" onclick={() => fileEl?.click()} disabled={importing}>
      {importing ? 'Importiere…' : 'Modell importieren'}
    </button>
  </div>
  <input
    bind:this={fileEl}
    type="file"
    accept=".zip"
    style="display:none"
    onchange={onImport}
  />
</div>

<style lang="scss">
  .no-model {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid rgba(var(--md-primary), 0.35);
    border-radius: 10px;
    background: rgba(var(--md-primary-container), 0.35);
  }
  // In Anwenden the notice sits alone over the black camera stage, so it needs
  // its own surface instead of a tint of whatever is behind it.
  .no-model.panel {
    background: rgba(255, 255, 255, 0.96);
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    padding: 20px 22px;
    max-width: 420px;
    text-align: center;
    align-items: center;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    strong {
      font-size: 13px;
      color: rgb(var(--md-on-surface));
    }
    span {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      line-height: 1.4;
    }
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  button {
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid rgb(var(--md-outline));
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
    cursor: pointer;
    min-height: unset;
    box-shadow: none;

    &:hover:not(:disabled) {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary), 0.08);
    }
    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
    &.primary {
      background: rgb(var(--md-primary));
      border-color: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      &:hover:not(:disabled) {
        filter: brightness(0.95);
        background: rgb(var(--md-primary));
      }
    }
  }
</style>
