<script lang="ts">
  /**
   * What the running model(s) currently say, drawn over the camera picture.
   *
   * Two shapes in one component on purpose: the single-model readout and the
   * one-card-per-model strip share the class rows, the covers and the detail
   * levels, and splitting them meant keeping three of those in sync twice.
   *
   * The numbers arrive already prepared. The single-model side takes them from
   * `CurrentDetection`, which is mapped through the model's calibration and has
   * decided what counts as detected; the multi-model side takes raw softmax,
   * because each model carries its own calibration and mapping every column
   * through a different one compares the calibration rather than the models.
   * Nothing here re-derives a threshold.
   */
  import type { CurrentDetection } from '$lib/stores/streaming';
  import type { ResultDetail } from '$lib/stores/applyView';
  import type { TrainedModel } from '$lib/stores/projects';
  import type { ModelPrediction } from '$lib/compare';
  import { modelLabel } from '$lib/models';

  let {
    detail,
    det = null,
    multi = null,
    showThumbs = true,
    activeModelId = null,
    colorFor = null,
    thumbFor,
  }: {
    detail: ResultDetail;
    /** The selected model's calibrated frame; null until the first prediction. */
    det?: CurrentDetection | null;
    /** One entry per compared model, or null when only one model is running. */
    multi?: { model: TrainedModel; prediction: ModelPrediction | null }[] | null;
    showThumbs?: boolean;
    /** Which of the compared models is the one streaming to the board. */
    activeModelId?: string | null;
    /**
     * The colour of the i-th model, matching the outline of its image region on
     * the picture. Null while there is nothing to tell apart.
     */
    colorFor?: ((index: number) => string) | null;
    /** The class cover to show beside a label, if there is one. */
    thumbFor: (model: TrainedModel | null, label: string) => string | undefined;
  } = $props();

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  /**
   * Class rows for one model's raw output, strongest first.
   *
   * Sorted rather than left in output order: with eight models side by side the
   * thing being looked for is what each of them thinks, and a fixed order buries
   * that under whichever class happens to be first.
   */
  function rows(labels: string[], values: number[]) {
    return labels
      .map((label, i) => ({ label, value: values[i] ?? 0 }))
      .sort((a, b) => b.value - a.value);
  }
</script>

{#if detail !== 'none'}
  {#if multi}
    <div class="model-strip" class:compact={detail === 'top'}>
      {#each multi as entry, i (entry.model.id)}
        {@const p = entry.prediction}
        <div class="model-card" class:live={entry.model.id === activeModelId}>
          <div class="mc-head">
            {#if colorFor}
              <!-- Same colour as this model's region on the picture. Without it the
                   outlines and the cards are two unrelated lists. -->
              <span class="mc-dot" style="background: {colorFor(i)};" aria-hidden="true"></span>
            {/if}
            <span class="mc-name" title={modelLabel(entry.model)}>{modelLabel(entry.model)}</span>
            {#if entry.model.id === activeModelId}
              <!-- Which column the board is actually hearing. Without this the
                   strip reads as eight equal models driving one program. -->
              <span class="mc-live-tag">an Calliope</span>
            {/if}
          </div>

          {#if !p}
            <div class="mc-wait">…</div>
          {:else}
            {@const top = entry.model.classes[p.topIndex] ?? p.topLabel}
            <div class="mc-top">
              {#if showThumbs}
                {@const thumb = thumbFor(entry.model, top)}
                {#if thumb}
                  <img class="mc-thumb" src={thumb} alt="" />
                {:else}
                  <span class="mc-thumb placeholder" aria-hidden="true"></span>
                {/if}
              {/if}
              <span class="mc-top-label" title={top}>{top}</span>
              <span class="mc-top-pct">{pct(p.topProb)}</span>
            </div>

            {#if detail === 'all'}
              <div class="mc-rows">
                {#each rows(entry.model.classes, p.probs) as row (row.label)}
                  <div class="mc-row" class:leading={row.label === top}>
                    <span class="mc-row-label" title={row.label}>{row.label}</span>
                    <span class="mc-row-bar">
                      <span class="mc-row-fill" style="width: {row.value * 100}%"></span>
                    </span>
                    <span class="mc-row-pct">{pct(row.value)}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {:else if det}
    <div class="single" class:confident={det.detected}>
      <div class="single-top">
        {#if showThumbs}
          {@const thumb = thumbFor(null, det.label)}
          {#if thumb}
            <img class="single-thumb" src={thumb} alt="" />
          {:else}
            <span class="single-thumb placeholder" aria-hidden="true"></span>
          {/if}
        {/if}
        <span class="single-label" title={det.label}>{det.label}</span>
        <span class="single-bar">
          <span class="single-fill" style="width: {det.confidence * 100}%"></span>
        </span>
        <span class="single-pct">{pct(det.confidence)}</span>
      </div>

      {#if detail === 'all' && det.labels.length > 1}
        <div class="single-rows">
          {#each rows(det.labels, det.all) as row (row.label)}
            <div class="single-row" class:leading={row.label === det.label}>
              {#if showThumbs}
                {@const thumb = thumbFor(null, row.label)}
                {#if thumb}
                  <img class="row-thumb" src={thumb} alt="" />
                {:else}
                  <span class="row-thumb placeholder" aria-hidden="true"></span>
                {/if}
              {/if}
              <span class="single-row-label" title={row.label}>{row.label}</span>
              <span class="single-row-bar">
                <span class="single-row-fill" style="width: {row.value * 100}%"></span>
              </span>
              <span class="single-row-pct">{pct(row.value)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style lang="scss">
  $panel: rgba(0, 0, 0, 0.58);

  // ---------- one model ----------
  .single {
    position: absolute;
    left: 50%;
    bottom: 36px;
    transform: translateX(-50%);
    z-index: 6;
    width: min(620px, calc(100% - 48px));
    padding: 14px 18px;
    border-radius: 12px;
    background: $panel;
    backdrop-filter: blur(6px);
    color: #fff;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .single-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  // Sized by the setting in the sidebar: the same readout is watched from a desk
  // and from the back of a room. `--thumb-scale` is set on the stage.
  .single-thumb {
    width: calc(44px * var(--thumb-scale, 1));
    height: calc(44px * var(--thumb-scale, 1));
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.12);
  }
  .single-label {
    font-weight: 700;
    font-size: 22px;
    line-height: 1.2;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .single-bar {
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }
  .single-fill {
    display: block;
    height: 100%;
    background: #9ca3af;
    transition: width 0.15s;
  }
  .single.confident .single-fill { background: #22c55e; }
  .single-pct {
    font-variant-numeric: tabular-nums;
    font-size: 16px;
    opacity: 0.9;
  }

  .single-rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
    padding-top: 10px;
    max-height: 34vh;
    overflow-y: auto;
  }
  .single-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    opacity: 0.78;
    &.leading { opacity: 1; font-weight: 600; }
  }
  .row-thumb {
    width: calc(22px * var(--thumb-scale, 1));
    height: calc(22px * var(--thumb-scale, 1));
    border-radius: 5px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.12);
  }
  .single-row-label {
    flex: 0 0 30%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .single-row-bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.16);
    overflow: hidden;
  }
  .single-row-fill {
    display: block;
    height: 100%;
    background: rgba(255, 255, 255, 0.62);
    transition: width 0.15s;
  }
  .single-row.leading .single-row-fill { background: #22c55e; }
  .single-row-pct {
    font-variant-numeric: tabular-nums;
    flex: 0 0 40px;
    text-align: right;
  }

  // ---------- several models ----------
  // Along the bottom and scrollable sideways, so the number of models decides how
  // far the strip runs rather than how small every card gets.
  .model-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    display: flex;
    gap: 10px;
    padding: 12px 16px 16px;
    overflow-x: auto;
    overflow-y: hidden;
    align-items: flex-end;
    // The picture behind stays visible past the cards.
    background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  }
  .model-card {
    flex: 0 0 218px;
    max-width: 218px;
    padding: 10px 12px;
    border-radius: 10px;
    background: $panel;
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    &.live { border-color: rgba(34, 197, 94, 0.75); }
  }
  .model-strip.compact .model-card { flex-basis: 190px; max-width: 190px; }
  .mc-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 8px;
    min-width: 0;
  }
  .mc-name {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.86);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mc-dot {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    align-self: center;
  }
  .mc-live-tag {
    flex-shrink: 0;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: 99px;
    background: rgba(34, 197, 94, 0.22);
    color: #86efac;
  }
  .mc-wait {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    padding: 4px 0;
  }
  .mc-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mc-thumb {
    width: calc(30px * var(--thumb-scale, 1));
    height: calc(30px * var(--thumb-scale, 1));
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.12);
  }
  .mc-top-label {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mc-top-pct {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex-shrink: 0;
  }
  .mc-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
    max-height: 26vh;
    overflow-y: auto;
  }
  .mc-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    opacity: 0.75;
    &.leading { opacity: 1; font-weight: 600; }
  }
  .mc-row-label {
    flex: 0 0 40%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mc-row-bar {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.16);
    overflow: hidden;
  }
  .mc-row-fill {
    display: block;
    height: 100%;
    background: rgba(255, 255, 255, 0.6);
    transition: width 0.15s;
  }
  .mc-row.leading .mc-row-fill { background: #22c55e; }
  .mc-row-pct {
    font-variant-numeric: tabular-nums;
    flex: 0 0 32px;
    text-align: right;
  }

  .placeholder { display: inline-block; }

  @media (max-width: 720px) {
    .single { bottom: 16px; padding: 10px 12px; }
    .single-label { font-size: 17px; }
    .single-thumb {
      width: calc(34px * var(--thumb-scale, 1));
      height: calc(34px * var(--thumb-scale, 1));
    }
  }
</style>
