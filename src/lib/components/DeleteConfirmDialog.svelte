<script lang="ts" module>
  import type { MakeCodeProgram, ProjectSummary, TrainedModel } from '$lib/stores/projects';

  /**
   * What is about to be deleted. Every destructive action in the app names its
   * target through this union instead of calling `window.confirm`, so the
   * dialog can show the thing itself — the images of a class, the accuracy of a
   * model, the classes a program was written against — rather than a bare
   * sentence in a browser box the app has no say over.
   */
  export type DeleteTarget =
    /** One class of the open project. `clear` keeps the class and drops its images. */
    | { kind: 'class'; name: string; clear?: boolean }
    /** Every image of every class of the open project; the classes stay. */
    | { kind: 'all-classes' }
    | { kind: 'model'; model: TrainedModel }
    | { kind: 'project'; project: ProjectSummary }
    | { kind: 'program'; program: MakeCodeProgram };
</script>

<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import CampusButton from '$lib/components/ui/CampusButton.svelte';
  import { classes, examples, draftRoi } from '$lib/stores';
  import { currentProject } from '$lib/stores/projects';
  import { modelLabel } from '$lib/models';
  import { highestClassIndex } from '$lib/makecode/programFiles';
  import { roiCropStyle } from '$lib/roi';

  let {
    target = null,
    onconfirm,
    oncancel
  }: {
    /** null keeps the dialog closed; a target opens it. */
    target?: DeleteTarget | null;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  /** Thumbnails shown per class before the rest is summed up as "+n". */
  const SHOTS_SINGLE = 12;
  const SHOTS_PER_ROW = 5;

  const copy = $derived.by(() => {
    const t = target;
    if (!t) return null;
    switch (t.kind) {
      case 'class':
        return t.clear
          ? {
              title: 'Klasse leeren?',
              text: `Alle aufgenommenen Bilder von „${t.name}“ werden gelöscht. Die Klasse selbst bleibt bestehen.`,
              confirm: 'Bilder löschen'
            }
          : {
              title: 'Klasse löschen?',
              text: `Die Klasse „${t.name}“ wird mit allen aufgenommenen Bildern gelöscht.`,
              confirm: 'Klasse löschen'
            };
      case 'all-classes':
        return {
          title: 'Alle Bilder löschen?',
          text: 'Aus jeder Klasse werden alle aufgenommenen Bilder entfernt. Die Klassen selbst bleiben bestehen.',
          confirm: 'Alle Bilder löschen'
        };
      case 'model':
        return {
          title: 'Modell löschen?',
          text: 'Das trainierte Modell wird entfernt. Programme bleiben davon unberührt — sie laufen mit jedem Modell. Ist dies das geladene, wird das nächste geladen.',
          confirm: 'Modell löschen'
        };
      case 'project':
        return {
          title: 'Projekt löschen?',
          text: 'Das Projekt wird mit allen Bildern, Modellen und Programmen gelöscht.',
          confirm: 'Projekt löschen'
        };
      case 'program':
        return {
          title: 'Programm löschen?',
          text: 'Das Programm wird mit allen Blöcken gelöscht. Das Modell, für das es geschrieben wurde, bleibt erhalten.',
          confirm: 'Programm löschen'
        };
    }
  });

  function shotsOf(name: string) {
    return $examples[name] ?? [];
  }

  function countLabel(n: number): string {
    return n === 1 ? '1 Bild' : `${n} Bilder`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('de-DE');
  }

  function accuracyOf(model: TrainedModel): string | null {
    const acc = model.history?.accuracy ?? [];
    if (!acc.length) return null;
    return `${(acc[acc.length - 1] * 100).toFixed(0)} %`;
  }

  function exampleTotal(model: TrainedModel): number {
    return Object.values(model.exampleCounts ?? {}).reduce((sum, n) => sum + n, 0);
  }
</script>

{#snippet shots(name: string, limit: number)}
  {@const list = shotsOf(name)}
  {#if list.length}
    <div class="shots">
      {#each list.slice(0, limit) as shot, i (i)}
        <div class="shot">
          <img src={shot.data} alt="" style={roiCropStyle($draftRoi)} />
        </div>
      {/each}
      {#if list.length > limit}
        <span class="more">+{list.length - limit}</span>
      {/if}
    </div>
  {:else}
    <div class="empty">Noch keine Bilder aufgenommen</div>
  {/if}
{/snippet}

{#snippet chips(labels: string[])}
  <div class="chips">
    {#each labels as label (label)}
      <span class="chip">{label}</span>
    {/each}
  </div>
{/snippet}

<Modal isOpen={!!target} title={copy?.title ?? ''} size="medium" onclose={oncancel}>
  {#snippet children()}
    {#if target && copy}
      <p class="message">{copy.text}</p>

      <!-- The item itself, so what disappears is visible and not just named. -->
      <div class="preview">
        {#if target.kind === 'class'}
          <div class="head">
            <span class="name">{target.name}</span>
            <span class="meta">{countLabel(shotsOf(target.name).length)}</span>
          </div>
          {@render shots(target.name, SHOTS_SINGLE)}
        {:else if target.kind === 'all-classes'}
          {#if $classes.length}
            <ul class="class-list">
              {#each $classes as name (name)}
                <li>
                  <div class="head">
                    <span class="name">{name}</span>
                    <span class="meta">{countLabel(shotsOf(name).length)}</span>
                  </div>
                  {@render shots(name, SHOTS_PER_ROW)}
                </li>
              {/each}
            </ul>
          {:else}
            <div class="empty">Keine Klassen angelegt</div>
          {/if}
        {:else if target.kind === 'model'}
          {@const model = target.model}
          <div class="head">
            <span class="name">{modelLabel(model)}</span>
            {#if model.id === $currentProject?.currentModelId}
              <span class="chip active">aktiv</span>
            {/if}
            {#if model.source === 'imported'}<span class="chip">importiert</span>{/if}
          </div>
          <div class="meta">
            {#if accuracyOf(model)}{accuracyOf(model)} Genauigkeit ·{/if}
            {countLabel(exampleTotal(model))} · {formatDate(model.trainedAt)}
            {#if model.mode === 'pose'}· Pose{/if}
          </div>
          {@render chips(model.classes)}
        {:else if target.kind === 'project'}
          {@const project = target.project}
          {@const live = $currentProject?.id === project.id ? $currentProject : null}
          <div class="head">
            <span class="name">{project.name}</span>
            <span class="chip">{project.mode === 'pose' ? 'Pose' : 'Objekt'}</span>
            {#if project.hasModel}<span class="chip">Modell</span>{/if}
          </div>
          <div class="meta">
            {project.classCount === 1 ? '1 Klasse' : `${project.classCount} Klassen`}
            · zuletzt geändert {formatDate(project.updatedAt)}
          </div>
          <!-- Only the open project has its classes in memory; the start screen
               lists summaries, which carry the count but not the names. -->
          {#if live}
            {@render chips(live.classes)}
          {/if}
        {:else if target.kind === 'program'}
          <!-- A program is not bound to a model and its blocks address classes
               by index, so there is nothing model-shaped to preview here — only
               how far into the class list the blocks reach. -->
          {@const used = highestClassIndex(target.program.files)}
          <div class="head">
            <span class="name">{target.program.name}</span>
          </div>
          <div class="meta">
            {#if used}Blöcke für {used} Klassen ·{/if}
            zuletzt geändert {formatDate(target.program.updatedAt)}
          </div>
        {/if}
      </div>

      <p class="warning">Das lässt sich nicht rückgängig machen.</p>
    {/if}
  {/snippet}

  {#snippet actions()}
    <CampusButton variant="secondary" onclick={oncancel}>Abbrechen</CampusButton>
    <CampusButton variant="primary" type="negative" onclick={onconfirm}>
      {copy?.confirm ?? 'Löschen'}
    </CampusButton>
  {/snippet}
</Modal>

<style lang="scss">
  .message {
    margin: 0 0 14px;
    font-size: 14px;
    line-height: 1.5;
    color: rgb(var(--md-on-surface-variant));
  }
  .preview {
    padding: 12px 14px;
    background: rgba(var(--md-surface-variant), 0.4);
    border: 1px solid rgb(var(--md-outline-variant));
    border-radius: var(--md-radius-md);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    flex-shrink: 0;
    margin-top: 2px;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  .chip {
    flex-shrink: 0;
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(var(--md-surface-variant), 0.9);
    border: 1px solid rgb(var(--md-outline-variant));
    font-size: 11px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    &.active {
      background: rgba(var(--md-primary), 0.15);
      border-color: rgba(var(--md-primary), 0.4);
      color: rgb(var(--md-primary));
    }
  }
  .shots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    // Cropped to the region and mirrored to match the camera — the flip goes on
    // the box, never the image; see $lib/roi.
    .shot {
      position: relative;
      overflow: hidden;
      width: 44px;
      height: 44px;
      border-radius: 6px;
      background: rgb(var(--md-surface));
      transform: scaleX(var(--cam-mirror));
      img {
        position: absolute;
        display: block;
        max-width: none;
      }
    }
  }
  .more {
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
  }
  .empty {
    margin-top: 6px;
    font-size: 12px;
    font-style: italic;
    color: rgb(var(--md-on-surface-variant));
  }
  // Scrolls inside the modal body once a project has many classes, so the
  // buttons stay reachable instead of the dialog growing past the viewport.
  .class-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 40vh;
    overflow-y: auto;
  }
  .warning {
    margin: 12px 0 0;
    font-size: 12px;
    color: rgb(var(--md-error));
  }
</style>
