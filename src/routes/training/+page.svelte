<script lang="ts">
  import TrainingPanel from '$lib/components/training/TrainingPanel.svelte';
  import VideoPanel from '$lib/components/training/VideoPanel.svelte';
</script>

<div class="view training-view">
  <TrainingPanel />
  <VideoPanel />
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
