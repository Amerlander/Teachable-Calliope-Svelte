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
  import type { ClassOrder, ResultDetail, ThumbSize } from '$lib/stores/applyView';
  import type { TrainedModel } from '$lib/stores/projects';
  import type { ModelPrediction } from '$lib/compare';
  import type { ClassCover } from '$lib/classThumb';
  import { roiCropStyle } from '$lib/roi';
  import { modelLabel } from '$lib/models';

  let {
    detail,
    order = 'detected',
    det = null,
    multi = null,
    showThumbs = true,
    size = 'medium',
    activeModelId = null,
    colorFor = null,
    cropCovers = false,
    coverFor,
  }: {
    detail: ResultDetail;
    /** Class order, and with it whether the leading class is repeated in the list. */
    order?: ClassOrder;
    /** The selected model's calibrated frame; null until the first prediction. */
    det?: CurrentDetection | null;
    /** One entry per compared model, or null when only one model is running. */
    multi?: { model: TrainedModel; prediction: ModelPrediction | null }[] | null;
    showThumbs?: boolean;
    /** Cover size, and at 'large' the row-of-pictures layout — see $lib/stores/applyView. */
    size?: ThumbSize;
    /** Which of the compared models is the one streaming to the board. */
    activeModelId?: string | null;
    /**
     * The colour of the i-th model, matching the outline of its image region on
     * the picture. Null while there is nothing to tell apart.
     */
    colorFor?: ((index: number) => string) | null;
    /**
     * Cut every cover down to its model's region. Follows the same setting that
     * crops the stage, so the covers are framed like the picture they sit on.
     */
    cropCovers?: boolean;
    /** The class cover to show beside a label, if there is one. */
    coverFor: (model: TrainedModel | null, label: string) => ClassCover | null;
  } = $props();

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  /**
   * The row of pictures replaces the list, so it needs the *whole* class list —
   * which is why it is only reachable where that list is on screen anyway. One
   * model at a time, too: inside a card in the several-models strip there is no
   * width for a row of pictures, and eight rows of them would be the whole stage.
   */
  const gallery = $derived(size === 'large' && detail === 'all' && showThumbs && !multi);

  /** One entry per class, in the chosen order. */
  function ordered(labels: string[], values: number[]) {
    const all = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
    return order === 'detected' ? [...all].sort((a, b) => b.value - a.value) : all;
  }

  /**
   * The rows under the big result, for one model's raw output.
   *
   * Sorted strongest-first the leading class is dropped, because it is already on
   * screen in full size directly above and a sorted list would only repeat it as
   * the first small row. In the model's own order it stays: the point of that order
   * is that every class keeps its place, and a row disappearing out of the middle
   * of the list whenever it wins defeats it.
   *
   * `leading` is passed rather than re-derived. The class shown large comes from
   * the model's calibration, which can name a different class than the highest raw
   * probability, and the row to leave out is the one that is actually up there.
   */
  function rows(labels: string[], values: number[], leading: string) {
    const all = ordered(labels, values);
    return order === 'detected' ? all.filter((r) => r.label !== leading) : all;
  }
</script>

<!--
  A cover is stored as the whole camera frame (see $lib/classThumb), so the box is
  a window and the picture inside it is what moves. Left alone it fills the box and
  `object-fit: cover` lands on the centre square — the same framing covers used to
  be stored in. Cut, roiCropStyle blows the frame up and pushes it so that only the
  model's region is inside the window, exactly as the stored thumbnails in
  Trainieren do it.
-->
{#snippet cover(c: ClassCover | null, kind: 'single' | 'row' | 'mc' | 'gal')}
  {@const cut = cropCovers && !!c?.roi}
  <span
    class="cov"
    class:single-thumb={kind === 'single'}
    class:row-thumb={kind === 'row'}
    class:mc-thumb={kind === 'mc'}
    class:gal-thumb={kind === 'gal'}
    class:cut
    aria-hidden="true"
  >
    {#if c}
      <img src={c.src} alt="" style={cut && c.roi ? roiCropStyle(c.roi) : ''} />
    {/if}
  </span>
{/snippet}

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
            <!-- The size setting reaches in here too. S keeps picture, class and
                 percentage on one line; M moves the percentage under the class name
                 to make room for a bigger picture; L gives the picture the whole
                 width of the card. -->
            <div class="mc-top" class:sz-m={size === 'medium'} class:sz-l={size === 'large'}>
              {#if showThumbs}
                {@render cover(coverFor(entry.model, top), 'mc')}
              {/if}
              <span class="mc-text">
                <span class="mc-top-label" title={top}>{top}</span>
                <span class="mc-top-pct">{pct(p.topProb)}</span>
              </span>
            </div>

            {@const restRows = rows(entry.model.classes, p.probs, top)}
            {#if detail === 'all' && restRows.length && entry.model.classes.length > 1}
              <div class="mc-rows">
                {#each restRows as row (row.label)}
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
    {@const restRows = rows(det.labels, det.all, det.label)}
    {@const cells = ordered(det.labels, det.all)}
    <div class="single" class:confident={det.detected} class:gallery>
      {#if gallery}
        <!-- Every class as a picture with its own bar, and no separate headline
             above it: the leading class is the one lit up in the row, so a
             headline would be the same class a second time. That it counts as
             *detected* — the calibrated decision, not just the highest bar — is
             what the green is for. -->
        <div class="gal-row">
          {#each cells as cell (cell.label)}
            <div class="gal-cell" class:leading={cell.label === det.label}>
              {@render cover(coverFor(null, cell.label), 'gal')}
              <span class="gal-label" title={cell.label}>{cell.label}</span>
              <span class="gal-bar">
                <span class="gal-fill" style="width: {cell.value * 100}%"></span>
              </span>
              <span class="gal-pct">{pct(cell.value)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="single-top">
          {#if showThumbs}
            {@render cover(coverFor(null, det.label), 'single')}
          {/if}
          <span class="single-label" title={det.label}>{det.label}</span>
          <span class="single-bar">
            <span class="single-fill" style="width: {det.confidence * 100}%"></span>
          </span>
          <span class="single-pct">{pct(det.confidence)}</span>
        </div>

        {#if detail === 'all' && restRows.length && det.labels.length > 1}
          <div class="single-rows">
            {#each restRows as row (row.label)}
              <div class="single-row" class:leading={row.label === det.label}>
                {#if showThumbs}
                  {@render cover(coverFor(null, row.label), 'row')}
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
      {/if}
    </div>
  {/if}
{/if}

<style lang="scss">
  $panel: rgba(0, 0, 0, 0.58);

  // The window every cover is shown through — see the snippet above. Sizes stay on
  // the four kind classes, so each place keeps deciding how big its covers are.
  .cov {
    position: relative;
    display: block;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.12);
    img {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      display: block;
      max-width: none;
      object-fit: cover;
    }
    // Cut: the offsets come from roiCropStyle and assume the picture covers the
    // window exactly, which `cover` would undo by cropping it a second time.
    &.cut img { object-fit: fill; }
  }

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

  // ---------- the classes as a row of pictures ----------
  // Wider than the list it replaces, and scrollable sideways rather than shrinking
  // the pictures: past six or seven classes the point of the layout is the size of
  // each picture, not that they all fit at once.
  .single.gallery {
    width: min(1180px, calc(100% - 32px));
    bottom: 24px;
    padding: 12px 14px;
  }
  .gal-row {
    display: flex;
    gap: 14px;
    justify-content: center;
    align-items: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .gal-cell {
    flex: 0 0 auto;
    width: clamp(96px, 11vw, 190px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    // Dimmed rather than hidden: the classes that are not it still say how close
    // they came, which is half of what this view is for.
    opacity: 0.55;
    transition: opacity 0.15s;
    &.leading { opacity: 1; }
  }
  .gal-thumb {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 10px;
  }
  .gal-cell.leading .gal-thumb {
    outline: 3px solid rgba(255, 255, 255, 0.75);
    outline-offset: 2px;
  }
  .single.confident .gal-cell.leading .gal-thumb { outline-color: #22c55e; }
  .gal-label {
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gal-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }
  .gal-fill {
    display: block;
    height: 100%;
    background: rgba(255, 255, 255, 0.62);
    transition: width 0.15s;
  }
  .gal-cell.leading .gal-fill { background: #9ca3af; }
  .single.confident .gal-cell.leading .gal-fill { background: #22c55e; }
  .gal-pct {
    font-size: 13px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
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
  // A card is one narrow column, so the size setting changes the arrangement here
  // rather than only a number of pixels: past a certain picture size there is no
  // room left beside it for a name and a percentage on the same line.
  .mc-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mc-thumb {
    width: 34px;
    height: 34px;
    border-radius: 6px;
  }
  .mc-text {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 8px;
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

  // M: a bigger picture, and the percentage moves under the class name.
  .mc-top.sz-m {
    align-items: flex-start;
    .mc-thumb { width: 52px; height: 52px; border-radius: 8px; }
    .mc-text { flex-direction: column; align-items: flex-start; gap: 1px; }
    .mc-top-label { flex: 0 0 auto; max-width: 100%; font-size: 16px; }
    .mc-top-pct { font-size: 15px; opacity: 1; }
  }
  // L: the picture takes the card's whole width, with the name and the percentage
  // stacked under it.
  .mc-top.sz-l {
    flex-direction: column;
    align-items: stretch;
    gap: 7px;
    .mc-thumb {
      width: 100%;
      height: auto;
      aspect-ratio: 1;
      border-radius: 10px;
    }
    .mc-text { flex-direction: column; align-items: flex-start; gap: 1px; }
    .mc-top-label { flex: 0 0 auto; max-width: 100%; font-size: 17px; }
    .mc-top-pct { font-size: 15px; opacity: 1; }
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

  @media (max-width: 720px) {
    .single { bottom: 16px; padding: 10px 12px; }
    .single-label { font-size: 17px; }
    .single-thumb {
      width: calc(34px * var(--thumb-scale, 1));
      height: calc(34px * var(--thumb-scale, 1));
    }
  }
</style>
