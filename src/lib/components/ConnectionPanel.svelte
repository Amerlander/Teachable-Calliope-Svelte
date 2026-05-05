<script lang="ts">
  import {
    calliopeState,
    connectCalliope,
    disconnectAndForget,
    showBlePairingInfo,
    type CalliopeStatus,
    type CalliopeTransport,
  } from '$lib/stores/connection';
  import { currentLang, t } from '$lib/stores/app';

  type Props = {
    /** Called after the user clicks an action (used by the dropdown shell to close itself). */
    onaction?: () => void;
  };
  let { onaction }: Props = $props();

  const s = $derived($calliopeState);
  const lang = $derived($currentLang);

  function statusLabel(status: CalliopeStatus): string {
    switch (status) {
      case 'connected':
        return t('connection.connected', lang);
      case 'flashing': {
        const phase = s.flashPhase;
        if (phase === 'check') return t('connection.phase.check', lang);
        if (phase === 'reboot') return t('connection.phase.reboot', lang);
        if (phase === 'prepare') return t('connection.phase.prepare', lang);
        if (phase === 'finalising') return t('connection.phase.finalising', lang);
        return `${t('connection.flashing', lang)} ${s.flashProgress ?? 0}%`;
      }
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

  const isIndeterminate = $derived(
    s.status === 'flashing' &&
    (s.flashPhase === 'check' || s.flashPhase === 'reboot' || s.flashPhase === 'prepare')
  );

  function capabilityText(transport: CalliopeTransport): string {
    if (transport === 'usb') {
      if (s.usbStatus === 'connected') return 'Flashen & Kommunikation';
      if (s.usbStatus === 'connecting') return 'Verbinde…';
      if (s.usbStatus === 'error') return s.usbErrorMessage ?? 'Fehler';
      if (!s.usbSupported) return 'WebUSB nicht verfügbar';
      return 'Nicht verbunden';
    }
    if (s.bleStatus === 'connected') {
      if (s.bleCanFlash && s.bleCanCommunicate) return 'Flashen & Kommunikation';
      if (s.bleCanCommunicate) return 'Nur Kommunikation';
      return 'Verbunden — OS-Pairing fehlt';
    }
    if (s.bleStatus === 'connecting') return 'Verbinde…';
    if (s.bleStatus === 'error') return s.bleErrorMessage ?? 'Fehler';
    if (!s.bleSupported) return 'Web Bluetooth nicht verfügbar';
    return 'Nicht verbunden';
  }

  function fire() { onaction?.(); }
  function doConnectUsb() { fire(); void connectCalliope('usb'); }
  function doConnectBle() { fire(); void connectCalliope('ble'); }
  function doForgetUsb() { fire(); void disconnectAndForget('usb'); }
  function doForgetBle() { fire(); void disconnectAndForget('ble'); }
  function doShowPairingInfo() { fire(); showBlePairingInfo(); }

  function formatConnectedSince(ts: number | undefined): string {
    if (!ts) return '';
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }

  let nowTick = $state(Date.now());
  $effect(() => {
    if (s.status !== 'connected') return;
    const id = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  const sinceLabel = $derived(
    nowTick && s.connectedAt ? formatConnectedSince(s.connectedAt) : '',
  );
</script>

<div class="panel">
  <div class="panel-header">
    <span class="dot-lg status-{s.status}"></span>
    <div class="panel-header-text">
      <div class="title">{t('tryout.calliopeConnection', lang)}</div>
      <div class="subtitle">{statusLabel(s.status)}</div>
    </div>
  </div>

  {#if s.calliopeVersion || s.boardVersion || s.usbDeviceName || s.bleDeviceName}
    <div class="device-card">
      <div class="device-card-head">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8" cy="12" r="1" />
          <circle cx="16" cy="12" r="1" />
        </svg>
        <span class="device-card-name">
          {s.usbDeviceName ?? s.bleDeviceName ?? 'Calliope mini'}
        </span>
      </div>
      <div class="device-card-rows">
        {#if s.calliopeVersion || s.boardVersion}
          <div class="meta-row">
            <span class="meta-key">Version</span>
            <span class="meta-val">{s.calliopeVersion ?? s.boardVersion}</span>
          </div>
        {/if}
        {#if s.status === 'connected' && s.connectedAt}
          <div class="meta-row">
            <span class="meta-key">Verbunden seit</span>
            <span class="meta-val">{sinceLabel}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="transports">
    {#if s.usbSupported}
      {@const busy = s.usbStatus === 'connecting' || s.flashTransport === 'usb'}
      {@const connected = s.usbStatus === 'connected'}
      <div class="transport-row" class:connected class:err={s.usbStatus === 'error'}>
        <div class="transport-row-head">
          <span class="transport-name">USB</span>
          <span class="transport-status">{capabilityText('usb')}</span>
        </div>
        <div class="transport-row-actions">
          {#if connected}
            <button class="row-btn ghost" onclick={doForgetUsb} disabled={busy}>
              Trennen
            </button>
          {:else}
            <button class="row-btn primary" onclick={doConnectUsb} disabled={busy}>
              {busy ? 'Verbinde…' : 'Verbinden'}
            </button>
          {/if}
        </div>
      </div>
    {/if}

    {#if s.bleSupported}
      {@const busy = s.bleStatus === 'connecting' || s.flashTransport === 'ble'}
      {@const connected = s.bleStatus === 'connected'}
      {@const needsPairing = connected && !s.bleCanCommunicate}
      <div class="transport-row" class:connected class:err={s.bleStatus === 'error'} class:warn={needsPairing}>
        <div class="transport-row-head">
          <span class="transport-name">Bluetooth</span>
          <span class="transport-status">{capabilityText('ble')}</span>
        </div>
        {#if needsPairing}
          <div class="transport-hint">
            Calliope einmal in den OS-Bluetooth-Einstellungen koppeln.
            <button type="button" class="link-btn" onclick={doShowPairingInfo}>
              Wie pairen?
            </button>
          </div>
        {/if}
        <div class="transport-row-actions">
          {#if connected}
            <button class="row-btn ghost" onclick={doForgetBle} disabled={busy}>
              Trennen & vergessen
            </button>
          {:else}
            <button class="row-btn primary" onclick={doConnectBle} disabled={busy}>
              {busy ? 'Verbinde…' : 'Verbinden'}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if s.status === 'flashing'}
    <div class="flash-block">
      {#if isIndeterminate}
        <div class="flash-line indeterminate">
          <span class="spinner-inline"></span>
          {statusLabel(s.status)}
        </div>
        <div class="flash-bar">
          <div class="flash-bar-indeterminate"></div>
        </div>
      {:else}
        <div class="flash-line">
          {s.flashPartial ? t('connection.partialFlash', lang) : t('connection.fullFlash', lang)}
          &middot; {s.flashProgress ?? 0}%
        </div>
        <div class="flash-bar">
          <div class="flash-bar-fill" style="width: {s.flashProgress ?? 0}%"></div>
        </div>
      {/if}
    </div>
  {/if}

  {#if s.usbErrorMessage}
    <div class="error">USB: {s.usbErrorMessage}</div>
  {/if}
  {#if s.bleErrorMessage}
    <div class="error">BLE: {s.bleErrorMessage}</div>
  {/if}

  {#if !s.usbSupported && !s.bleSupported}
    <div class="hint">{t('connection.unsupportedHint', lang)}</div>
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
</div>

<style lang="scss">
  .panel {
    padding: 14px;
    color: #222;
  }
  .panel-header {
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
  .panel-header-text .title {
    font-weight: 600;
    font-size: 14px;
  }
  .panel-header-text .subtitle {
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

  .device-card {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .device-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #111;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
    svg { color: #6b7280; flex-shrink: 0; }
  }
  .device-card-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .device-card-rows {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .transports {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0 4px;
  }
  .transport-row {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 10px;
    background: #fff;
    transition: border-color 0.15s, background 0.15s;

    &.connected {
      border-color: #bbf7d0;
      background: #f0fdf4;
    }
    &.warn {
      border-color: #fde68a;
      background: #fffbeb;
    }
    &.err {
      border-color: #fecaca;
      background: #fef2f2;
    }
  }
  .transport-row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .transport-name {
    font-size: 13px;
    font-weight: 600;
    color: #111;
  }
  .transport-status {
    font-size: 11px;
    color: #6b7280;
    text-align: right;
  }
  .transport-row.connected .transport-status { color: #166534; }
  .transport-row.warn .transport-status { color: #92400e; }
  .transport-row.err .transport-status { color: #991b1b; }
  .transport-hint {
    font-size: 11px;
    color: #6b7280;
    line-height: 1.35;
    margin-top: 4px;
  }
  .transport-row-actions {
    margin-top: 6px;
    display: flex;
    gap: 6px;
  }
  .row-btn {
    flex: 1;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 600;
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
      &:hover:not(:disabled) { background: #f3f4f6; }
      &:disabled { opacity: 0.5; cursor: default; }
    }
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    margin-left: 4px;
    color: #0ea5b7;
    text-decoration: underline;
    font-size: inherit;
    cursor: pointer;
    &:hover { color: #0891a8; }
  }
  .flash-block {
    margin: 10px 0;
  }
  .flash-line {
    font-size: 12px;
    color: #555;
    margin-bottom: 6px;
    &.indeterminate {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }
  .spinner-inline {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid rgba(0, 184, 204, 0.25);
    border-top-color: #00b8cc;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes indeterminate {
    0% { left: -40%; width: 40%; }
    60% { left: 100%; width: 40%; }
    100% { left: 100%; width: 40%; }
  }
  .flash-bar {
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
    position: relative;
  }
  .flash-bar-fill {
    height: 100%;
    background: #00b8cc;
    transition: width 0.15s;
  }
  .flash-bar-indeterminate {
    position: absolute;
    height: 100%;
    background: #00b8cc;
    border-radius: 3px;
    animation: indeterminate 1.4s ease-in-out infinite;
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
  .hint {
    font-size: 12px;
    color: #666;
    line-height: 1.4;
  }
</style>
