<script lang="ts">
  import ClassesTab from './ClassesTab.svelte';
  import ModelTab from './ModelTab.svelte';
  import { workspaceTab } from '$lib/stores/app';
</script>

<div class="workspace">
  <div class="tabs">
    <button class="tab" class:active={$workspaceTab === 'classes'} onclick={() => workspaceTab.set('classes')}>
      Klassen
    </button>
    <button class="tab" class:active={$workspaceTab === 'model'} onclick={() => workspaceTab.set('model')}>
      Modell
    </button>
  </div>

  <div class="tab-content">
    {#if $workspaceTab === 'classes'}
      <ClassesTab ontraintab={() => workspaceTab.set('model')} />
    {:else}
      <ModelTab />
    {/if}
  </div>
</div>

<style lang="scss">
  .workspace {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    gap: 4px;
    background: rgba(var(--md-surface-variant), 0.3);
    padding: 4px;
    border-radius: var(--md-radius-md);
    margin-bottom: 12px;
  }
  .tab {
    flex: 1;
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-radius: var(--md-radius-sm);
    font-size: 14px;
    font-weight: 500;
    color: rgb(var(--md-on-surface-variant));
    cursor: pointer;
    box-shadow: none;
    min-height: unset;
    transition: all 0.2s;
    &:hover {
      background: rgba(var(--md-primary), 0.08);
    }
    &.active {
      background: rgb(var(--md-secondary-container));
      color: rgb(var(--md-on-secondary-container));
      font-weight: 600;
    }
  }
  .tab-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
