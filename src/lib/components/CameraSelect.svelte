<script lang="ts">
  import { onMount } from 'svelte';
  import { listCameras } from '$lib/machine';
  import { selectedCameraId, switchCamera } from '$lib/stores/camera';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';

  let cameras = $state<MediaDeviceInfo[]>([]);
  let loading = $state(true);

  onMount(async () => {
    cameras = await listCameras();
    loading = false;
    if ($selectedCameraId && !cameras.some((c) => c.deviceId === $selectedCameraId)) {
      selectedCameraId.set(null);
    }
  });

  const currentId = $derived($selectedCameraId ?? cameras[0]?.deviceId ?? '');
  const currentLabel = $derived(
    cameras.find((c) => c.deviceId === currentId)?.label ||
      (currentId ? `Kamera ${currentId.slice(0, 8)}` : 'Kamera')
  );

  async function pick(id: string) {
    if (!id || id === currentId) return;
    await switchCamera(id);
  }
</script>

{#if !loading && cameras.length > 1}
  <div class="camera-select">
    <Dropdown placement="bottom-end" minWidth="220px">
      {#snippet trigger()}
        <button type="button" class="cam-trigger" title="Kamera wählen" aria-label="Kamera wählen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span class="cam-label">{currentLabel}</span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
      {/snippet}
      {#snippet children()}
        {#each cameras as cam (cam.deviceId)}
          <DropdownItem
            selected={cam.deviceId === currentId}
            onselected={() => pick(cam.deviceId)}
          >
            {cam.label || `Kamera ${cam.deviceId.slice(0, 8)}`}
          </DropdownItem>
        {/each}
      {/snippet}
    </Dropdown>
  </div>
{/if}

<style lang="scss">
  .camera-select {
    display: flex;
    justify-content: flex-end;
  }
  .cam-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid rgb(var(--md-outline));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    max-width: 260px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    &:hover {
      background: rgba(var(--md-primary), 0.08);
      border-color: rgb(var(--md-primary));
    }
    .cam-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .caret {
      font-size: 10px;
      opacity: 0.7;
    }
  }
</style>
