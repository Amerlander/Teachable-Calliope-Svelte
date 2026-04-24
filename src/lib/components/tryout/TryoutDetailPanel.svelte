<script lang="ts">
  import {
    calliopeState,
    calliopeLog,
    connectCalliope,
    disconnectCalliope,
    clearCalliopeLog,
  } from '$lib/stores/connection';
  import { currentDetection } from '$lib/stores/streaming';
  import { currentLang, t } from '$lib/stores/app';
  import { currentProject } from '$lib/stores/projects';

  const lang = $derived($currentLang);
  const s = $derived($calliopeState);
  const det = $derived($currentDetection);
  const log = $derived($calliopeLog);
  const mode = $derived($currentProject?.mode ?? 'image');

  const statusLabel = $derived(
    s.status === 'connected'
      ? t('connection.connected', lang)
      : s.status === 'flashing'
        ? t('connection.flashing', lang)
        : s.status === 'connecting'
          ? t('connection.connecting', lang)
          : s.status === 'unsupported'
            ? t('connection.unsupported', lang)
            : s.status === 'error'
              ? t('connection.error', lang)
              : t('tryout.notConnected', lang),
  );

  const connected = $derived(s.status === 'connected' || s.status === 'flashing');

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
  }
</script>

<div class="detail-panel">
  <!-- Section: current detection -->
  <section>
    <h4>{t('detail.currentDetection', lang)}</h4>
    {#if det}
      <div class="detection">
        <div class="det-label">{det.label}</div>
        <div class="det-bar">
          <div
            class="det-bar-fill"
            class:confident={det.confidence >= 0.7}
            style="width: {(det.confidence * 100).toFixed(0)}%"
          ></div>
        </div>
        <div class="det-conf">{(det.confidence * 100).toFixed(0)}%</div>
      </div>
      <div class="det-meta">
        <span>ID #{det.id}</span>
        <span>&middot;</span>
        <span>{mode === 'pose' ? 'Pose' : 'Objekt'}</span>
        <span>&middot;</span>
        <span>{formatTime(det.at)}</span>
      </div>
    {:else}
      <div class="empty">{t('detail.noDetection', lang)}</div>
    {/if}
  </section>

  <!-- Section: Calliope connection -->
  <section>
    <h4>{t('tryout.calliopeConnection', lang)}</h4>
    <div class="conn-row">
      <span class="dot status-{s.status}"></span>
      <span class="status-text">{statusLabel}</span>
      {#if s.boardVersion}
        <span class="muted">&middot; Calliope mini ({s.boardVersion})</span>
      {/if}
    </div>

    {#if s.status === 'flashing'}
      <div class="flash-block">
        <div class="flash-line">
          {s.flashPartial
            ? t('connection.partialFlash', lang)
            : t('connection.fullFlash', lang)}
          &middot; {s.flashProgress ?? 0}%
          {#if s.lastFlashName}&middot; {s.lastFlashName}{/if}
        </div>
        <div class="flash-bar">
          <div class="flash-bar-fill" style="width: {s.flashProgress ?? 0}%"></div>
        </div>
      </div>
    {/if}

    {#if s.errorMessage}
      <div class="error">{s.errorMessage}</div>
    {/if}

    {#if s.lastFlashAt && s.status !== 'flashing'}
      <div class="muted small">
        {t('connection.lastFlash', lang)}: {formatTime(s.lastFlashAt)}
        {#if s.lastFlashName}&middot; {s.lastFlashName}{/if}
      </div>
    {/if}

    <div class="actions">
      {#if s.status === 'unsupported'}
        <div class="hint">{t('connection.unsupportedHint', lang)}</div>
      {:else if connected}
        <button class="btn ghost" onclick={() => void disconnectCalliope()}>
          {t('tryout.disconnect', lang)}
        </button>
      {:else}
        <button
          class="btn primary"
          onclick={() => void connectCalliope()}
          disabled={s.status === 'connecting'}
        >
          {t('tryout.connect', lang)}
        </button>
      {/if}
    </div>
  </section>

  <!-- Section: communication log -->
  <section>
    <div class="log-head">
      <h4>{t('detail.log', lang)}</h4>
      <button class="link-btn" onclick={clearCalliopeLog}>{t('detail.clear', lang)}</button>
    </div>
    <div class="log-list">
      {#if log.length === 0}
        <div class="empty">{t('detail.logEmpty', lang)}</div>
      {:else}
        {#each log.slice().reverse() as e (e.time + e.direction + e.text)}
          <div class="log-row dir-{e.direction}">
            <span class="log-time">{formatTime(e.time)}</span>
            <span class="log-dir">
              {#if e.direction === 'tx'}→{/if}
              {#if e.direction === 'rx'}←{/if}
              {#if e.direction === 'info'}i{/if}
              {#if e.direction === 'error'}!{/if}
            </span>
            <span class="log-text">{e.text}</span>
          </div>
        {/each}
      {/if}
    </div>
  </section>
</div>

<style lang="scss">
  .detail-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 14px 14px;
    font-size: 13px;
    color: #222;
  }
  section {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h4 {
    margin: 0 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
    font-weight: 600;
  }
  .empty {
    color: #999;
    font-size: 12px;
    font-style: italic;
  }
  .detection {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .det-label {
    font-weight: 600;
    flex: 0 0 auto;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .det-bar {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }
  .det-bar-fill {
    height: 100%;
    background: #9ca3af;
    transition: width 0.15s;
    &.confident { background: #22c55e; }
  }
  .det-conf {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    color: #555;
    flex: 0 0 auto;
  }
  .det-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: #888;
  }

  .conn-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #9ca3af;
    flex-shrink: 0;
    &.status-connected { background: #22c55e; }
    &.status-flashing { background: #00b8cc; animation: pulse 1s ease-in-out infinite; }
    &.status-connecting { background: #facc15; animation: pulse 0.8s ease-in-out infinite; }
    &.status-error { background: #ef4444; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .status-text {
    font-weight: 600;
  }
  .muted { color: #888; }
  .small { font-size: 11px; }

  .flash-block {
    margin-top: 4px;
  }
  .flash-line {
    font-size: 11px;
    color: #555;
    margin-bottom: 4px;
  }
  .flash-bar {
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }
  .flash-bar-fill {
    height: 100%;
    background: #00b8cc;
    transition: width 0.15s;
  }
  .error {
    padding: 8px 10px;
    background: #fee2e2;
    color: #991b1b;
    border-radius: 6px;
    font-size: 12px;
    word-break: break-word;
  }
  .hint {
    font-size: 11px;
    color: #666;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    &.primary {
      background: #1b1c1d;
      color: #fff;
      &:hover:not(:disabled) { background: #333; }
      &:disabled { opacity: 0.5; cursor: default; }
    }
    &.ghost {
      background: transparent;
      border-color: #d1d5db;
      color: #1b1c1d;
      &:hover { background: #f3f4f6; }
    }
  }

  .log-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    h4 { margin: 0; }
  }
  .link-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    &:hover { color: #222; }
  }
  .log-list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 11px;
    color: #333;
  }
  .log-row {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px dotted #eee;
    &:last-child { border-bottom: none; }
  }
  .log-time {
    color: #888;
    flex: 0 0 auto;
  }
  .log-dir {
    flex: 0 0 12px;
    text-align: center;
    font-weight: 700;
  }
  .log-text {
    flex: 1;
    word-break: break-all;
  }
  .dir-tx { .log-dir { color: #0369a1; } }
  .dir-rx { .log-dir { color: #15803d; } }
  .dir-info { .log-dir { color: #666; } }
  .dir-error {
    .log-dir { color: #dc2626; }
    .log-text { color: #991b1b; }
  }
</style>
