<script lang="ts">
  import { onMount } from 'svelte';
  import { listCameras } from '$lib/machine';
  import { selectedCameraId, switchCamera } from '$lib/stores/camera';

  let cameras = $state<MediaDeviceInfo[]>([]);
  let loading = $state(true);

  onMount(async () => {
    cameras = await listCameras();
    loading = false;
    // If persisted selection isn't in the list, clear it
    if ($selectedCameraId && !cameras.some((c) => c.deviceId === $selectedCameraId)) {
      selectedCameraId.set(null);
    }
  });

  async function onChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    await switchCamera(id);
  }
</script>

{#if !loading && cameras.length > 1}
  <div class="camera-select">
    <label for="camera-select">Kamera</label>
    <select
      id="camera-select"
      value={$selectedCameraId ?? cameras[0]?.deviceId ?? ''}
      onchange={onChange}
    >
      {#each cameras as cam}
        <option value={cam.deviceId}>
          {cam.label || `Kamera ${cam.deviceId.slice(0, 8)}`}
        </option>
      {/each}
    </select>
  </div>
{/if}

<style lang="scss">
  .camera-select {
    display: flex;
    align-items: center;
    gap: 8px;
    label {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      font-weight: 500;
    }
    select {
      flex: 1;
      font-size: 13px;
    }
  }
</style>
