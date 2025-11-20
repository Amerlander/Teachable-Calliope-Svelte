<script lang="ts">
    import { m } from "$lib/paraglide/messages";
    import type { Program } from '$lib/types/programTypes';
    import Dropdown from '$lib/components/ui/Dropdown.svelte';

    interface Extension {
        id: string;
        name: string;
        version?: string;
        isRemovable?: boolean;
    }
    let {
        currentProgram,
        onExtensionRemoved = (extensionId: string) => {},
        onVersionChanged = (version: number) => {},
        onDropdownOpen = () => {},
        closeAllDropdowns = $bindable()
    } = $props<{
        currentProgram: Program | null;
        onExtensionRemoved?: (extensionId: string) => void;
        onVersionChanged?: (version: number) => void;
        onDropdownOpen?: () => void;
        closeAllDropdowns?: () => void;
    }>();
    let extensions = $state<Extension[]>([]);
    let isManagerOpen = $state(false);
    let currentCalliopeVersion = $state<number | null>(null);
    let isVersionDropdownOpen = $state(false);// Function to parse extensions from pxt.json
    function parseExtensions(): Extension[] {
        if (!currentProgram?.content?.files?.['pxt.json']) {
            return [];
        }

        try {
            const pxtJsonContent = currentProgram.content.files['pxt.json'];
            const pxtJson = JSON.parse(pxtJsonContent);
            const deps = pxtJson.dependencies || {};
            
            // Parse current Calliope version
            if (deps.v1 === '*') currentCalliopeVersion = 1;
            else if (deps.v2 === '*') currentCalliopeVersion = 2;
            else if (deps.v3 === '*') currentCalliopeVersion = 3;
            else currentCalliopeVersion = null;
            
            const extensionList = Object.entries(deps)
                .filter(([key]) => !['core', 'v1', 'v2', 'v3'].includes(key))
                .map(([id, version]) => ({
                    id,
                    name: id,
                    version: version as string,
                    isRemovable: true
                }));
            
            return extensionList;
        } catch (error) {
            console.error('Failed to parse pxt.json:', error);
            return [];
        }
    }

    // Function to format extension version for display
    function formatExtensionVersion(version: string): string {
        if (version === '*' || version === 'latest') {
            return 'latest';
        }
        return version;
    }    // Function to change Calliope version
    function changeCalliopeVersion(version: number) {
        onVersionChanged(version);
        isVersionDropdownOpen = false;
    }

    // Function to remove an extension
    function removeExtension(extensionId: string) {
        onExtensionRemoved(extensionId);
    }

    // Function to close all dropdowns (called from parent)
    function closeAllDropdownsInternal() {
        isManagerOpen = false;
        isVersionDropdownOpen = false;
    }

    // Expose the function through bindable prop
    closeAllDropdowns = closeAllDropdownsInternal;

    // Update extensions when currentProgram changes
    $effect(() => {
        if (currentProgram) {
            extensions = parseExtensions();
        }
    });
</script>

<div class="extension-manager-container">
    <Dropdown bind:isOpen={isManagerOpen} useFloating={false} usePortal={false} position="right" minWidth="280px">
        {#snippet trigger()}
            <button class="extension-manager-button" onclick={() => onDropdownOpen()}>
                <span class="extension-text">
                    Calliope mini {currentCalliopeVersion || '?'}
                </span>
                {#if extensions.length > 0}
                    <span class="extension-count">{extensions.length}</span>
                {/if}
                <span class="dropdown-arrow">{isManagerOpen ? '▲' : '▼'}</span>
            </button>
        {/snippet}
        
        {#snippet children()}
            <div class="extension-panel-content">
                <!-- Calliope Version -->
                <div class="version-section">
                    <span class="version-label">Calliope mini:</span>
                    <Dropdown bind:isOpen={isVersionDropdownOpen} useFloating={false} position="right" minWidth="60px">
                        {#snippet trigger()}
                            <button class="version-button">
                                {currentCalliopeVersion || '?'}
                                <span class="dropdown-arrow">{isVersionDropdownOpen ? '▲' : '▼'}</span>
                            </button>
                        {/snippet}
                        
                        {#snippet children()}
                            {#each [1, 2, 3] as version}
                                <button 
                                    class="version-item"
                                    class:active={currentCalliopeVersion === version}
                                    onclick={() => changeCalliopeVersion(version)}
                                >
                                    {version}
                                </button>
                            {/each}
                        {/snippet}
                    </Dropdown>
                </div>
                
                <!-- Extensions List -->
                {#if extensions.length === 0}
                    <div class="empty-state">No extensions</div>
                {:else}
                    <div class="extensions-list">
                        {#each extensions as extension (extension.id)}
                            <div class="extension-item">
                                <div class="extension-info">
                                    <span class="extension-name">{extension.name}</span>
                                    <span class="extension-version">{formatExtensionVersion(extension.version || '')}</span>
                                </div>
                                <button 
                                    class="remove-button" 
                                    onclick={() => removeExtension(extension.id)}
                                    title="Remove"
                                >
                                    ×
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/snippet}
    </Dropdown>
</div>

<style>
    .extension-manager-container {
        position: relative;
    }
    
    .extension-manager-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.875rem;
        color: #333;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        transition: all 0.2s ease;
        width: 100%;
    }
    
    .extension-manager-button:hover {
        background: white;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    }
    
    .extension-count {
        background: #2196f3;
        color: white;
        border-radius: 10px;
        padding: 0.2rem 0.4rem;
        font-size: 0.75rem;
        min-width: 1.2rem;
        text-align: center;
    }
      .dropdown-arrow {
        font-size: 0.75rem;
        color: #666;
    }
    
    .version-section {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        border-bottom: 1px solid #f0f0f0;
        background: #f8f9fa;
    }
    
    .version-label {
        font-size: 0.875rem;
        color: #333;
    }
    
    .version-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
        width: 100%;
    }
    
    .version-item {
        display: block;
        width: 100%;
        padding: 0.5rem;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.875rem;
        text-align: center;
    }
    
    .version-item:hover {
        background: #f5f5f5;
    }
    
    .version-item.active {
        background: #e3f2fd;
        color: #1976d2;
    }
    
    .empty-state {
        padding: 1rem;
        text-align: center;
        color: #666;
        font-size: 0.875rem;
    }
    
    .extensions-list {
        max-height: 200px;
        overflow-y: auto;
    }
    
    .extension-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid #f0f0f0;
    }
    
    .extension-item:hover {
        background: #f8f9fa;
    }
    
    .extension-item:last-child {
        border-bottom: none;
    }
    
    .extension-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    
    .extension-name {
        font-size: 0.875rem;
        color: #333;
    }
    
    .extension-version {
        font-size: 0.75rem;
        color: #666;
    }
    
    .remove-button {
        background: #ff5252;
        color: white;
        border: none;
        border-radius: 3px;
        width: 20px;
        height: 20px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
    }
    
    .remove-button:hover {
        background: #d32f2f;
    }
</style>
