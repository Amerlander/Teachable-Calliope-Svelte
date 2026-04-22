<script lang="ts">
  import { onMount } from 'svelte';
  import ProjectStartScreen from '$lib/components/training/ProjectStartScreen.svelte';
  import { refreshProjectList } from '$lib/stores/projects';

  onMount(() => {
    void refreshProjectList();
  });
</script>

<div class="view overview-view">
  <ProjectStartScreen />
</div>

<style lang="scss">
  .overview-view {
    display: block;
    padding: 16px;
    min-height: 0;
  }
</style>
