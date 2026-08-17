<script lang="ts">
  /**
   * Picks one model out of a given list. Used in Anwenden, where every model is
   * on offer, and on a program card in Programmieren, where the list is narrowed
   * to the models that fit that program's classes — the component only shows
   * what it is handed, so the caller decides what "available" means here.
   */
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import { modelLabel } from '$lib/models';
  import { roiSizeLabel } from '$lib/roi';
  import type { TrainedModel } from '$lib/stores/projects';

  let {
    models,
    selectedId = null,
    onselect,
    placeholder = 'Kein Modell',
    compact = false,
    block = false,
    disabled = false,
  }: {
    models: TrainedModel[];
    selectedId?: string | null;
    onselect: (id: string) => void;
    placeholder?: string;
    compact?: boolean;
    /** Stretch to the full width of its row, the way a `<select>` would. */
    block?: boolean;
    disabled?: boolean;
  } = $props();

  const selected = $derived(models.find((m) => m.id === selectedId) ?? null);

  function accuracyOf(model: TrainedModel): string | null {
    const acc = model.history?.accuracy ?? [];
    if (!acc.length) return null;
    return `${(acc[acc.length - 1] * 100).toFixed(0)} %`;
  }
</script>

<Dropdown
  placement="bottom-start"
  minWidth="240px"
  disabled={disabled || models.length === 0}
  style={block ? 'display:block;width:100%;min-width:0' : undefined}
>
  {#snippet trigger()}
    <button
      type="button"
      class="picker-trigger"
      class:compact
      class:block
      class:empty={!selected}
      disabled={disabled || models.length === 0}
      title={selected ? modelLabel(selected) : placeholder}
    >
      <span class="picker-label">{selected ? modelLabel(selected) : placeholder}</span>
      <!-- Always drawn, also for a single model: the chevron is what says this
           field can be opened at all. It only greys out when there is nothing
           to choose from. -->
      <svg class="caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6 9.5 12 15.5 18 9.5"
        />
      </svg>
    </button>
  {/snippet}
  {#snippet children()}
    {#each models as model (model.id)}
      <DropdownItem
        selected={model.id === selectedId}
        onselected={() => onselect(model.id)}
        title={modelLabel(model)}
      >
        <span class="option">
          <span class="option-name">{modelLabel(model)}</span>
          <span class="option-meta">
            {model.classes.length} Klassen
            {#if accuracyOf(model)}· {accuracyOf(model)}{/if}
            {#if model.roi}· Bereich {roiSizeLabel(model.roi)}{/if}
            {#if model.source === 'imported'}· importiert{/if}
          </span>
        </span>
      </DropdownItem>
    {/each}
  {/snippet}
</Dropdown>

<style lang="scss">
  // Deliberately field-shaped rather than button-shaped: a full border, the
  // value on the left and the chevron pinned right, so it reads as "this holds a
  // value you can change" like the native selects in the training options.
  .picker-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 6px 8px 6px 10px;
    border: 1px solid rgb(var(--md-outline));
    border-radius: var(--md-radius-sm, 6px);
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
    font: inherit;
    font-size: 13px;
    min-height: unset;
    box-shadow: none;
    cursor: pointer;

    &:hover:not(:disabled) {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary), 0.06);
    }
    &:focus-visible {
      outline: 2px solid rgb(var(--md-primary));
      outline-offset: 1px;
    }
    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
    &.compact {
      padding: 4px 6px 4px 8px;
      font-size: 12px;
    }
    &.block {
      display: flex;
      width: 100%;
    }
    &.empty .picker-label {
      color: rgb(var(--md-on-surface-variant));
      font-style: italic;
    }
  }
  .picker-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caret {
    margin-left: auto;
    opacity: 0.65;
    flex-shrink: 0;
  }
  .picker-trigger:hover:not(:disabled) .caret {
    opacity: 1;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .option-name {
    font-weight: 500;
  }
  .option-meta {
    font-size: 11px;
    color: hsl(210, 4%, 40%);
  }
</style>
