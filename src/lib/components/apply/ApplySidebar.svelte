<script lang="ts">
  /**
   * The settings column in Anwenden.
   *
   * Every control here changes what is on screen and nothing else — see
   * $lib/stores/applyView. It writes straight to that store rather than raising
   * events, because the settings are app-wide and several of them are read in
   * places this component knows nothing about.
   *
   * One thing deliberately absent: mirroring. It belongs to the camera rather
   * than to this view — see `cameraMirror` in $lib/stores/camera — and is set
   * with the camera, next to the preview that shows what it does.
   */
  import {
    applyView,
    resetApplyView,
    setResultDetail,
    setRoiDisplay,
    setThumbSize,
    toggleApplyView,
    type ResultDetail,
    type RoiDisplay,
    type ThumbSize,
  } from '$lib/stores/applyView';
  import { MAX_COMPARED } from '$lib/compare';

  let {
    poseMode = false,
    fullscreen = false,
    modelCount = 0,
    onToggleFullscreen,
  }: {
    /** Pose projects get the skeleton controls; image projects have no pose. */
    poseMode?: boolean;
    fullscreen?: boolean;
    /** Models available in the project — decides whether comparing is offered. */
    modelCount?: number;
    onToggleFullscreen: () => void;
  } = $props();

  const detailOptions: { value: ResultDetail; label: string; hint: string }[] = [
    { value: 'all', label: 'Alle Klassen', hint: 'jede Klasse mit Balken' },
    { value: 'top', label: 'Nur Ergebnis', hint: 'erkannte Klasse und Sicherheit' },
    { value: 'none', label: 'Nichts', hint: 'nur das Kamerabild' },
  ];

  const roiOptions: { value: RoiDisplay; label: string; hint: string }[] = [
    { value: 'show', label: 'Einzeichnen', hint: 'Rahmen über dem ganzen Bild' },
    { value: 'hide', label: 'Ausblenden', hint: 'ganzes Bild, ohne Rahmen' },
    { value: 'only', label: 'Nur der Bereich', hint: 'nichts als der Bildbereich, groß' },
  ];

  const thumbSizes: { value: ThumbSize; label: string }[] = [
    { value: 'small', label: 'S' },
    { value: 'medium', label: 'M' },
    { value: 'large', label: 'L' },
  ];

  const thumbsOff = $derived($applyView.resultDetail === 'none' || !$applyView.classThumbs);
</script>

{#if $applyView.sidebarOpen}
  <aside class="apply-sidebar" aria-label="Ansicht-Einstellungen">
    <div class="side-head">
      <span class="side-title">Ansicht</span>
      <button
        class="icon-btn"
        onclick={() => toggleApplyView('sidebarOpen')}
        title="Einstellungen einklappen"
        aria-label="Einstellungen einklappen"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9 6l6 6-6 6"
          />
        </svg>
      </button>
    </div>

    <div class="side-scroll">
      <section class="group">
        <h3>Ergebnis</h3>
        <div class="radio-set" role="radiogroup" aria-label="Ergebnis-Detailgrad">
          {#each detailOptions as opt (opt.value)}
            <label class="radio-row" class:checked={$applyView.resultDetail === opt.value}>
              <input
                type="radio"
                name="result-detail"
                value={opt.value}
                checked={$applyView.resultDetail === opt.value}
                onchange={() => setResultDetail(opt.value)}
              />
              <span class="radio-text">
                <span class="radio-label">{opt.label}</span>
                <span class="radio-hint">{opt.hint}</span>
              </span>
            </label>
          {/each}
        </div>
        <label class="switch-row" class:disabled={$applyView.resultDetail === 'none'}>
          <input
            type="checkbox"
            checked={$applyView.classThumbs}
            disabled={$applyView.resultDetail === 'none'}
            onchange={() => toggleApplyView('classThumbs')}
          />
          <span class="switch-text">
            <span class="switch-label">Klassenbilder</span>
            <span class="switch-hint">das Bild der Klasse neben ihrem Namen</span>
          </span>
        </label>
        <!-- Sits with the switch it belongs to rather than under Darstellung: it
             is the size of *these* pictures, and it is the thing to reach for when
             the readout is being watched from the back of a room. -->
        <div class="inset-row" class:disabled={thumbsOff}>
          <span class="inset-label">Größe</span>
          <div class="seg" role="group" aria-label="Größe der Klassenbilder">
            {#each thumbSizes as size (size.value)}
              <button
                type="button"
                class:on={$applyView.thumbSize === size.value}
                disabled={thumbsOff}
                aria-pressed={$applyView.thumbSize === size.value}
                onclick={() => setThumbSize(size.value)}
              >
                {size.label}
              </button>
            {/each}
          </div>
        </div>
      </section>

      <section class="group">
        <h3>Modelle</h3>
        <label class="switch-row" class:disabled={modelCount < 2}>
          <input
            type="checkbox"
            checked={$applyView.allModels}
            disabled={modelCount < 2}
            onchange={() => toggleApplyView('allModels')}
          />
          <span class="switch-text">
            <span class="switch-label">Alle Modelle anzeigen</span>
            <span class="switch-hint">
              {#if modelCount < 2}
                dafür braucht das Projekt mindestens zwei Modelle
              {:else}
                {Math.min(modelCount, MAX_COMPARED)} Modelle gleichzeitig auf demselben Bild
              {/if}
            </span>
          </span>
        </label>
        {#if $applyView.allModels && modelCount >= 2}
          <!-- Said here rather than discovered later: the extra columns are for
               looking at, the board keeps hearing one model. -->
          <p class="note">
            An den Calliope wird weiterhin nur das oben gewählte Modell gesendet.
          </p>
        {/if}
      </section>

      {#if !poseMode}
        <section class="group">
          <h3>Bildbereich</h3>
          <div class="radio-set" role="radiogroup" aria-label="Bildbereich des Modells">
            {#each roiOptions as opt (opt.value)}
              <label class="radio-row" class:checked={$applyView.roiDisplay === opt.value}>
                <input
                  type="radio"
                  name="roi-display"
                  value={opt.value}
                  checked={$applyView.roiDisplay === opt.value}
                  onchange={() => setRoiDisplay(opt.value)}
                />
                <span class="radio-text">
                  <span class="radio-label">{opt.label}</span>
                  <span class="radio-hint">{opt.hint}</span>
                </span>
              </label>
            {/each}
          </div>
          {#if $applyView.roiDisplay === 'show' && $applyView.allModels && modelCount >= 2}
            <p class="note">
              Jedes Modell bekommt seinen eigenen Rahmen in der Farbe seiner Karte.
            </p>
          {:else if $applyView.roiDisplay === 'only'}
            <p class="note">
              Gezeigt wird der Bereich des oben gewählten Modells — das ist das
              Modell, das an den Calliope sendet.
            </p>
          {/if}
        </section>
      {/if}

      {#if poseMode}
        <section class="group">
          <h3>Pose</h3>
          <label class="switch-row">
            <input
              type="checkbox"
              checked={$applyView.poseSkeleton}
              onchange={() => toggleApplyView('poseSkeleton')}
            />
            <span class="switch-text">
              <span class="switch-label">Skelett</span>
              <span class="switch-hint">genau das, was das Modell sieht</span>
            </span>
          </label>
          <label class="switch-row">
            <input
              type="checkbox"
              checked={$applyView.poseLabels}
              onchange={() => toggleApplyView('poseLabels')}
            />
            <span class="switch-text">
              <span class="switch-label">Körperteile benennen</span>
              <span class="switch-hint">Nase, Schulter, Handgelenk …</span>
            </span>
          </label>
          <label class="switch-row">
            <input
              type="checkbox"
              checked={$applyView.poseAngles}
              onchange={() => toggleApplyView('poseAngles')}
            />
            <span class="switch-text">
              <span class="switch-label">Gelenkwinkel</span>
              <span class="switch-hint">Grad an Ellbogen, Schultern, Hüften, Knien</span>
            </span>
          </label>
        </section>
      {/if}

      <section class="group">
        <h3>Kamerabild</h3>
        <label class="switch-row">
          <input
            type="checkbox"
            checked={$applyView.blurCamera}
            onchange={() => toggleApplyView('blurCamera')}
          />
          <span class="switch-text">
            <span class="switch-label">Weichzeichnen</span>
            <span class="switch-hint">
              {#if poseMode}wie in Trainieren, damit das Skelett vorne liegt{:else}legt den Fokus auf das Ergebnis{/if}
            </span>
          </span>
        </label>
        <!-- Mirroring used to live here. It is a property of the camera, so it is
             set with the camera and holds in every view. -->
        <p class="note">
          Ob das Bild gespiegelt ist, wird bei der Kamera eingestellt und gilt in
          allen Ansichten.
        </p>
      </section>

      <section class="group">
        <h3>Darstellung</h3>
        <button class="wide-btn" onclick={onToggleFullscreen}>
          {#if fullscreen}Vollbild beenden{:else}Vollbild{/if}
        </button>
        <button class="wide-btn ghost" onclick={resetApplyView}>Zurücksetzen</button>
      </section>
    </div>
  </aside>
{:else if !fullscreen}
  <!-- Collapsed: floating over the picture rather than a column beside it, so a
       closed panel costs the stage nothing. Gone entirely in fullscreen — a
       projected picture should have no furniture on it, and Escape is the way out
       of fullscreen anyway. -->
  <button
    class="side-eye"
    onclick={() => toggleApplyView('sidebarOpen')}
    title="Ansicht-Einstellungen"
    aria-label="Ansicht-Einstellungen öffnen"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9" />
    </svg>
  </button>
{/if}

<style lang="scss">
  // Dark, like the stage it sits beside — a white panel next to a black picture
  // is a lamp pointed at whoever is watching the projector.
  .apply-sidebar {
    width: 268px;
    flex: 0 0 268px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #17181a;
    color: rgba(255, 255, 255, 0.92);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    min-height: 0;
  }
  .side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 10px 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
  }
  .side-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.62);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    min-height: unset;
    border: none;
    box-shadow: none;
    border-radius: 999px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
  }
  .side-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0 20px;
  }
  .group {
    padding: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    &:last-child { border-bottom: none; }
    h3 {
      margin: 0 0 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: rgba(255, 255, 255, 0.45);
    }
  }

  .radio-set {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 10px;
  }
  .radio-row,
  .switch-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.35;
    // Stated rather than inherited: these rows are <label>s, and the global
    // stylesheet gives every label the light theme's on-surface colour — dark
    // grey, which on this panel is very nearly invisible.
    color: rgba(255, 255, 255, 0.92);
    &:hover { background: rgba(255, 255, 255, 0.07); }
    input {
      margin: 2px 0 0;
      accent-color: #adf54c;
      flex-shrink: 0;
      cursor: pointer;
    }
    // Greyed rather than hidden: the reason it is unavailable is in the hint
    // underneath, and a control that vanishes takes its explanation with it.
    &.disabled {
      cursor: default;
      opacity: 0.45;
      &:hover { background: transparent; }
      input { cursor: default; }
    }
  }
  .radio-row.checked { background: rgba(173, 245, 76, 0.1); }
  .radio-text,
  .switch-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .radio-label,
  .switch-label {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.92);
  }
  .radio-hint,
  .switch-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }
  .note {
    margin: 6px 2px 0;
    font-size: 11px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.55);
    border-left: 2px solid rgba(173, 245, 76, 0.5);
    padding-left: 8px;
  }

  // A setting that belongs to the switch above it, indented to say so.
  .inset-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 2px 0 0 26px;
    padding: 2px 8px 2px 0;
    &.disabled { opacity: 0.45; pointer-events: none; }
  }
  .inset-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.62);
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    button {
      min-width: 30px;
      padding: 3px 8px;
      min-height: unset;
      border: none;
      box-shadow: none;
      border-radius: 999px;
      background: transparent;
      color: rgba(255, 255, 255, 0.72);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); color: #fff; }
      &.on { background: #adf54c; color: #14160f; }
      &:disabled { cursor: default; }
    }
  }

  .wide-btn {
    display: block;
    width: 100%;
    padding: 9px 12px;
    margin-bottom: 8px;
    min-height: unset;
    box-shadow: none;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.92);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.4);
    }
    &:last-child { margin-bottom: 0; }
    &.ghost {
      background: transparent;
      border-color: rgba(255, 255, 255, 0.14);
      color: rgba(255, 255, 255, 0.62);
    }
  }

  // Out of the flex flow, so the stage keeps the full width while it is closed.
  .side-eye {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 8;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    min-height: unset;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    box-shadow: none;
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    &:hover {
      background: rgba(0, 0, 0, 0.75);
      border-color: rgba(255, 255, 255, 0.6);
      color: #fff;
    }
  }

  @media (max-width: 720px) {
    .apply-sidebar { width: 214px; flex-basis: 214px; }
  }
</style>
