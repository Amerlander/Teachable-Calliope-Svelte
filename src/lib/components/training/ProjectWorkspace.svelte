<script lang="ts">
  import ModelTab from './ModelTab.svelte';
</script>

<!-- The sidebar is the models column: classes and their images are recorded in
     the camera panel next to it, so there is nothing left to switch between. -->
<div class="workspace">
  <div class="tab-content">
    <ModelTab />
  </div>
</div>

<style lang="scss">
  .workspace {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tab-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
