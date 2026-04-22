<script lang="ts">
  import { onMount } from 'svelte';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import ProjectWorkspace from '$lib/components/training/ProjectWorkspace.svelte';
  import VideoPanel from '$lib/components/training/VideoPanel.svelte';
  import ProjectStartScreen from '$lib/components/training/ProjectStartScreen.svelte';
  import {
    currentProject,
    getLastProjectId,
    loadProject,
    refreshProjectList
  } from '$lib/stores/projects';
  import { loadClassifierFromArtifacts } from '$lib/machine';

  onMount(async () => {
    await refreshProjectList();
    const lastId = getLastProjectId();
    if (lastId) {
      const p = await loadProject(lastId);
      if (p?.modelArtifacts) {
        try {
          await loadClassifierFromArtifacts(p.modelArtifacts);
        } catch {
          /* ignore */
        }
      }
    }
  });
</script>

<div class="view training-view">
  {#if $currentProject}
    <Splitpanes theme="modern-theme">
      <Pane size={30} minSize={20} maxSize={60}>
        <ProjectWorkspace />
      </Pane>
      <Pane size={70}>
        <VideoPanel />
      </Pane>
    </Splitpanes>
  {:else}
    <ProjectStartScreen />
  {/if}
</div>

<style lang="scss">
  .training-view {
    display: block;
    padding: 16px;
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
