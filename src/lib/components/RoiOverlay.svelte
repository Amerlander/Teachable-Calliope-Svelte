<script lang="ts">
  /**
   * Read-only outline of the image region a model was trained on, drawn over a
   * camera feed. Shown wherever a model is in use — while testing in
   * Trainieren, in Programmieren and in Anwenden — so it is always visible
   * where the model actually looks, and nowhere editable: the region belongs to
   * the model and is fixed once it is trained.
   *
   * Place inside a positioned box that holds the video. The box is centred and
   * given the camera's aspect ratio so it tracks the letterboxed video instead
   * of the element, and follows the feed's mirroring (see $lib/roi).
   *
   * `color` and `label` are for several models on one picture: an unmarked box
   * says which region but not whose.
   */
  import { displayRoi } from '$lib/roi';
  import { cameraMirror } from '$lib/stores/camera';
  import type { Roi } from '$lib/stores/projects';

  let {
    roi,
    aspect = 4 / 3,
    title = 'Bildbereich des Modells',
    color = null,
    label = null,
  }: {
    roi: Roi | null | undefined;
    aspect?: number;
    title?: string;
    /** Outline colour. The theme's tertiary when there is only one region. */
    color?: string | null;
    /** Named in the corner of the box. Only worth it with more than one. */
    label?: string | null;
  } = $props();

  const shown = $derived(roi ? displayRoi(roi, $cameraMirror) : null);
</script>

{#if shown}
  <div class="roi-overlay" style="aspect-ratio: {aspect};">
    <div
      class="roi-rect"
      class:tinted={!!color}
      style="left:{shown.x * 100}%; top:{shown.y * 100}%; width:{shown.w * 100}%; height:{shown.h *
        100}%;{color ? ` --roi-color: ${color};` : ''}"
      {title}
    >
      {#if label}
        <span class="roi-label">{label}</span>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  .roi-overlay {
    position: absolute;
    inset: 0;
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    z-index: 4;
    pointer-events: none;
  }
  .roi-rect {
    position: absolute;
    box-sizing: border-box;
    border: 2px dashed rgb(var(--md-tertiary));
    background: rgba(var(--md-tertiary), 0.08);
    border-radius: 2px;
    // No fill once the boxes are told apart by colour: four tinted overlays over
    // one picture add up to a wash. The hairline and the glow are what keep a
    // dark hue findable on a dark picture and a bright one on a light picture —
    // the palette cannot know what the camera is pointed at.
    &.tinted {
      border-color: var(--roi-color);
      border-style: solid;
      background: transparent;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.6),
        0 0 5px rgba(0, 0, 0, 0.55);
    }
  }
  // Inside the corner, so a box against an edge keeps its name on screen.
  .roi-label {
    position: absolute;
    left: 0;
    top: 0;
    max-width: 100%;
    padding: 2px 6px;
    border-radius: 0 0 6px 0;
    background: var(--roi-color, rgb(var(--md-tertiary)));
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
