<script lang="ts">
  import { showLanguageOverlay, currentLang, setLang } from '$lib/stores/app';
  import type { Lang } from '$lib/stores/app';

  // Only the languages that actually have a catalog. French, Spanish, Italian
  // and Greek used to be offered here and silently fell back to German.
  const LANGUAGES: { code: Lang; label: string }[] = [
    { code: 'de', label: 'Deutsch (DE)' },
    { code: 'en', label: 'English (EN)' }
  ];

  async function select(code: Lang) {
    await setLang(code);
    showLanguageOverlay.set(false);
  }
  function close(e: MouseEvent) { if (e.target === e.currentTarget) showLanguageOverlay.set(false); }
  function closeBtn() { showLanguageOverlay.set(false); }
</script>

{#if $showLanguageOverlay}
  <div class="backdrop" onclick={close} onkeydown={(e) => e.key === 'Escape' && closeBtn()} role="presentation">
    <div class="box">
      <button class="close" onclick={closeBtn}>&times;</button>
      <h2>Sprache auswählen</h2>
      <div class="list">
        {#each LANGUAGES as lang}
          <button
            class="lang-option"
            class:active={$currentLang === lang.code}
            onclick={() => select(lang.code)}
          >
            {lang.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000000;
  }
  .box {
    position: relative;
    background: #fff;
    padding: 32px 40px;
    border-radius: 20px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    font-family: 'Inter', system-ui, sans-serif;
    h2 { font-size: 24px; font-weight: 600; color: #000; margin: 0 0 24px; text-align: center; }
  }
  .close {
    position: absolute;
    top: 16px; right: 16px;
    background: transparent;
    border: none;
    font-size: 28px;
    cursor: pointer;
    padding: 8px;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    min-height: unset;
    box-shadow: none;
    color: #666;
    &:hover { background: #f5f5f5; }
  }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .lang-option {
    padding: 14px 20px;
    background: #f5f5f5;
    border: 2px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    color: #333;
    text-align: center;
    font-family: inherit;
    transition: all 0.2s;
    box-shadow: none;
    min-height: unset;
    &:hover { background: #e8e8e8; border-color: #1fb6ff; }
    &.active { background: #e3f5ff; border-color: #1fb6ff; color: #1fb6ff; font-weight: 600; }
  }
</style>
