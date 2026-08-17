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
   * of the element, and mirrored to match the feed (see $lib/roi).
   */
  import { mirrorRoi } from '$lib/roi';
  import type { Roi } from '$lib/stores/projects';

  let {
    roi,
    aspect = 4 / 3,
    title = 'Bildbereich des Modells',
  }: { roi: Roi | null | undefined; aspect?: number; title?: string } = $props();

  const shown = $derived(roi ? mirrorRoi(roi) : null);
</script>

{#if shown}
  <div class="roi-overlay" style="aspect-ratio: {aspect};">
    <div
      class="roi-rect"
      style="left:{shown.x * 100}%; top:{shown.y * 100}%; width:{shown.w * 100}%; height:{shown.h * 100}%;"
      {title}
    ></div>
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
  }
</style>
