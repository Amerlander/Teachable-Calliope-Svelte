<script lang="ts">
  import { importModelFromZip, initSharedCamera, predictFromVideo } from '$lib/machine';
  import { getModelDiagnostics } from '$lib/machine';
  import { get } from 'svelte/store';
  import { classifierModel, mobilenetModel, classes } from '$lib/stores';
  import { setVideoRef } from '$lib/stores';
  import { selectedCameraId } from '$lib/stores/camera';
  import { showNotification } from '$lib/stores/notifications';
  import { connect as btConnect, disconnect as btDisconnect, sendUART, setTxCallback, discoverDevice, discoverServicesAndCharacteristics, getDeviceName, onDisconnectedAddListener } from '$lib/bluetooth/calliope';
  import { devices as btDevices, logs as btLogs, connectedDeviceId as btConnectedId, removeDevice as btRemoveDevice, clearLogs as btClearLogs } from '$lib/stores/bluetooth';
  import { onMount } from 'svelte';

  let webcamTryoutEl: HTMLVideoElement | null = null;
  let tryoutModelInfo = '';
  let tryoutStatus = 'Bereit zum Ausprobieren';
  let btStatusText = 'Nicht verbunden';
  let isConnected = false;
  let lastSentClass: string | null = null;
  let tryoutPrediction = '';
  let tryoutInterval: any = null;
  let running = false;
  let manualMessage = '';
  $: modelLoaded = !!$classifierModel;
  $: mobilenetReady = !!$mobilenetModel;
  $: running = !!tryoutInterval;
  $: predictionVisible = running || !!tryoutPrediction;

  // When a model is loaded via training or by uploading the zip file,
  // make sure the tryout panel shows that the model is available
  $: if ($classifierModel && !tryoutModelInfo.includes('Fehler')) {
    tryoutModelInfo = 'Modell geladen';
  }

  async function onModelFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files?.length) return;
    const file = target.files[0];
    try {
      await importModelFromZip(file);
      tryoutModelInfo = 'Modell geladen';
      tryoutStatus = 'Bereit zum Ausprobieren';
    } catch (err) {
      console.error('Failed to load tryout model', err);
      tryoutModelInfo = 'Fehler beim Laden des Modells';
    }
    target.value = '';
  }

  async function scanBluetooth() {
    try {
      await btConnect();
      isConnected = true;
      btStatusText = 'Verbunden';
      const dname = getDeviceName();
      if (dname) btStatusText = `Verbunden: ${dname}`;
      showNotification('Bluetooth verbunden', { type: 'success' });
      setTxCallback((value) => {
        btStatusText = `RX: ${value}`;
      });
      onDisconnectedAddListener(() => {
        isConnected = false;
        btStatusText = 'Nicht verbunden';
        showNotification('Bluetooth getrennt', { type: 'info' });
      });
    } catch (err) {
      console.error('Bluetooth connect failed', err);
      showNotification('Fehler beim Verbinden via Bluetooth', { type: 'error' });
      isConnected = false;
      btStatusText = 'Nicht verbunden';
    }
  }

  async function disconnectButtonPressed() {
    try {
      await btDisconnect();
    } catch (err) {
      console.warn('Disconnect failed', err);
    }
    isConnected = false;
    btStatusText = 'Nicht verbunden';
    showNotification('Bluetooth getrennt', { type: 'info' });
  }

  async function addNewDevice() {
    try {
      const d = await discoverDevice();
      if (d) {
        showNotification(`Gerät ${d.name || d.id} hinzugefügt`, { type: 'info' });
      }
    } catch (err) {
      showNotification('Fehler beim Hinzufügen des Geräts', { type: 'error' });
    }
  }

  async function connectDevice(deviceInfo: any) {
    try {
      await btConnect(deviceInfo.device);
      showNotification(`Verbunden mit ${deviceInfo.name || deviceInfo.id}`, { type: 'success' });
    } catch (err) {
      console.error('Connect failed', err);
      showNotification('Fehler beim Verbinden', { type: 'error' });
    }
  }

  async function disconnectDevice(deviceInfo: any) {
    try {
      await btDisconnect();
      showNotification('Bluetooth getrennt', { type: 'info' });
    } catch (err) {
      console.warn('Disconnect fail', err);
      showNotification('Fehler beim Trennen', { type: 'error' });
    }
  }

  async function showDeviceInfo(deviceInfo: any) {
    try {
      await discoverServicesAndCharacteristics(deviceInfo.device);
      showNotification('Dienste & Charakteristiken geladen', { type: 'info' });
    } catch (err) {
      showNotification('Fehler beim Laden der Geräteinfo', { type: 'error' });
    }
  }

  function clearBluetoothLogEntries() {
    btClearLogs();
  }

  async function sendManualMessage() {
    if (!manualMessage.trim()) return;
    try {
      await sendUART(manualMessage);
      showNotification('Nachricht gesendet', { type: 'success' });
      manualMessage = '';
    } catch (err) {
      console.error('Send failed', err);
      showNotification('Fehler beim Senden', { type: 'error' });
    }
  }

  function stopPredictionTest() {
    if (tryoutInterval) {
      clearInterval(tryoutInterval);
      tryoutInterval = null;
      tryoutStatus = 'Bereit zum Ausprobieren';
      tryoutPrediction = '';
      lastSentClass = null;
    }
  }

  function startPredictionTest() {
    if (!get(classifierModel)) { tryoutStatus = 'Bitte zuerst ein Modell laden'; return; }
    if (!get(mobilenetModel)) { tryoutStatus = 'Bitte warte auf Mobilenet (aus dem Browser)'; showNotification('Mobilenet noch nicht geladen — warte bitte kurz', { type: 'warning' }); return; }
    tryoutStatus = 'Vorhersage läuft...';
    // show placeholder while predictions are being performed
    tryoutPrediction = 'Keine Vorhersage';
    tryoutInterval = setInterval(async () => {
      if (!webcamTryoutEl) return;
      try {
        const classifier = get(classifierModel);
        const mobilenet = get(mobilenetModel);
        void classifier; void mobilenet;
        let p: any = null;
        p = await predictFromVideo(webcamTryoutEl);
        if (p) {
          tryoutPrediction = `${p.className}: ${(p.probability * 100).toFixed(1)}%`;
        } else {
          tryoutPrediction = 'Keine Vorhersage';
        }
        // send change via bluetooth if connected
        try {
          sendClassIfChanged(p?.className || null, p?.probability || 0);
        } catch (err) { /* don't block UI */ }
      } catch (err) {
        console.error('Prediction error', err);
        const msg = err instanceof Error ? err.message : String(err);
        showNotification('Fehler bei Vorhersage: ' + msg, { type: 'error' });
        tryoutStatus = 'Fehler bei Vorhersage';
      }
      // nothing here — Bluetooth is handled inside the try block above
    }, 100);
  }

  function toggleTryout() {
    if (!get(classifierModel)) { tryoutStatus = 'Bitte zuerst ein Modell laden'; return; }
    if (!tryoutInterval) {
      startPredictionTest();
    } else {
      stopPredictionTest();
    }
  }

  // One-shot test: attempt a single prediction and show result immediately
  async function testPredictionOnce() {
    if (!get(classifierModel)) return showNotification('Kein Modell geladen', { type: 'warning' });
    if (!get(mobilenetModel)) return showNotification('Mobilenet noch nicht geladen', { type: 'warning' });
    if (!webcamTryoutEl) return showNotification('Keine Kamera verfügbar', { type: 'warning' });
    try {
      const p = await predictFromVideo(webcamTryoutEl);
      if (!p) {
        showNotification('Keine Vorhersage (unsicher oder fehlgeschlagen)', { type: 'warning' });
        tryoutPrediction = 'Keine Vorhersage';
      } else {
        tryoutPrediction = `${p.className}: ${(p.probability * 100).toFixed(1)}%`;
        showNotification(`Detected ${p.className} (${(p.probability * 100).toFixed(1)}%)`, { type: 'success' });
      }
    } catch (err) {
      console.error('testPredictionOnce:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showNotification('Fehler: ' + msg, { type: 'error' });
    }
  }

  async function diagnoseModels() {
    try {
      const diag = await getModelDiagnostics();
      console.debug('Model diagnostics', diag);
      showNotification(`Mobilenet: ${diag.mobilenetLoaded} (${diag.extractor ?? '–'}, ${diag.expectedFeatures ?? '?'} Merkmale)\nClassifier: ${diag.classifierLoaded}\nClasses: ${diag.classesCount}\nEmb Shape: ${JSON.stringify(diag.embeddingShape)}\nClassifier Input: ${JSON.stringify(diag.classifierInputShape)}`, { type: 'info', duration: 10000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification('Diagnose fehlgeschlagen: ' + msg, { type: 'error' });
    }
  }

  function sendClassIfChanged(detectedClass: string | null, certainty: number) {
    if (!isConnected) return;
    if (!detectedClass) {
      if (lastSentClass) {
        // send unknown
        try { sendUART('unknown'); } catch (err) { console.warn(err); }
        lastSentClass = null;
      }
      return;
    }
    const threshold = 0.7;
    if (certainty < threshold) return; // avoid sending uncertain predictions
    if (detectedClass !== lastSentClass) {
      try {
        sendUART(detectedClass);
        lastSentClass = detectedClass;
      } catch (err) {
        console.warn('Failed to send UART', err);
      }
    }
  }

  onMount(async () => {
    setVideoRef('webcamTryout', webcamTryoutEl);
    await initSharedCamera({ webcamTryout: webcamTryoutEl }, get(selectedCameraId) ?? undefined);
  });

  $: isConnected = !!$btConnectedId;
</script>

<div class="left-panel panel">
  <div class="try-out-container">
    <div class="try-out-header">
      <h1>Modell laden</h1>
        <div class="try-out-status">
          <div class="status-indicator {btStatusText === 'Verbunden' ? 'connected' : ''}"></div>
          <span class="bt-status-text">{btStatusText}</span>
        </div>
    </div>

    <div>
      <label for="tryout-load-model">Trainiertes Modell:</label>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <label class="file-label" for="tryout-load-model">Modell hochladen</label>
        <input id="tryout-load-model" type="file" accept=".zip" style="display:none" on:change={onModelFileChange}>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <div class="status-indicator {modelLoaded ? 'connected' : ''}"></div>
        <div class="model-presence">{modelLoaded ? 'Modell geladen' : 'Kein Modell'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <div class="status-indicator {mobilenetReady ? 'connected' : ''}"></div>
        <div class="model-presence">{mobilenetReady ? 'Mobilenet bereit' : 'Mobilenet wird geladen'}</div>
      </div>
      <div class="tryout-model-info model-info">{tryoutModelInfo}</div>
    </div>

    <hr style="margin:12px 0;">

    <div class="video-wrap">
      <video bind:this={webcamTryoutEl} autoplay playsinline>
        <track kind="captions">
      </video>
      <div class="overlay">
        <div class="status dark tryout-status">{tryoutStatus}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button
            class="ghost tryout-capture"
            on:click={toggleTryout}
            disabled={!modelLoaded || !mobilenetReady}
          >{running ? 'Stoppen' : 'Starten'}</button>
          <button class="ghost tryout-capture" on:click={testPredictionOnce} disabled={!modelLoaded || !mobilenetReady}>Sofort testen</button>
          <button class="ghost tryout-capture" on:click={diagnoseModels} disabled={!modelLoaded && !mobilenetReady}>Diagnose</button>
        </div>
        <div class="button-hint tryout-hint" style="color:#fff;">{!mobilenetReady ? 'Mobilenet wird geladen...' : 'Klicke zum Starten/Stoppen der Echtzeit-Vorhersage'}</div>
      </div>
          <div
            class="prediction-display {predictionVisible ? 'visible' : ''}"
            aria-live="polite"
            role="status"
          >
            {tryoutPrediction}
          </div>
    </div>

    <h1>Calliope mini Verbindung</h1>
    <div class="bluetooth-controls">
      <div class="bluetooth-actions" style="display:flex;gap:8px;margin-bottom:8px;">
        <button class="scan-bluetooth" on:click={addNewDevice}>Gerät hinzufügen</button>
        <button class="scan-bluetooth" on:click={scanBluetooth} disabled={isConnected}>Verbinden</button>
        <button class="disconnect-bluetooth" on:click={disconnectButtonPressed} disabled={!isConnected}>Trennen</button>
        <div style="margin-left:auto;">{btStatusText}</div>
      </div>

      <div class="bluetooth-list" style="margin-top:8px;">
        {#if $btDevices.length === 0}
          <div style="color:#666;">Keine Geräte</div>
        {/if}
        {#each $btDevices as d}
          <div class="bluetooth-device {d.connected ? 'selected' : ''}" style="display:flex;flex-direction:column;padding:8px;border-radius:8px;margin-bottom:6px;border:1px solid rgba(0,0,0,0.06);">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div class="device-name">{d.name || d.id}</div>
              <div class="device-actions" style="display:flex;gap:6px;">
                <button on:click={() => connectDevice(d)} disabled={d.connected}>Verbinden</button>
                <button on:click={() => disconnectDevice(d)} disabled={!d.connected}>Trennen</button>
                <button on:click={() => showDeviceInfo(d)}>Dienste</button>
                <button on:click={() => btRemoveDevice(d.id)} class="ghost">Entfernen</button>
              </div>
            </div>
            {#if d.characteristics}
              <div class="device-chars" style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
                {#each d.characteristics as c}
                  <div class="char-item" style="font-size:12px;color:#444;display:flex;justify-content:space-between;">
                    <span class="uuid">{c.uuid}</span>
                    <span class="props">{Object.keys(c.properties).filter(k=>c.properties[k]).join(', ')}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="bluetooth-logs" style="margin-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h4 style="margin:0;">Logs</h4>
          <div style="display:flex;gap:6px;">
            <button class="ghost" on:click={clearBluetoothLogEntries}>Leeren</button>
          </div>
        </div>
        <div class="log-list" style="max-height:120px;overflow:auto;border-radius:6px;padding:8px;background:rgba(0,0,0,0.03);">
          {#each $btLogs as l}
            <div class="log-entry {l.level}" style="font-size:12px;color:#222;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.04);">
              <span style="color:#888;margin-right:8px;">{new Date(l.time).toLocaleTimeString()}</span>
              <span>{l.message}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="manual-send" style="display:flex;gap:8px;margin-top:8px;">
        <input type="text" placeholder="Nachricht an Gerät" bind:value={manualMessage} />
        <button on:click={sendManualMessage} disabled={!manualMessage}>Senden</button>
      </div>
    </div>
  </div>
</div>


<style>
  .video-wrap {
    position: relative;
    width: 100%;
    padding-top: 75%; /* 4:3 aspect ratio */
    background: #000;
    border-radius: 8px;
    overflow: hidden;

    video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
</style>