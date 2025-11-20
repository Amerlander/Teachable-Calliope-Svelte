<script lang="ts">
      // Refference for iFrame controller: https://github.com/microsoft/pxt/blob/95f7f2c338833ea21c0a7e780d6fd1c2aeaa4633/webapp/public/controller.html
    import { m } from "$lib/paraglide/messages";
    import { onMount } from 'svelte';
    import { getLocale } from '$lib/paraglide/runtime';
    import { useEventListener } from 'runed';
    import MakeCodeToolbar from './MakeCodeToolbar.svelte';

    let {
        onContentChange = (content: any) => {},
        onHardwareVersionChange = (version: string) => {},
        initCode = null as any, // Assuming initCode can be any project structure
        readonly = false,
        defaultVersion = 3,
        programName = undefined as string | undefined,
        initialMode = 'blocks' as 'blocks' | 'javascript' | 'python'
    } = $props<{
        onContentChange?: (content: any) => void;
        onHardwareVersionChange?: (version: string) => void;
        initCode?: any;
        readonly?: boolean;
        defaultVersion?: number;
        programName?: string;
        initialMode?: 'blocks' | 'javascript' | 'python';
    }>();    let iframe: HTMLIFrameElement;
    let isInitialized = $state(false);
    let currentCode = $state(initCode);
    let hardwareVersion = $state<number | null>(null);
      // Generate unique instance ID to avoid message conflicts between multiple editors
    // Use a stable ID that persists across re-renders but is unique per component instance
    const instanceId = Math.random().toString(36).substr(2, 9);

    let currentMode = $state<'blocks' | 'javascript' | 'python'>(
        initCode?.editorMode || initialMode || 'blocks'
    );
    
    // Extensions state
    let extensions = $state<Array<{id: string, name: string, version?: string}>>([]);
      // Effect to handle initCode changes, especially in readonly mode
    $effect(() => {
        if (readonly && isInitialized && iframe?.contentWindow && initCode) {
            console.log(`[MakeCode-${instanceId}] Readonly mode: Loading new initCode`, initCode);
            currentCode = initCode; // Update internal currentCode state

            // Work with a representation of initCode for this effect's logic
            let codeForEditor = JSON.parse(JSON.stringify(initCode));
            
            // Inject program name if provided
            if (programName) {
                codeForEditor = injectProgramName(codeForEditor, programName);
            }
            
            let hwVersion = getHardwareVersion(codeForEditor);

            if (hwVersion === null) {
                // changeHardwareVersion mutates codeForEditor, updates $state hardwareVersion, and calls onHardwareVersionChange
                codeForEditor = changeHardwareVersion(defaultVersion, codeForEditor);
            } else {                // Version found in codeForEditor, ensure $state hardwareVersion and parent are updated
                if (hardwareVersion !== hwVersion) {
                    hardwareVersion = hwVersion;
                    onHardwareVersionChange(hwVersion.toString());
                }
            }
            // Send the (potentially version-adjusted) code to the editor
            sendMessageToIframe('importproject', codeForEditor);
        }
    });// Function to handle extension removal
    function handleExtensionRemoval(extensionId: string) {
        if (!currentCode) {
            return;
        }
        
        console.log(`[MakeCode-${instanceId}] Removing extension:`, extensionId);
        
        // Use the same approach as changeHardwareVersion
        currentCode = removeExtensionFromCode(extensionId, currentCode);
        
        // Force reload the project in the editor using multiple approaches
        if (isInitialized && iframe?.contentWindow) {
            
            // Create a fresh copy for import
            const projectForImport = JSON.parse(JSON.stringify(currentCode));
            
            // Approach 1: Try import project message
            const importMsg = {
                type: "pxteditor",
                id: Math.random().toString(),
                action: "importproject",
                project: projectForImport,
                response: true
            };
            iframe.contentWindow.postMessage(importMsg, "*");
            
            // Approach 2: Try workspace sync message (backup)
            // setTimeout(() => {
            //     if (iframe?.contentWindow) {
            //         const syncMsg = {
            //             id: Math.random().toString(),
            //             type: "pxthost",
            //             action: "workspacesync", 
            //             response: true,
            //             projects: [projectForImport]
            //         };
            //         iframe.contentWindow.postMessage(syncMsg, "*");
            //     }
            // }, 200);
            
            // Approach 3: Force refresh by reloading the iframe if other approaches fail
            // setTimeout(() => {
            //     console.log("MakeCode: Final approach - forcing iframe reload");
            //     const currentSrc = iframe.src;
            //     iframe.src = 'about:blank';
            //     setTimeout(() => {
            //         iframe.src = currentSrc;
            //         // Reset initialization flag so it will sync again
            //         isInitialized = false;
            //     }, 100);
            // }, 1000);
        } else {
            console.warn("MakeCode: Cannot send to iframe - isInitialized:", isInitialized, "iframe:", !!iframe?.contentWindow);
        }
          // Notify parent of changes
        onContentChange(currentCode);
    }



    // Function to remove an extension from a code object (similar to changeHardwareVersion)
    function removeExtensionFromCode(extensionId: string, code: any): any {
        
        if (!code || !code.text || !code.text['pxt.json']) {
            console.error("Cannot remove extension: pxt.json not found in code object.");
            return code;
        }

        try {
            const pxtJson = JSON.parse(code.text['pxt.json']);
            
            if (pxtJson.dependencies && pxtJson.dependencies[extensionId]) {
                // Remove the extension from dependencies
                delete pxtJson.dependencies[extensionId];
                
                // Update the pxt.json in the code object
                code.text['pxt.json'] = JSON.stringify(pxtJson, null, 2);
            } else {
                console.warn(`MakeCode: Extension ${extensionId} not found in dependencies`);
            }
        } catch (e) {
            console.error("Error removing extension:", e);
        }
          return code;
    }

    // Function to handle Calliope version changes
    function handleVersionChange(version: number) {
        if (!currentCode) {
            console.error("No currentCode available for version change");
            return;
        }
        
        console.log("MakeCode: Changing Calliope version to:", version);
        
        // Use the same approach as changeHardwareVersion
        currentCode = changeHardwareVersion(version, currentCode);
        
        // Force reload the project in the editor using multiple approaches
        if (isInitialized && iframe?.contentWindow) {
            console.log("MakeCode: Forcing project reload after version change");
            
            // Create a fresh copy for import
            const projectForImport = JSON.parse(JSON.stringify(currentCode));
            
            // Approach 1: Try import project message
            const importMsg = {
                type: "pxteditor",
                id: Math.random().toString(),
                action: "importproject",
                project: projectForImport,
                response: true
            };
            iframe.contentWindow.postMessage(importMsg, "*");
            
            // // Approach 2: Try workspace sync message (backup)
            // setTimeout(() => {
            //     if (iframe?.contentWindow) {
            //         console.log("MakeCode: Also triggering workspace sync as backup");
            //         const syncMsg = {
            //             id: Math.random().toString(),
            //             type: "pxthost",
            //             action: "workspacesync", 
            //             response: true,
            //             projects: [projectForImport]
            //         };
            //         iframe.contentWindow.postMessage(syncMsg, "*");
            //     }
            // }, 200);
            
            // // Approach 3: Force refresh by reloading the iframe if other approaches fail
            // setTimeout(() => {
            //     console.log("MakeCode: Final approach - forcing iframe reload");
            //     const currentSrc = iframe.src;
            //     iframe.src = 'about:blank';
            //     setTimeout(() => {
            //         iframe.src = currentSrc;
            //         // Reset initialization flag so it will sync again
            //         isInitialized = false;
            //     }, 100);
            // }, 1000);
        } else {
            console.warn("MakeCode: Cannot send to iframe - isInitialized:", isInitialized, "iframe:", !!iframe?.contentWindow);
        }        // Notify parent of changes
        onContentChange(currentCode);
    }    $effect(() => {
        if (initCode && !readonly) {
            console.log(`[MakeCode-${instanceId}] Non-readonly mode: Processing initCode`, initCode);
            currentCode = initCode;
            // Update mode from initCode if available
            if (initCode.editorMode) {
                currentMode = initCode.editorMode;
            }
            // Optionally, also update hardware version from initCode here if needed outside of readonly/workspacesync
            // For now, relying on workspacesync for initial setup as per original logic
        }
    });// Effect to update extensions when currentCode changes
    $effect(() => {
        if (currentCode) {
            extensions = parseExtensions();
        }
    });

    // Effect to update currentMode when initCode changes
    $effect(() => {
        if (initCode?.editorMode && initCode.editorMode !== currentMode) {
            currentMode = initCode.editorMode;
        }
    });

    // Effect to switch mode when editor is initialized and when mode changes
    $effect(() => {
        if (isInitialized && currentMode) {
            // Wait a bit for the editor to be fully loaded before switching mode
            setTimeout(() => {
                switchModeDirectly(currentMode);
            }, 500);
        }
    });


    // Function to parse extensions from pxt.json
    function parseExtensions(): Array<{id: string, name: string, version?: string}> {
        if (!currentCode?.text?.['pxt.json']) {
            return [];
        }

        try {
            const pxtJsonContent = currentCode.text['pxt.json'];
            const pxtJson = JSON.parse(pxtJsonContent);
            const deps = pxtJson.dependencies || {};
            
            const extensionList = Object.entries(deps)
                .filter(([key]) => !['core', 'v1', 'v2', 'v3'].includes(key))
                .map(([id, version]) => ({
                    id,
                    name: id,
                    version: version as string
                }));
            
            return extensionList;
        } catch (error) {
            console.error('Failed to parse pxt.json:', error);
            return [];
        }
    }

    // Function to parse and determine the hardware version
    function getHardwareVersion(code: any): number | null {
        if (!code || !code.text || !code.text['pxt.json']) {
            return null;
        }
        try {
            const pxtJson = JSON.parse(code.text['pxt.json']);
            if (pxtJson.dependencies.v1 === '*') return 1;
            if (pxtJson.dependencies.v2 === '*') return 2;
            if (pxtJson.dependencies.v3 === '*') return 3;
            return null;
        } catch (e) {
            console.error("Error parsing pxt.json:", e);
            return null;
        }
    }

    // Function to change the hardware version in a code object
    function changeHardwareVersion(version: number, code: any): any {
        console.log("Changing hardware version to:", version);
        if (![1, 2, 3].includes(version)) {
            console.error("Invalid hardware version. Must be 1, 2, or 3.");
            return code;
        }
        if (!code || !code.text || !code.text['pxt.json']) {
            console.error("Cannot change hardware version: pxt.json not found in code object.");
            return code;
        }

        try {
            const pxtJson = JSON.parse(code.text['pxt.json']);
            delete pxtJson.dependencies.v1;
            delete pxtJson.dependencies.v2;
            delete pxtJson.dependencies.v3;

            pxtJson.dependencies[`v${version}`] = "*"; // Ensure key is "v1", "v2", "v3"
            code.text['pxt.json'] = JSON.stringify(pxtJson, null, 2);
              if (hardwareVersion !== version) {
                hardwareVersion = version; // Update $state
            }
            onHardwareVersionChange(version.toString()); // Notify parent
            console.log(`Hardware version changed to ${version}`);
        } catch (e) {
            console.error("Error updating hardware version:", e);
        }
        return code;
    }    // Function to send messages to the iframe (for general actions like 'importproject')
    function sendMessageToIframe(action: string, data: any = null) {
        if (iframe?.contentWindow) {
            console.log(`[MakeCode-${instanceId}] Sending message:`, action, data);
            const msg: any = {
                type: "pxteditor",
                id: Math.random().toString(),
                action: action,
                response: true // Assuming most actions expect a response configuration
            };

            if (data) {
                if (action === 'importproject') {
                    msg.project = data;
                } else if (action === 'workspacesync') {
                    // This case should be handled by a specific message structure, see receiveMessage
                    // For safety, log if used incorrectly
                    console.warn("sendMessageToIframe used for workspacesync, prefer specific handling.");
                    msg.projects = data; // Assuming data is an array of projects
                } else {
                    // Generic data attachment, might need adjustment based on action
                    msg.data = data;
                }
            }
            iframe.contentWindow.postMessage(msg, "*");
        } else {
            console.warn(`[MakeCode-${instanceId}] Cannot send message - iframe not ready`);
        }
    }// Function to handle messages from the iframe
    function receiveMessage(ev: MessageEvent) {
        const msg = ev.data;
        
        // Only process messages from our specific iframe
        if (!iframe?.contentWindow || ev.source !== iframe.contentWindow) {
            return;
        }

        if (msg && msg.type === "pxthost") {
            if (msg.action === "workspacesync" && !isInitialized) {
                console.log(`[MakeCode-${instanceId}] Initializing workspace with initCode:`, initCode);

                let codeToSync = JSON.parse(JSON.stringify(initCode || { files: { "pxt.json": "{}" } })); // Ensure there's a base to modify
                
                // Add current mode to the code structure
                codeToSync.editorMode = currentMode;
                
                // Inject program name if provided
                if (programName) {
                    codeToSync = injectProgramName(codeToSync, programName);
                }
                
                let hwVersion = getHardwareVersion(codeToSync);

                if (hwVersion === null) {                // changeHardwareVersion mutates codeToSync, updates $state hardwareVersion, and calls onHardwareVersionChange
                codeToSync = changeHardwareVersion(defaultVersion, codeToSync);
                } else {
                    if (hardwareVersion !== hwVersion) {
                        hardwareVersion = hwVersion; // Update $state
                    }
                    onHardwareVersionChange(hwVersion.toString()); // Notify parent
                }

                const syncResponseMsg = {
                    id: msg.id,
                    type: "pxthost", // Important: type is pxthost for the response
                    action: "workspacesync",
                    response: true,
                    projects: [codeToSync] // Important: key is 'projects' and it's an array
                };

                if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage(syncResponseMsg, "*");
                }
                isInitialized = true;
                console.log(`[MakeCode-${instanceId}] Workspace initialized successfully`);
            } else if (msg.action === "workspacesave" && isInitialized) {
                console.log(`[MakeCode-${instanceId}] Saving workspace...`, msg.project);
                currentCode = msg.project;
                
                // Add current mode to the code structure
                currentCode.editorMode = currentMode;
                
                let hwVersion = getHardwareVersion(currentCode);
                if (hwVersion === null) {
                    // changeHardwareVersion mutates currentCode, updates $state hardwareVersion, and calls onHardwareVersionChange
                    currentCode = changeHardwareVersion(defaultVersion, currentCode);                } else {
                    if (hardwareVersion !== hwVersion) {
                        hardwareVersion = hwVersion; // Update $state
                    }
                    onHardwareVersionChange(hwVersion.toString()); // Notify parent
                }
                onContentChange(currentCode);
            }
        }
    }    // Setup event listener with proper cleanup
    useEventListener(
        () => window,
        'message',
        receiveMessage
    );// Function to inject program name into code structure
    function injectProgramName(code: any, name: string): any {
        if (!code || !name) return code;

        try {
            const updatedCode = JSON.parse(JSON.stringify(code));
            
            // Ensure we have a text property and pxt.json
            if (!updatedCode.text) {
                updatedCode.text = {};
            }
            
            if (!updatedCode.text['pxt.json']) {
                updatedCode.text['pxt.json'] = JSON.stringify({ name }, null, 4);
            } else {
                const pxtJson = JSON.parse(updatedCode.text['pxt.json']);
                pxtJson.name = name;
                updatedCode.text['pxt.json'] = JSON.stringify(pxtJson, null, 4);
            }
            
            // Update the header name if it exists
            if (updatedCode.header) {
                updatedCode.header.name = name;
            }
            
            return updatedCode;
        } catch (error) {
            console.error("Error injecting program name:", error);
            return code;
        }
    }
    // Function to switch between programming modes
    function switchMode(mode: 'blocks' | 'javascript' | 'python') {
        switchModeDirectly(mode);
        currentMode = mode;
        
        // Update the code structure and notify parent
        if (currentCode) {
            currentCode.editorMode = mode;
            onContentChange(currentCode);
        }
    }

    // Function to switch mode without updating state (for initialization)
    function switchModeDirectly(mode: 'blocks' | 'javascript' | 'python') {
        if (!iframe?.contentWindow) return;
        
        let action: string;
        switch (mode) {
            case 'blocks':
                action = 'switchblocks';
                break;
            case 'javascript':
                action = 'switchjavascript';
                break;
            case 'python':
                action = 'switchpython';
                break;
            default:
                return;
        }
        
        const msg = {
            type: "pxteditor",
            id: Math.random().toString(),
            action: action
        };
          iframe.contentWindow.postMessage(msg, "*");
    }

</script>

<!-- <div class="url-import-container">
    <div class="input-group">
        <input
            type="text"
            bind:value={importUrl}
            placeholder="Enter project or tutorial URL"
            class="url-input"
            disabled={isImportingUrl}
        />
        <button
            onclick={importByUrl}
            disabled={isImportingUrl || !importUrl}
            class="import-url-button"
        >
            {isImportingUrl ? 'Importing...' : 'Import by URL'}
        </button>
    </div>
    {#if importError}
        <p class="error">{importError}</p>
    {/if}
</div> -->

<div class="makecode-container">
    <iframe
        bind:this={iframe}
        title="MakeCode editor"
        src={`https://makecode.calliope.cc/?hidemenu=1&controller=1&lang=${getLocale()}#editor`}
        allow="usb; bluetooth; autoplay; "
        style="width: 100%; height: 100%; border: none;"
    ></iframe>
    
    <!-- MakeCode Floating Toolbar - positioned absolutely in top right -->
    <div class="floating-toolbar-container">
        <MakeCodeToolbar
            currentMode={currentMode}
            currentVersion={hardwareVersion || defaultVersion}
            extensions={extensions}
            onModeChange={switchMode}
            onVersionChange={handleVersionChange}
            onExtensionRemoved={handleExtensionRemoval}
            programName={programName}
        />
    </div>
</div>

<style>
    .makecode-container {
        position: relative;
        width: 100%;
        height: 100%;
    }
      .floating-toolbar-container {
        position: absolute;
        top: 0px;
        right: 60px;
        /* transform: translateX(-50%); */
        z-index: 1;
        pointer-events: none; /* Allow clicks to pass through the container */
    }
    
    .floating-toolbar-container :global(.makecode-toolbar) {
        pointer-events: auto; /* But enable clicks on the toolbar itself */
    }
</style>