<script lang="ts">
  import { currentLang, t, btConnected, btStatusText, sendEveryPrediction } from '$lib/stores/app';
  import { showNotification } from '$lib/stores/notifications';
  import { loadModelFromZip } from '$lib/machine';
  import { classifierModel } from '$lib/stores';

  const lang = $derived($currentLang);

  let collapsed = $state(true);
  let modelInfo = $state('');
  let btDevice: BluetoothDevice | null = null;
  let btChar: BluetoothRemoteGATTCharacteristic | null = null;

  async function onLoadModel(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await loadModelFromZip(input.files[0]);
      modelInfo = 'Modell geladen: ' + input.files[0].name;
      showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  async function connectBluetooth() {
    try {
      // @ts-ignore
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'BBC micro:bit' }, { namePrefix: 'Calliope' }],
        optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e']
      });
      btDevice = device;
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
      btChar = await service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
      btConnected.set(true);
      btStatusText.set('Verbunden mit ' + (device.name || 'Gerät'));
      device.addEventListener('gattserverdisconnected', () => {
        btConnected.set(false);
        btStatusText.set('Nicht verbunden');
        btChar = null;
      });
    } catch (err) {
      showNotification('Verbindung fehlgeschlagen: ' + (err as Error).message, { type: 'error' });
    }
  }

  async function disconnectBluetooth() {
    btDevice?.gatt?.disconnect();
    btConnected.set(false);
    btStatusText.set('Nicht verbunden');
    btChar = null;
  }
</script>

<div class="panel-wrap" class:collapsed>
  <div class="panel-header" role="button" tabindex="0"
    onclick={() => collapsed = !collapsed}
    onkeydown={(e) => e.key === 'Enter' && (collapsed = !collapsed)}
  >
    <h3>{t('tryout.loadModelTitle', lang)}</h3>
    <button class="toggle" aria-label="Toggle" onclick={(e) => { e.stopPropagation(); collapsed = !collapsed; }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style:transform={collapsed ? 'rotate(-90deg)' : ''}>
        <path d="M5 7l5 5 5-5H5z"/>
      </svg>
    </button>
  </div>

  {#if !collapsed}
    <div class="panel-body">
      <!-- Model load -->
      <div class="section">
        <span class="section-label">{t('tryout.loadModelTitle', lang)}</span>
        <label class="file-label" style="margin-top:6px;" for="apply-load-model">
          {t('tryout.uploadModel', lang)}
          <input id="apply-load-model" type="file" accept=".zip" style="display:none" onchange={onLoadModel} />
        </label>
        {#if modelInfo}<div class="model-info">{modelInfo}</div>{/if}
      </div>

      <hr />

      <!-- Bluetooth -->
      <div class="section">
        <h4 style="margin:0 0 8px;">{t('tryout.calliopeConnection', lang)}</h4>
        <div class="bt-status">
          <span class="dot" class:connected={$btConnected}></span>
          <span>{$btStatusText}</span>
        </div>

        <div class="row" style="margin-top:8px;gap:8px;">
          {#if !$btConnected}
            <button onclick={connectBluetooth}>{t('tryout.connect', lang)}</button>
          {:else}
            <button class="ghost" onclick={disconnectBluetooth}>{t('tryout.disconnect', lang)}</button>
          {/if}
        </div>

        {#if $btConnected}
          <label class="checkbox-row" style="margin-top:10px;">
            <input type="checkbox" bind:checked={$sendEveryPrediction} />
            <span>{t('tryout.sendEveryPrediction', lang)}</span>
          </label>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .panel-wrap {
    position: fixed;
    top: 80px;
    right: 24px;
    width: 320px;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    overflow: hidden;
    transition: transform 0.3s ease, opacity 0.3s ease;
  }
  .panel-header {
    background: rgb(var(--md-primary));
    color: white;
    padding: 14px 20px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
    h3 { margin: 0; font-size: 15px; font-weight: 600; }
  }
  .toggle {
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    box-shadow: none;
    min-height: unset;
    svg { transition: transform 0.3s ease; }
  }
  .panel-body {
    padding: 16px;
    max-height: calc(100vh - 140px);
    overflow-y: auto;
  }
  .section { display: flex; flex-direction: column; margin-bottom: 4px; }
  .row { display: flex; gap: 8px; }
  .bt-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: rgb(var(--md-outline));
    &.connected {
      background: #4caf50;
      box-shadow: 0 0 8px rgba(76, 175, 80, 0.5);
    }
  }
  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    font-weight: 400;
    color: rgb(var(--md-on-surface));
    cursor: pointer;
    input { margin-top: 2px; }
  }
</style>
