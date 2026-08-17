<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import ProjectWorkspace from '$lib/components/training/ProjectWorkspace.svelte';
  import VideoPanel from '$lib/components/training/VideoPanel.svelte';
  import { currentProject } from '$lib/stores/projects';
  import { classifierModel, trainingReadiness } from '$lib/stores';
  import { modelTabView, workspaceTab } from '$lib/stores/app';

  // The models sidebar has nothing to offer until the recorded classes could
  // actually produce a model, so it stays out of the layout entirely and the
  // camera panel gets the full width for recording. Once models exist it stays
  // put regardless — clearing a class must not take away the only access to
  // exporting or deleting a model that is already trained.
  const hasModels = $derived(
    !!$classifierModel || ($currentProject?.modelHistory?.length ?? 0) > 0
  );
  const showSidebar = $derived($trainingReadiness.ready || hasModels);

  // Project restoration runs in the root layout before children mount, so
  // here we just redirect to the start screen if no project ended up loaded.
  onMount(() => {
    if (!get(currentProject)) goto('/');
    // Only the models view exists now; a stale 'classes' value from an older
    // build would put the camera panel into the retired capture view.
    workspaceTab.set('model');
  });

  // While the sidebar is gone, the camera panel has to stay on the prep view —
  // that is where classes and images are recorded. A persisted 'model' view
  // would otherwise strand a fresh project on the test view with no way back.
  $effect(() => {
    if (!showSidebar) modelTabView.set('new');
  });
</script>

<div class="view training-view">
  {#if $currentProject}
    <!-- The camera pane lives outside the {#if} so revealing the sidebar never
         remounts it — that would restart the camera mid-recording, which is
         exactly the moment the gate flips. -->
    <Splitpanes theme="modern-theme">
      {#if showSidebar}
        <Pane size={30} minSize={20} maxSize={60}>
          <div class="pane-fill" in:fade={{ duration: 180 }}>
            <ProjectWorkspace />
          </div>
        </Pane>
      {/if}
      <Pane>
        <VideoPanel />
      </Pane>
    </Splitpanes>
  {/if}
</div>

<style lang="scss">
  .training-view {
    display: block;
    padding: 16px;
  }

  // Transition wrapper inside the pane — has to carry the pane's own flex
  // layout so the sidebar keeps filling its column.
  .pane-fill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :global(.splitpanes.modern-theme) {
    background: transparent;
  }
  :global(.splitpanes.modern-theme .splitpanes__pane) {
    background: transparent;
    padding: 0 8px;
    &:first-child { padding-left: 0; }
    &:last-child  { padding-right: 0; }
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  :global(.splitpanes.modern-theme .splitpanes__splitter) {
    background: transparent;
    position: relative;
    width: 6px;
    margin: 0 -3px;
    z-index: 2;
    cursor: col-resize;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      margin: auto 2px;
      width: 2px;
      background: rgba(var(--md-outline-variant), 0.7);
      border-radius: 2px;
      transition: background 0.15s;
    }
    &:hover::before {
      background: rgb(var(--md-primary));
    }
  }
</style>
