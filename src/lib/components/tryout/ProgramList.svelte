<script lang="ts">
  import { get } from 'svelte/store';
  import {
    currentProject,
    addMakeCodeProgram,
    deleteMakeCodeProgram,
    renameMakeCodeProgram,
    selectMakeCodeProgram,
    type MakeCodeProgram,
  } from '$lib/stores/projects';
  import { importProgramFiles, generateProject } from '$lib/makecode';
  import { classes } from '$lib/stores';
  import { currentLang, t } from '$lib/stores/app';

  const lang = $derived($currentLang);
  const programs = $derived($currentProject?.makeCodePrograms ?? []);
  const activeId = $derived($currentProject?.currentProgramId ?? null);

  let renamingId: string | null = $state(null);
  let renameDraft = $state('');

  function handleSelect(p: MakeCodeProgram) {
    if (renamingId === p.id) return;
    if (p.id === activeId) return;
    selectMakeCodeProgram(p.id);
    importProgramFiles(p.files, p.header);
  }

  function handleNew() {
    const proj = get(currentProject);
    if (!proj) return;
    const mcp = generateProject({
      name: proj.name || 'Teachable',
      mode: proj.mode ?? 'image',
      classes: get(classes),
      thresholds: proj.classThresholds ?? {},
    });
    const fresh = addMakeCodeProgram({
      files: (mcp.text ?? {}) as Record<string, string>,
      header: mcp.header,
    });
    if (fresh) importProgramFiles(fresh.files, fresh.header);
  }

  function handleDelete(p: MakeCodeProgram, e: Event) {
    e.stopPropagation();
    if (!confirm(`"${p.name}" löschen?`)) return;
    deleteMakeCodeProgram(p.id);
    // If we just deleted the active program, load whatever is newly active.
    const now = get(currentProject);
    const next = (now?.makeCodePrograms ?? []).find((x) => x.id === now?.currentProgramId);
    if (next) importProgramFiles(next.files, next.header);
  }

  function startRename(p: MakeCodeProgram, e: Event) {
    e.stopPropagation();
    renamingId = p.id;
    renameDraft = p.name;
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameDraft.trim();
    if (name) renameMakeCodeProgram(renamingId, name);
    renamingId = null;
  }

  function cancelRename() {
    renamingId = null;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="program-list">
  <div class="head">
    <h4>{t('programs.title', lang)}</h4>
    <button class="add-btn" onclick={handleNew} title={t('programs.new', lang)}>+</button>
  </div>

  {#if programs.length === 0}
    <div class="empty">{t('programs.empty', lang)}</div>
  {:else}
    <ul>
      {#each programs as p (p.id)}
        <li class:active={p.id === activeId}>
          {#if renamingId === p.id}
            <div class="main-row">
              <input
                type="text"
                bind:value={renameDraft}
                onblur={commitRename}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') cancelRename();
                }}
              />
            </div>
            <div class="meta">{formatDate(p.updatedAt)}</div>
          {:else}
            <button type="button" class="program-row" onclick={() => handleSelect(p)}>
              <span class="name">{p.name}</span>
              <span class="meta">{formatDate(p.updatedAt)}</span>
            </button>
            <div class="actions">
              <button class="icon-btn" title={t('programs.rename', lang)} onclick={(e) => startRename(p, e)}>✎</button>
              <button class="icon-btn danger" title={t('programs.delete', lang)} onclick={(e) => handleDelete(p, e)}>✕</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style lang="scss">
  .program-list {
    padding: 12px 14px 6px;
    background: #fafafa;
    border-bottom: 1px solid #eee;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    h4 {
      margin: 0;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      font-weight: 600;
    }
  }
  .add-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    background: #fff;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    color: #444;
    &:hover { background: #f3f4f6; }
  }
  .empty {
    font-size: 12px;
    color: #999;
    font-style: italic;
    padding: 6px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    position: relative;
    border-radius: 8px;
    border: 1px solid transparent;
    background: #fff;
    transition: background 0.12s, border-color 0.12s;
    overflow: hidden;

    &:hover { background: #f3f4f6; }
    &.active {
      background: #eef7ff;
      border-color: #93c5fd;
    }
  }
  .program-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 8px 44px 8px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .name {
    font-weight: 500;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .main-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
  }
  input {
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #93c5fd;
    border-radius: 4px;
    font-size: 13px;
  }
  .actions {
    position: absolute;
    right: 6px;
    top: 6px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  li:hover .actions, li.active .actions {
    opacity: 1;
  }
  .icon-btn {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    color: #666;
    &:hover { background: rgba(0, 0, 0, 0.08); color: #222; }
    &.danger:hover { background: #fee2e2; color: #991b1b; }
  }
  .meta {
    font-size: 11px;
    color: #888;
    margin-top: 2px;
    margin-left: 2px;
  }
</style>
