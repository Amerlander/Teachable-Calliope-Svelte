<script lang="ts">
  import { trainPhase, trainStatus, trainEpoch, trainTotalEpochs, trainProgress } from '$lib/stores/app';
  import ModelCharts from './ModelCharts.svelte';

  // Shown in the slot under the video — the same slot that afterwards holds the
  // model info, so the run and its result appear in one place.
</script>

<div class="training-progress">
  <div class="tp-head">
    <span class="tp-title">{$trainPhase === 'preparing' ? 'Vorbereitung…' : 'Training läuft…'}</span>
    <span class="tp-status">{$trainStatus}</span>
  </div>

  <div class="tp-body">
    <div class="tp-left">
      <div class="phase-steps">
        <div
          class="phase-step"
          class:done={$trainPhase !== 'preparing'}
          class:active={$trainPhase === 'preparing'}
        >
          <span class="phase-dot"></span>
          <span>Bilder vorbereiten (Feature-Extraktion)</span>
        </div>
        <div class="phase-step" class:active={$trainPhase === 'training'}>
          <span class="phase-dot"></span>
          <span>Modell trainieren</span>
        </div>
      </div>

      {#if $trainPhase === 'training'}
        <div class="progress-wrap">
          <div class="progress-bar"><div class="progress-fill" style="width:{$trainProgress}%"></div></div>
          <div class="progress-label">
            Epoche {$trainEpoch} / {$trainTotalEpochs} · {$trainProgress}%
          </div>
        </div>
      {:else}
        <div class="progress-wrap">
          <div class="progress-bar indeterminate"><div class="progress-fill"></div></div>
          <div class="progress-label">Features werden aus deinen Bildern berechnet…</div>
        </div>
      {/if}

      <div class="training-hint">
        Das Modell lernt gerade aus deinen Bildern. Das kann je nach Anzahl der Klassen
        und Bilder ein paar Sekunden bis einige Minuten dauern.
      </div>
    </div>

    {#if $trainPhase === 'training'}
      <div class="tp-right">
        <ModelCharts initialTab="accuracy" />
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .training-progress {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tp-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    .tp-title {
      font-size: 13px;
      font-weight: 600;
      color: rgb(var(--md-primary));
    }
    .tp-status {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: rgb(var(--md-on-surface-variant));
    }
  }
  // Steps and bar on the left, the live curve on the right — same split the
  // finished model uses for classes and evaluation.
  .tp-body {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .tp-left {
    flex: 1 1 220px;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tp-right {
    flex: 2 1 320px;
    min-width: 280px;
  }
  .progress-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .progress-bar {
    height: 10px;
    background: rgb(var(--md-surface-variant));
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: rgb(var(--md-primary));
    border-radius: 999px;
    transition: width 0.3s;
  }
  .progress-bar.indeterminate .progress-fill {
    width: 40%;
    animation: indeterminate 1.4s ease-in-out infinite;
  }
  @keyframes indeterminate {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
  .progress-label {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    font-variant-numeric: tabular-nums;
  }
  .phase-steps {
    display: flex;
    flex-direction: column;
    gap: 4px;
    .phase-step {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      &.active { color: rgb(var(--md-on-surface)); font-weight: 600; }
      &.done { opacity: 0.7; }
    }
    .phase-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid currentColor;
      flex-shrink: 0;
    }
    .phase-step.active .phase-dot { background: rgb(var(--md-primary)); border-color: rgb(var(--md-primary)); }
    .phase-step.done .phase-dot   { background: rgb(var(--md-tertiary)); border-color: rgb(var(--md-tertiary)); }
  }
  .training-hint {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    line-height: 1.5;
  }
</style>
