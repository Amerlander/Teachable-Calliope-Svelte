<script lang="ts">
  import { appMode, showWelcome, currentLang, t } from '$lib/stores/app';
  import type { AppMode } from '$lib/stores/app';

  let { onstart }: { onstart?: (mode: AppMode) => void } = $props();

  function start(mode: AppMode) {
    appMode.set(mode);
    showWelcome.set(false);
    onstart?.(mode);
  }

  const lang = $derived($currentLang);
</script>

{#if $showWelcome}
  <div class="backdrop">
    <div class="box">
      <div class="title">
        {t('welcome.title', lang).split('\n')[0]}<br />
        <span>{t('welcome.title', lang).split('\n')[1] || 'Teachable Machine'}</span>
      </div>
      <p class="subtitle">{t('welcome.subtitle', lang)}</p>

      <div class="mode-label">{t('welcome.chooseMode', lang)}</div>
      <div class="mode-buttons">
        <button class="mode-btn" onclick={() => start('image')}>
          <span class="mode-icon">
            <!-- Image mode SVG icon -->
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 309.5 198" width="80" height="80">
              <rect fill="#9ec41a" width="309.5" height="198" rx="5.6" ry="5.6"/>
              <path fill="#58b364" d="M227.1,80.7c-2.1-3.6-7.4-3.6-9.4,0l-9.7,16.8c-2.1,3.6-7.4,3.6-9.4,0l-28.2-48.9c-2.1-3.6-7.4-3.6-9.4,0l-36.5,59c-2.1,3.4-7,3.3-9,0l-15.9-27.6c-2.1-3.6-7.3-3.6-9.4,0l-38.3,66.3c-2.1,3.6.5,8.2,4.7,8.2h114.9c4.2,0,6.8-4.6,4.7-8.2l-9.5-16.4,24.9-.4,22.4,1.5,45.9-1.7-32.6-48.3Z"/>
              <rect fill="#fff" x="130.8" y="123.7" width="158.7" height="39.7" rx="2.8" ry="2.8"/>
              <rect fill="rgba(158,196,26,0.5)" x="136.4" y="146.4" width="146.5" height="11.3" rx=".9" ry=".9"/>
              <rect fill="#9ec41a" x="136.4" y="146.4" width="18.3" height="11.3" rx=".9" ry=".9"/>
              <rect fill="rgba(158,196,26,0.5)" x="136.4" y="129.4" width="146.5" height="11.3" rx=".9" ry=".9"/>
              <rect fill="#9ec41a" x="136.4" y="129.4" width="137.2" height="11.3" rx=".9" ry=".9"/>
            </svg>
          </span>
          <span class="mode-name">{t('welcome.modeImage', lang)}</span>
          <span class="mode-desc">{t('welcome.modeImageDesc', lang)}</span>
        </button>

        <button class="mode-btn" onclick={() => start('pose')}>
          <span class="mode-icon">
            <!-- Pose mode SVG icon -->
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 309.5 198" width="80" height="80">
              <rect fill="#00e5ff" width="309.5" height="198" rx="5.6" ry="5.6"/>
              <path fill="#42a5f5" d="M158.3,87.7c-18.9,0-34.2-15.3-34.2-34.2s15.4-34.2,34.2-34.2,34.2,15.4,34.2,34.2-15.4,34.2-34.2,34.2ZM158.3,28.2c-13.9,0-25.3,11.3-25.3,25.3s11.3,25.3,25.3,25.3,25.3-11.3,25.3-25.3-11.3-25.3-25.3-25.3Z"/>
              <path fill="#5d3d99" d="M173.1,168.5h-29.7c-9.1,0-12.5-6-13.1-9.2v-49.1h8.9v47.7c.3.6,1.2,1.7,4.2,1.7h29.7c3,0,3.9-1.1,4.2-1.7v-47.7h8.9v48.4c-.6,3.9-4,10-13.1,10Z"/>
              <path fill="#d8b6ff" d="M213.6,168.6l-37.3-58.8c-1.7-1.7-9-8.4-14.6-8.4h-6.8c-5.6,0-13,6.7-15.1,9l-36.8,58.2-7.5-4.8,37.3-58.8c1.6-1.8,11.6-12.6,22.2-12.6h6.8c10.6,0,20.6,10.7,21.7,12l37.7,59.4-7.5,4.8Z"/>
              <rect fill="#fff" x="140.8" y="117.7" width="149.7" height="39.7" rx="2.8" ry="2.8"/>
              <rect fill="#f2e9ff" x="146.4" y="140.4" width="137.5" height="11.3" rx=".9" ry=".9"/>
              <rect fill="#d8b6ff" x="146.4" y="140.4" width="18.3" height="11.3" rx=".9" ry=".9"/>
              <rect fill="#f2e9ff" x="146.4" y="123.4" width="137.5" height="11.3" rx=".9" ry=".9"/>
              <rect fill="#d8b6ff" x="146.4" y="123.4" width="128.2" height="11.3" rx=".9" ry=".9"/>
            </svg>
          </span>
          <span class="mode-name">{t('welcome.modePose', lang)}</span>
          <span class="mode-desc">{t('welcome.modePoseDesc', lang)}</span>
        </button>
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
    z-index: 999999;
  }
  .box {
    background: #fff;
    padding: 32px 40px;
    border-radius: 20px;
    max-width: 600px;
    width: 90%;
    text-align: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    font-family: 'Inter', system-ui, sans-serif;
  }
  .title {
    font-size: 30px;
    font-weight: 600;
    color: #000;
    margin-bottom: 12px;
    line-height: 1.3;
    span { color: #1fb6ff; }
  }
  .subtitle {
    font-size: 17px;
    color: #444;
    margin: 0 0 20px;
    line-height: 1.4;
  }
  .mode-label {
    font-size: 14px;
    color: #555;
    font-weight: 500;
    margin-bottom: 12px;
  }
  .mode-buttons {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .mode-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 28px;
    border: 2px solid #e0e0e0;
    border-radius: 16px;
    background: #fff;
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    min-width: 130px;
    font-family: inherit;
    box-shadow: none;
    min-height: unset;
    &:hover {
      border-color: #1fb6ff;
      box-shadow: 0 4px 16px rgba(31, 182, 255, 0.18);
      background: #f0fbff;
    }
  }
  .mode-icon { display: flex; align-items: center; justify-content: center; }
  .mode-name { font-size: 16px; font-weight: 700; color: #222; }
  .mode-desc { font-size: 11px; color: #777; text-align: center; }
</style>
