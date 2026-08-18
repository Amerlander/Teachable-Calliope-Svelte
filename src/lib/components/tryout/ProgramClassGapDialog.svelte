<script lang="ts">
  /**
   * Shown when the open program uses more class blocks than the loaded model has
   * classes. Nothing is broken: the extra blocks exist, they are labelled as not
   * being in the model, and they never fire because no model ever sends their
   * id. So this is a hint, not a decision that has to be made — the way out is
   * either a model with enough classes or simply carrying on.
   */
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { modelLabel } from '$lib/models';
  import type { TrainedModel } from '$lib/stores/projects';

  let {
    open = false,
    programName = '',
    /** Highest class slot the program's blocks address. */
    used = 0,
    /** Classes the loaded model has. */
    available = 0,
    /** Models with at least `used` classes, newest first. */
    candidates = [],
    onpick,
    onclose,
  }: {
    open?: boolean;
    programName?: string;
    used?: number;
    available?: number;
    candidates?: TrainedModel[];
    onpick: (modelId: string) => void;
    onclose: () => void;
  } = $props();
</script>

{#snippet dismiss()}
  <Button onclick={onclose}>Weiter so</Button>
{/snippet}

<Modal
  isOpen={open}
  title="Das Programm nutzt mehr Klassen als das Modell"
  size={candidates.length ? 'medium' : 'small'}
  onclose={onclose}
  actions={candidates.length ? undefined : dismiss}
>
  <p class="text">
    <strong>{programName}</strong> hat Blöcke für {used} Klassen, das geladene Modell kennt nur
    {available}. Die überzähligen Blöcke bleiben im Programm — sie heißen dort
    <em>nicht im Modell</em> und werden nie ausgelöst.
  </p>

  {#if candidates.length}
    <p class="text">Diese Modelle haben genug Klassen:</p>
    <div class="choices">
      {#each candidates as model (model.id)}
        <button type="button" class="choice" onclick={() => onpick(model.id)}>
          <span class="choice-title">{modelLabel(model)}</span>
          <span class="choice-meta">
            {model.classes.length} Klassen · {model.classes.join(' · ')}
          </span>
        </button>
      {/each}
      <button type="button" class="choice quiet" onclick={onclose}>
        <span class="choice-title">Beim aktuellen Modell bleiben</span>
        <span class="choice-meta">Die überzähligen Blöcke bleiben ohne Wirkung</span>
      </button>
    </div>
  {:else}
    <p class="text">
      Kein Modell in diesem Projekt hat so viele Klassen. Trainiere eines mit
      {used} Klassen, wenn alle Blöcke wirken sollen.
    </p>
  {/if}
</Modal>

<style lang="scss">
  .text {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.55;
    color: rgb(var(--md-on-surface-variant));

    strong {
      color: rgb(var(--md-on-surface));
    }
  }
  // The ways out are the buttons of this dialog, so they are the body rather
  // than a footer: there is no default among them.
  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 11px 14px;
    text-align: left;
    font: inherit;
    color: rgb(var(--md-on-surface));
    background: rgba(var(--md-surface-variant), 0.3);
    border: 2px solid transparent;
    border-radius: var(--md-radius-md);
    box-shadow: none;
    min-height: unset;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;

    &:hover {
      background: rgb(var(--md-surface-variant));
      border-color: rgb(var(--md-primary));
      box-shadow: var(--md-elevation-1);
    }
    &:focus-visible {
      outline: 2px solid rgb(var(--md-primary));
      outline-offset: 2px;
    }
    &.quiet {
      background: transparent;
      border-color: rgb(var(--md-outline));
    }
  }
  .choice-title {
    font-size: 13px;
    font-weight: 600;
  }
  .choice-meta {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
</style>
