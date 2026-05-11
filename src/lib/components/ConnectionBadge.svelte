<script lang="ts">
  import Dropdown from './ui/Dropdown.svelte';
  import ConnectionPanel from './ConnectionPanel.svelte';
  import { calliopeState, type CalliopeStatus } from '@calliope-edu/mini-connection-widget';
  import { currentLang, t } from '$lib/stores/app';

  type Props = { appearance?: 'dark' | 'light' };
  let { appearance = 'dark' }: Props = $props();

  let open = $state(false);
  const s = $derived($calliopeState);
  const lang = $derived($currentLang);

  // Compact label that fits in the header pill. Mirrors the panel's status
  // string but stays a single line.
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
</script>

<Dropdown bind:isOpen={open} minWidth="280px" position="right" closeOnClick={false}>
  {#snippet trigger()}
    <button
      class="conn-badge status-{s.status} appearance-{appearance}"
      aria-label={t('tryout.calliopeConnection', lang)}
      title={t('tryout.calliopeConnection', lang)}
    >
      {#if isIndeterminate}
        <span class="spinner"></span>
      {:else}
        <span class="dot"></span>
      {/if}
      <span class="label">{statusLabel(s.status)}</span>
      {#if s.status === 'flashing' && s.flashProgress != null && !isIndeterminate}
        <span class="progress" style="width: {s.flashProgress}%"></span>
      {/if}
    </button>
  {/snippet}
  {#snippet children()}
    <ConnectionPanel onaction={() => { open = false; }} />
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

    .spinner {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(0, 229, 255, 0.3);
      border-top-color: #00e5ff;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
