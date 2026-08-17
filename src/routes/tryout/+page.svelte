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
    compileMakeCodeProject,
    switchMakeCodeLang,
    setMakeCodeHardwareVersion,
    removeMakeCodeExtension,
    shareMakeCodeProject,
    makeCodeMode,
    makeCodeExtensions,
    makeCodeHardwareVersion,
    type MakeCodeMode,
    type ShareResult,
  } from '$lib/makecode';
  import {
    MakeCodeToolbar,
    MakeCodeShareModal,
    type MakeCodeLabels,
  } from '@calliope-edu/mini-connection-widget/makecode';
  import {
    ConnectButton,
    flashCalliope,
    setConnectionUiActive,
    setTransferProgram,
  } from '@calliope-edu/mini-connection-widget';
  import { currentLang } from '$lib/stores/app';
  import { currentProject, getCurrentMakeCodeProgram } from '$lib/stores/projects';
  import { activeModel, availableModels } from '$lib/stores/projects';
  import { createProgramForModel, loadProgramModel } from '$lib/programs';
  import { ensureActiveModelLoaded } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import TryoutCamera from '$lib/components/tryout/TryoutCamera.svelte';
  import TryoutDetailPanel from '$lib/components/tryout/TryoutDetailPanel.svelte';
  import ProgramList from '$lib/components/tryout/ProgramList.svelte';

  let iframeEl: HTMLIFrameElement | undefined = $state();
  // Read once: the MakeCode iframe cannot change its language without a reload,
  // so the URL is pinned to whatever locale was active when the page mounted.
  const src = createMakeCodeIframeUrl(get(currentLang));

  // The shared toolbar and share modal carry their own German defaults; passing
  // the strings from here puts them in this app's catalog so they follow the
  // language switcher instead of the widget's.
  const makeCodeLabels = $derived<Partial<MakeCodeLabels>>({
    programmingMode: 'Programmiermodus',
    modeBlocks: 'Blöcke',
    share: 'Teilen',
    shareProgram: 'Programm teilen',
    sharingInProgress: 'Wird geteilt…',
    extensions: 'Erweiterungen',
    extensionsCount: (count: number) => `${count} ${count === 1 ? 'Erweiterung' : 'Erweiterungen'}`,
    noExtensionsAdded: 'Keine Erweiterungen hinzugefügt',
    openOnGithub: 'Auf GitHub öffnen',
    removeExtension: 'Erweiterung entfernen',
    calliopeMiniVersion: 'Calliope mini Version',
    shareModalTitle: 'Programm teilen',
    shareCreatingLink: 'Link wird erstellt…',
    shareIntroBefore: 'Jeder mit diesem Link kann ',
    // The sentence is split around a link, so these two fragments start
    // lowercase — which the default heuristic reads as "not user-facing" and
    // skips. Forced in, otherwise they stay German in every other locale.
    shareIntroAfter: /* @wc-include */ ' öffnen und kopieren.',
    shareThisProgram: /* @wc-include */ 'dieses Programm',
    shareLinkAria: 'Link zum Programm',
    shareCopyLink: 'Link kopieren',
    shareLinkCopied: 'Link kopiert',
    shareCopyFailed: 'Kopieren fehlgeschlagen',
    shareQrAlt: 'QR-Code zum Programm',
    shareClose: 'Schließen',
    shareOpen: 'Öffnen',
  });

  function pickEditorLang(mode: MakeCodeMode) {
    void switchMakeCodeLang(mode);
  }

  // ---- Share ----
  // The editor runs with hidemenu=1, so pxt's own share entry is hidden and the
  // toolbar button is the only way to publish a program.
  let shareOpen = $state(false);
  let shareLoading = $state(false);
  let shareError = $state<string | null>(null);
  let shareResult = $state<ShareResult | null>(null);

  async function handleShare() {
    if (shareLoading) return;
    shareOpen = true;
    shareResult = null;
    shareError = null;
    shareLoading = true;
    try {
      shareResult = await shareMakeCodeProject(
        getCurrentMakeCodeProgram()?.name || $currentProject?.name || 'Calliope mini Programm',
      );
    } catch (err) {
      console.warn('[tryout] shareProject failed', err);
      shareError = 'Der Link konnte nicht erstellt werden. Versuche es später erneut.';
    } finally {
      shareLoading = false;
    }
  }

  onMount(() => {
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    setMakecodeIframe(iframeEl ?? null);

    // Decide what to open in MakeCode:
    //   1. The project's active saved program → reload it, together with the
    //      model it is programmed against, so the prediction that reaches the
    //      board comes from that program's model.
    //   2. No program yet but a model to program against → generate a starter
    //      for it, which becomes program 1 and is persisted from then on.
    //   3. No model at all → nothing to generate blocks from; the program list
    //      shows the way to train or import one.
    const active = getCurrentMakeCodeProgram();
    if (active) {
      importProgramFiles(active.files, active.header);
      void loadProgramModel(active).then((m) => {
        if (!m) void ensureActiveModelLoaded();
      });
    } else {
      const model = get(activeModel) ?? get(availableModels).at(-1) ?? null;
      if (model) {
        createProgramForModel(model);
        void ensureActiveModelLoaded();
      }
    }

    const unsubDownload = onMakeCodeDownload(({ name, hex }) => {
      void flashCalliope(hex, name || p.name || 'project');
    });

    // This is the one view where a board is the point, so let the widget's
    // banner prompt for a connection here (it stays quiet elsewhere) and wire
    // the connection panel's transfer button to a MakeCode compile — the hex
    // comes back through the download handler above.
    setConnectionUiActive(true);
    setTransferProgram('teachable-tryout', { run: () => compileMakeCodeProject() });

    return () => {
      unsubDownload();
      setTransferProgram('teachable-tryout', null);
      setConnectionUiActive(false);
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
          <MakeCodeToolbar
            currentMode={$makeCodeMode}
            currentVersion={$makeCodeHardwareVersion ?? 3}
            extensions={$makeCodeExtensions}
            sharing={shareLoading}
            labels={makeCodeLabels}
            onModeChange={pickEditorLang}
            onVersionChange={setMakeCodeHardwareVersion}
            onExtensionRemoved={removeMakeCodeExtension}
            onShare={handleShare}
          >
            {#snippet barRightExtra()}
              <ConnectButton appearance="icon" />
            {/snippet}
          </MakeCodeToolbar>
          <!-- No `sandbox` here (campus runs the editor the same way): the
               attribute this frame used to carry omitted `allow-downloads`, which
               is exactly what the "Als Datei herunterladen" path needs, and with
               allow-scripts + allow-same-origin it bought no real isolation from
               a first-party Calliope origin anyway. -->
          <iframe
            bind:this={iframeEl}
            title="MakeCode Calliope Editor"
            {src}
            allow="usb; bluetooth; autoplay;"
            style="width:100%;flex:1;border:0;"
            allowfullscreen
          ></iframe>
        </div>
      </Pane>
    </Splitpanes>
  {/if}
</div>

<MakeCodeShareModal
  open={shareOpen}
  loading={shareLoading}
  error={shareError}
  result={shareResult}
  programName={getCurrentMakeCodeProgram()?.name ?? ''}
  labels={makeCodeLabels}
  onClose={() => (shareOpen = false)}
  onCopied={(msg) => showNotification(msg, { type: 'success' })}
  onCopyFailed={(msg) => showNotification(msg, { type: 'error' })}
/>

<style lang="scss">
  // No padding and no panel frames: the panes reach the window edges and the
  // black splitter bar separates them. See src/lib/styles/splitpanes.scss.
  .tryout-view {
    width: 100%;
    height: 100%;
    padding: 0;
    display: block;
  }
  // Both resets undo the global .panel card look — the pane is the surface now.
  .panel {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #fff;
    border-radius: 0;
    box-shadow: none;
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

    /* The shared toolbar defaults to campus's dark bar; these map it onto the
       light surface the rest of Teachable uses. */
    --mkc-toolbar-bg: #f3f4f6;
    --mkc-toolbar-border: #e5e7eb;
    --mkc-mode-group-bg: #ffffff;
    --mkc-mode-fg: #4b5563;
    --mkc-mode-hover-bg: rgba(0, 0, 0, 0.06);
    --mkc-mode-active-bg: #111827;
    --mkc-mode-active-fg: #ffffff;
    --mkc-button-bg: #ffffff;
    --mkc-button-fg: #374151;
    --mkc-button-border: #d1d5db;
    --mkc-button-hover-bg: #f9fafb;
    --mkc-button-hover-border: #9ca3af;
  }
</style>
