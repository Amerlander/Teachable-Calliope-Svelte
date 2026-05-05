<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import {
    setMakecodeIframe,
    createMakeCodeIframeUrl,
    importProgramFiles,
    onMakeCodeDownload,
    generateProject,
    switchMakeCodeLang,
    type MakeCodeLang,
  } from '$lib/makecode';
  import { flashCalliope } from '$lib/stores/connection';
  import { currentLang } from '$lib/stores/app';
  import {
    currentProject,
    addMakeCodeProgram,
    getCurrentMakeCodeProgram,
  } from '$lib/stores/projects';
  import { classes } from '$lib/stores';
  import TryoutCamera from '$lib/components/tryout/TryoutCamera.svelte';
  import TryoutDetailPanel from '$lib/components/tryout/TryoutDetailPanel.svelte';
  import ProgramList from '$lib/components/tryout/ProgramList.svelte';

  let iframeEl: HTMLIFrameElement | undefined = $state();
  const src = createMakeCodeIframeUrl(get(currentLang));

  let editorLang: MakeCodeLang = $state('blocks');

  function pickEditorLang(l: MakeCodeLang) {
    editorLang = l;
    void switchMakeCodeLang(l);
  }

  onMount(() => {
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    setMakecodeIframe(iframeEl ?? null);

    // Decide what to open in MakeCode:
    //   1. If the project already has an active saved program → reload that.
    //   2. Else create one: a fresh generated starter from current classes if
    //      training has happened, or a bare empty project otherwise. Either way
    //      it becomes program 1 so future edits are persisted automatically.
    const active = getCurrentMakeCodeProgram();
    if (active) {
      importProgramFiles(active.files, active.header);
    } else {
      const cls = get(classes);
      const mcp = generateProject({
        name: p.name || 'Teachable Project',
        mode: p.mode ?? 'image',
        classes: cls ?? [],
        thresholds: p.classThresholds ?? {},
      });
      const fresh = addMakeCodeProgram({
        files: (mcp.text ?? {}) as Record<string, string>,
        header: mcp.header,
      });
      if (fresh) importProgramFiles(fresh.files, fresh.header);
    }

    const unsubDownload = onMakeCodeDownload(({ name, hex }) => {
      void flashCalliope(hex, name || p.name || 'project');
    });

    return () => {
      unsubDownload();
      setMakecodeIframe(null);
    };
  });
</script>

<div class="tryout-view">
  {#if $currentProject}
    <Splitpanes theme="modern-theme">
      <Pane size={36} minSize={24} maxSize={60}>
        <div class="panel camera-panel">
          <div class="camera-scroll">
            <ProgramList />
            <TryoutCamera />
            <TryoutDetailPanel />
          </div>
        </div>
      </Pane>
      <Pane size={64}>
        <div class="panel editor-panel">
          <div class="lang-toolbar">
            <button
              class:active={editorLang === 'blocks'}
              onclick={() => pickEditorLang('blocks')}
            >Blöcke</button>
            <button
              class:active={editorLang === 'js'}
              onclick={() => pickEditorLang('js')}
            >JavaScript</button>
            <button
              class:active={editorLang === 'python'}
              onclick={() => pickEditorLang('python')}
            >Python</button>
          </div>
          <iframe
            bind:this={iframeEl}
            title="MakeCode Calliope Editor"
            {src}
            allow="usb; bluetooth; autoplay;"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style="width:100%;flex:1;border:0;"
            allowfullscreen
          ></iframe>
        </div>
      </Pane>
    </Splitpanes>
  {/if}
</div>

<style lang="scss">
  .tryout-view {
    width: 100%;
    height: 100%;
    padding: 16px;
    display: block;
  }
  .panel {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 12px;
    background: #fff;
  }
  .camera-panel {
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .camera-scroll {
    flex: 1;
    overflow-y: auto;
  }
  .editor-panel {
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .lang-toolbar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    background: #f3f4f6;
    border-bottom: 1px solid #e5e7eb;
    flex: 0 0 auto;

    button {
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 6px;
      background: transparent;
      border: 1px solid transparent;
      color: #4b5563;
      cursor: pointer;
      min-height: unset;
      box-shadow: none;
      transition: background 0.15s, color 0.15s;

      &:hover {
        background: rgba(0, 0, 0, 0.06);
      }
      &.active {
        background: #fff;
        color: #111;
        font-weight: 600;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      }
    }
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
      background: rgba(0, 0, 0, 0.15);
      border-radius: 2px;
      transition: background 0.15s;
    }
    &:hover::before {
      background: rgba(0, 0, 0, 0.35);
    }
  }
</style>
