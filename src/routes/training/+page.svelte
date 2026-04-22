<script lang="ts">
  import { onMount } from 'svelte';
  import TrainingPanel from '$lib/components/training/TrainingPanel.svelte';
  import VideoPanel from '$lib/components/training/VideoPanel.svelte';
  import ProjectStartScreen from '$lib/components/training/ProjectStartScreen.svelte';
  import { currentProject, getLastProjectId, loadProject, refreshProjectList } from '$lib/stores/projects';
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
    <TrainingPanel />
    <VideoPanel />
  {:else}
    <ProjectStartScreen />
  {/if}
</div>

<style lang="scss">
  .training-view {
    display: flex;
    width: 100%;
    height: 100vh;
    padding: 16px;
    gap: 16px;
  }
</style>
