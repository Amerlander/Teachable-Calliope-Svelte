<script lang="ts">
  /**
   * Picking the one image that stands for a class.
   *
   * Its own dialog rather than a control on the thumbnail stack: a click on a
   * thumbnail there deletes it, and putting a second meaning on the same small,
   * overlapping targets is how someone loses a picture while trying to choose
   * one. Here the images are laid out at a size you can actually see.
   */
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { chooseClassThumb, resetClassThumb } from '$lib/stores';

  let {
    open = false,
    className = '',
    images = [],
    current,
    onclose,
  }: {
    open?: boolean;
    className?: string;
    /** The class's examples, newest last — the order they were recorded in. */
    images?: { data: string }[];
    /** The cover in force right now, to mark it in the grid. */
    current?: string;
    onclose: () => void;
  } = $props();

  let busy = $state(false);

  async function pick(image: string) {
    if (busy) return;
    busy = true;
    try {
      await chooseClassThumb(className, image);
      onclose();
    } finally {
      busy = false;
    }
  }

  function reset() {
    resetClassThumb(className);
    onclose();
  }
</script>

<Modal
  isOpen={open}
  title="Klassenbild für „{className}“"
  size="large"
  {onclose}
>
  {#snippet subtitle()}
    <span class="sub">
      <!-- The cover in force, shown rather than marked in the grid below: it is a
           downscaled copy of its own, so it never byte-matches the example it came
           from and no cell could be highlighted as "this one". -->
      {#if current}
        <img class="sub-thumb" src={current} alt="Aktuelles Klassenbild" />
      {/if}
      <span>
        Dieses Bild steht überall für die Klasse — in der Klassenliste und in
        Anwenden. Standard ist das erste aufgenommene Bild.
      </span>
    </span>
  {/snippet}

  {#snippet children()}
    {#if !images.length}
      <p class="empty">
        Für „{className}“ sind noch keine Bilder aufgenommen. Das erste wird
        automatisch das Klassenbild.
      </p>
    {:else}
      <div class="grid">
        {#each images as ex, i (i)}
          <button
            type="button"
            class="cell"
            disabled={busy}
            onclick={() => pick(ex.data)}
            title="Als Klassenbild verwenden"
          >
            <img src={ex.data} alt="Bild {i + 1}" />
            <span class="cell-num">{i + 1}</span>
          </button>
        {/each}
      </div>
      <p class="hint">
        Das Klassenbild wird als verkleinerte Kopie gespeichert und bleibt auch
        erhalten, wenn du das Bild später löschst.
      </p>
    {/if}
  {/snippet}

  {#snippet actions()}
    <Button variant="ghost" onclick={reset} disabled={busy}>
      Standard verwenden
    </Button>
    <Button onclick={onclose} disabled={busy}>Fertig</Button>
  {/snippet}
</Modal>

<style lang="scss">
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 10px;
  }
  .cell {
    position: relative;
    padding: 0;
    min-height: unset;
    box-shadow: none;
    border: 2px solid transparent;
    border-radius: var(--md-radius-md);
    background: rgba(var(--md-surface-variant), 0.5);
    cursor: pointer;
    overflow: hidden;
    aspect-ratio: 1;
    transition: border-color 0.15s, transform 0.15s;

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    &:hover:not(:disabled) {
      border-color: rgb(var(--md-primary));
      transform: translateY(-1px);
    }
    &:disabled { cursor: default; opacity: 0.6; }
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sub-thumb {
    width: 34px;
    height: 34px;
    border-radius: var(--md-radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    border: 2px solid rgb(var(--md-primary));
  }
  .cell-num {
    position: absolute;
    left: 4px;
    top: 4px;
    padding: 1px 5px;
    border-radius: 99px;
    font-size: 10px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .empty,
  .hint {
    margin: 0;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
  }
  .hint { margin-top: 14px; }
</style>
