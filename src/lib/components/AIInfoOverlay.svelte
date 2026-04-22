<script lang="ts">
  import { showAIInfoOverlay } from '$lib/stores/app';

  function close(e: MouseEvent) { if (e.target === e.currentTarget) showAIInfoOverlay.set(false); }
  function closeBtn() { showAIInfoOverlay.set(false); }
</script>

{#if $showAIInfoOverlay}
  <div class="backdrop" onclick={close} onkeydown={(e) => e.key === 'Escape' && closeBtn()} role="presentation">
    <div class="box">
      <button class="close" onclick={closeBtn}>&times;</button>
      <div class="title">Hinweise</div>
      <div class="content">
        <h3>Du arbeitest mit einem KI-System</h3>
        <p>Die Calliope Teachable Machine nutzt künstliche Intelligenz (KI), um aus deinen Beispielbildern zu lernen. Das bedeutet: Du trainierst ein Modell, das eigenständig Muster in Bildern erkennt.</p>

        <h3>So funktioniert das System</h3>
        <p>Das Modell basiert auf "Transfer Learning". Dabei nutzen wir ein bereits vortrainiertes neuronales Netz (MobileNet). Alle Berechnungen finden direkt in deinem Browser statt — keine Daten werden an Server übertragen.</p>

        <h3>Deine Daten bleiben bei dir</h3>
        <p>Alle Bilder, die du mit der Webcam aufnimmst, werden ausschließlich lokal verarbeitet. Sie verlassen deinen Computer nicht.</p>

        <h3>Grenzen und Einschränkungen</h3>
        <p>Dein trainiertes Modell ist nur so gut wie deine Trainingsdaten. Das System ist für <strong>Lern- und Experimentierprojekte</strong> gedacht und nicht für sicherheitskritische Anwendungen geeignet.</p>

        <h3>Fairness und Verantwortung</h3>
        <p>Achte darauf, dass deine Trainingsdaten ausgewogen sind und keine Vorurteile widerspiegeln. Auch der Hintergrund wird trainiert — Gegenstände im Hintergrund können das Modell beeinflussen.</p>

        <h3>Weitere Informationen</h3>
        <p>Bei Fragen: <a href="mailto:info@calliope.cc">info@calliope.cc</a><br>
        Dieses Tool folgt den Transparenzanforderungen der EU-KI-Verordnung (EU) 2024/1689.</p>
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
    z-index: 9999999;
  }
  .box {
    position: relative;
    background: #fff;
    padding: 40px 48px;
    border-radius: 20px;
    max-width: 700px;
    max-height: 85vh;
    width: 90%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    font-family: 'Inter', system-ui, sans-serif;
    overflow-y: auto;
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
  .title { font-size: 28px; font-weight: 600; color: #000; margin-bottom: 24px; text-align: center; }
  .content {
    font-size: 15px; line-height: 1.7; color: #333;
    h3 { font-size: 18px; font-weight: 600; color: #000; margin: 24px 0 12px; }
    h3:first-child { margin-top: 0; }
    p { margin-bottom: 14px; }
    strong { font-weight: 600; color: #000; }
    a { color: #1fb6ff; }
  }
</style>
