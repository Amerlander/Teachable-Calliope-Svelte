<script lang="ts">
  import Dropdown from './ui/Dropdown.svelte';
  import {
    calliopeState,
    connectCalliope,
    disconnectCalliope,
    setCalliopeTransportMode,
    type CalliopeStatus,
    type CalliopeTransportMode,
  } from '$lib/stores/connection';
  import { currentLang, t } from '$lib/stores/app';

  type Props = { appearance?: 'dark' | 'light' };
  let { appearance = 'dark' }: Props = $props();

  let open = $state(false);
  const s = $derived($calliopeState);
  const lang = $derived($currentLang);

  function statusLabel(status: CalliopeStatus): string {
    switch (status) {
      case 'connected':
        return t('connection.connected', lang);
      case 'flashing':
        return `${t('connection.flashing', lang)} ${s.flashProgress ?? 0}%`;
      case 'connecting':
        return t('connection.connecting', lang);
      case 'error':
        return t('connection.error', lang);
      case 'unsupported':
        return t('connection.unsupported', lang);
      case 'disconnected':
      case 'unknown':
      default:
        return t('tryout.notConnected', lang);
    }
  }

  function doConnect() {
    open = false;
    void connectCalliope();
  }

  function doDisconnect() {
    open = false;
    void disconnectCalliope();
  }

  function pickMode(m: CalliopeTransportMode) {
    setCalliopeTransportMode(m);
  }
</script>

<Dropdown bind:isOpen={open} minWidth="280px" position="right" closeOnClick={false}>
  {#snippet trigger()}
    <button
      class="conn-badge status-{s.status} appearance-{appearance}"
      aria-label={t('tryout.calliopeConnection', lang)}
      title={t('tryout.calliopeConnection', lang)}
    >
      <span class="dot"></span>
      <span class="label">{statusLabel(s.status)}</span>
      {#if s.status === 'flashing' && s.flashProgress != null}
        <span class="progress" style="width: {s.flashProgress}%"></span>
      {/if}
    </button>
  {/snippet}
  {#snippet children()}
    <div class="popover">
      <div class="popover-header">
        <span class="dot-lg status-{s.status}"></span>
        <div class="popover-header-text">
          <div class="title">{t('tryout.calliopeConnection', lang)}</div>
          <div class="subtitle">{statusLabel(s.status)}</div>
        </div>
      </div>

      {#if s.calliopeVersion || s.boardVersion}
        <div class="meta-row">
          <span class="meta-key">Board</span>
          <span class="meta-val">Calliope mini ({s.calliopeVersion ?? s.boardVersion})</span>
        </div>
      {/if}

      {#if s.usbSupported || s.bleSupported}
        <div class="transport-tabs" role="tablist" aria-label="Übertragungsmodus">
          <button
            type="button"
            role="tab"
            class="tab"
            class:active={s.transportMode === 'usb'}
            aria-selected={s.transportMode === 'usb'}
            disabled={!s.usbSupported || s.status === 'flashing' || s.status === 'connecting'}
            onclick={() => pickMode('usb')}
            title="Verbinden und Flashen über USB-Kabel"
          >USB</button>
          <button
            type="button"
            role="tab"
            class="tab"
            class:active={s.transportMode === 'ble-full'}
            aria-selected={s.transportMode === 'ble-full'}
            disabled={!s.bleSupported || s.status === 'flashing' || s.status === 'connecting'}
            onclick={() => pickMode('ble-full')}
            title={!s.bleSupported
              ? 'Web Bluetooth nicht verfügbar'
              : 'Verbinden und Flashen über Bluetooth (einmaliges OS-Pairing nötig)'}
          >BLE</button>
          <button
            type="button"
            role="tab"
            class="tab"
            class:active={s.transportMode === 'ble-hybrid'}
            aria-selected={s.transportMode === 'ble-hybrid'}
            disabled={!s.bleSupported || !s.usbSupported || s.status === 'flashing' || s.status === 'connecting'}
            onclick={() => pickMode('ble-hybrid')}
            title="Bluetooth für Live-Daten, USB nur beim Flashen"
          >BLE + USB</button>
        </div>
        <div class="mode-hint">
          {#if s.transportMode === 'usb'}
            Übertragung und Live-Daten über USB-Kabel.
          {:else if s.transportMode === 'ble-full'}
            Drahtlos. Calliope muss einmalig per OS-Bluetooth gekoppelt sein.
          {:else}
            Live-Daten drahtlos. Beim Flashen wirst du zum USB-Anschließen aufgefordert.
          {/if}
        </div>
      {/if}

      {#if s.status === 'flashing'}
        <div class="flash-block">
          <div class="flash-line">
            {s.flashPartial ? t('connection.partialFlash', lang) : t('connection.fullFlash', lang)}
            &middot; {s.flashProgress ?? 0}%
          </div>
          <div class="flash-bar">
            <div class="flash-bar-fill" style="width: {s.flashProgress ?? 0}%"></div>
          </div>
        </div>
      {/if}

      {#if s.errorMessage}
        <div class="error">{s.errorMessage}</div>
      {/if}

      {#if s.lastFlashAt}
        <div class="meta-row muted">
          <span class="meta-key">{t('connection.lastFlash', lang)}</span>
          <span class="meta-val">
            {new Date(s.lastFlashAt).toLocaleTimeString()}
            {#if s.lastFlashName}&middot; {s.lastFlashName}{/if}
          </span>
        </div>
      {/if}

      <div class="actions">
        {#if s.status === 'unsupported'}
          <div class="hint">{t('connection.unsupportedHint', lang)}</div>
        {:else if s.status === 'connected' || s.status === 'flashing'}
          <button class="btn ghost" onclick={doDisconnect}>
            {t('tryout.disconnect', lang)}
          </button>
        {:else}
          <button
            class="btn primary"
            onclick={doConnect}
            disabled={s.status === 'connecting'}
          >
            {t('tryout.connect', lang)}
          </button>
        {/if}
      </div>

    </div>
  {/snippet}
</Dropdown>

<style lang="scss">
  .conn-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    overflow: hidden;
    white-space: nowrap;

    &.appearance-dark {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.92);
      &:hover { background: rgba(255, 255, 255, 0.14); }
    }
    &.appearance-light {
      background: #fff;
      border: 1px solid #d1d5db;
      color: #1b1c1d;
      &:hover { background: #f3f4f6; }
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #888;
      flex-shrink: 0;
    }
    .label {
      position: relative;
      z-index: 1;
    }
    .progress {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: rgba(0, 229, 255, 0.22);
      transition: width 0.15s;
      z-index: 0;
    }

    &.status-connected .dot {
      background: #22c55e;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
    }
    &.status-flashing .dot {
      background: #00e5ff;
      animation: pulse 1s ease-in-out infinite;
    }
    &.status-connecting .dot {
      background: #facc15;
      animation: pulse 0.8s ease-in-out infinite;
    }
    &.status-error .dot {
      background: #ef4444;
    }
    &.status-unsupported .dot {
      background: #6b7280;
    }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .popover {
    padding: 14px;
    min-width: 260px;
    color: #222;
  }
  .popover-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .dot-lg {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #9ca3af;
    flex-shrink: 0;
    &.status-connected { background: #22c55e; }
    &.status-flashing { background: #00e5ff; }
    &.status-connecting { background: #facc15; }
    &.status-error { background: #ef4444; }
  }
  .popover-header-text .title {
    font-weight: 600;
    font-size: 14px;
  }
  .popover-header-text .subtitle {
    font-size: 12px;
    color: #666;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 4px 0;
    &.muted { color: #666; }
  }
  .meta-key { color: #666; }
  .transport-tabs {
    display: flex;
    gap: 4px;
    margin: 10px 0 4px;
    padding: 3px;
    background: #f3f4f6;
    border-radius: 8px;
  }
  .mode-hint {
    font-size: 11px;
    color: #6b7280;
    line-height: 1.35;
    margin: 0 2px 6px;
  }
  .tab {
    flex: 1;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #4b5563;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    &:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
    &.active {
      background: #fff;
      color: #111;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
  .flash-block {
    margin: 10px 0;
  }
  .flash-line {
    font-size: 12px;
    color: #555;
    margin-bottom: 6px;
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
    margin-top: 8px;
    padding: 8px 10px;
    background: #fee2e2;
    color: #991b1b;
    border-radius: 6px;
    font-size: 12px;
    word-break: break-word;
  }
  .actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }
  .btn {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
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
  .hint {
    font-size: 12px;
    color: #666;
    line-height: 1.4;
  }
</style>
