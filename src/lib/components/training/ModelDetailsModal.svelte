<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import { modelMetadata, trainingHistory, trainingOptions, classes, examples } from '$lib/stores';
  import { activeModel, currentProject } from '$lib/stores/projects';

  let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();

  function close() {
    isOpen = false;
  }

  function pct(n: number | undefined) {
    if (n == null) return '–';
    return (n * 100).toFixed(2) + ' %';
  }

  function num(n: number | undefined) {
    return n?.toLocaleString('de-DE') ?? '–';
  }

  function bytes(n: number | undefined) {
    if (n == null) return '–';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  const EXTRACTOR_LABELS: Record<string, string> = {
    'mobilenet-v1': 'MobileNet v1 (α=1.0)',
    'mobilenet-v2': 'MobileNet v2 (α=1.0)',
    'mobilenet-v1-lite': 'MobileNet v1 Lite (α=0.5)'
  };
  const extractorLabel = $derived(
    EXTRACTOR_LABELS[$trainingOptions.featureExtractor] ?? 'MobileNet v1 (α=1.0)'
  );

  const finalAcc = $derived(
    $trainingHistory.accuracy.length
      ? $trainingHistory.accuracy[$trainingHistory.accuracy.length - 1]
      : undefined
  );
  const finalLoss = $derived(
    $trainingHistory.loss.length
      ? $trainingHistory.loss[$trainingHistory.loss.length - 1]
      : undefined
  );
  // Class figures describe the selected training run, not the project's current
  // class list — the two drift apart as soon as classes are added or renamed.
  const perClassCounts = $derived(
    $activeModel
      ? ($activeModel.classes ?? []).map((c) => ({
          name: c,
          count: $activeModel.exampleCounts?.[c] ?? 0
        }))
      : $classes.map((c) => ({ name: c, count: $examples[c]?.length ?? 0 }))
  );
  const totalExamples = $derived(perClassCounts.reduce((acc, row) => acc + row.count, 0));
</script>

<Modal title="Modell-Details" {isOpen} size="large" onclose={close}>
  {#snippet children()}
    <div class="details">
      <section class="block">
        <h3>Zusammenfassung</h3>
        <dl>
          <div><dt>Projekt</dt><dd>{$currentProject?.name ?? '–'}</dd></div>
          <div><dt>Modus</dt><dd>{$currentProject?.mode === 'pose' ? 'Pose' : 'Objekt'}</dd></div>
          <div>
            <dt>Genauigkeit (final)</dt>
            <dd>{pct(finalAcc)}</dd>
          </div>
          <div>
            <dt>Loss (final)</dt>
            <dd>{finalLoss?.toFixed(4) ?? '–'}</dd>
          </div>
          <div><dt>Klassen</dt><dd>{perClassCounts.length}</dd></div>
          <div><dt>Beispiele gesamt</dt><dd>{totalExamples}</dd></div>
          <div>
            <dt>Trainiert am</dt>
            <dd>{$modelMetadata.date ? new Date($modelMetadata.date).toLocaleString('de-DE') : '–'}</dd>
          </div>
        </dl>
      </section>

      <section class="block">
        <h3>Was diese Zahlen bedeuten</h3>
        <p>
          Die <strong>Genauigkeit</strong> zeigt, wie oft das Modell während des Trainings
          richtig gelegen hat — aber nur auf den Bildern, die du ihm gegeben hast. Eine hohe
          Trainings-Genauigkeit ist kein Beleg dafür, dass das Modell auch bei neuen Bildern
          richtig liegt (Überanpassung). Achte beim Testen im Video darauf, ob die Vorhersage
          stabil bleibt, wenn du Licht, Position oder Hintergrund änderst.
        </p>
        <p>
          Der <strong>Loss</strong> misst, wie weit die vorhergesagte Wahrscheinlichkeits­verteilung
          von der korrekten Antwort entfernt ist. Er sollte im Verlauf des Trainings fallen;
          steigt er wieder, ist das Modell möglicherweise überangepasst.
        </p>
        <p>
          Die <strong>Anzahl Beispiele</strong> beeinflusst die Qualität stärker als jede
          Parametereinstellung. 30 Bilder pro Klasse sind ein guter Start — bei schwierigen
          Unterscheidungen lieber 100+.
        </p>
      </section>

      <section class="block">
        <h3>Verteilung pro Klasse</h3>
        <table>
          <thead>
            <tr><th>Klasse</th><th>Beispiele</th><th>Anteil</th></tr>
          </thead>
          <tbody>
            {#each perClassCounts as row}
              <tr>
                <td>{row.name}</td>
                <td>{row.count}</td>
                <td>
                  {totalExamples > 0 ? ((row.count / totalExamples) * 100).toFixed(1) + ' %' : '–'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="hint">
          Klassen mit deutlich weniger Beispielen werden tendenziell schlechter erkannt —
          dann lohnt es sich, dort gezielt nachzutrainieren.
        </p>
      </section>

      <section class="block">
        <h3>Architektur</h3>
        <dl>
          <div><dt>Schichten</dt><dd>{num($modelMetadata.layers)}</dd></div>
          <div><dt>Parameter</dt><dd>{num($modelMetadata.params)}</dd></div>
          <div><dt>Modellgröße (~)</dt><dd>{bytes($modelMetadata.sizeBytes)}</dd></div>
          <div><dt>Feature-Extraktor</dt><dd>{extractorLabel} (eingefroren)</dd></div>
        </dl>
        <p class="hint">
          Dieses Projekt nutzt Transfer-Learning: MobileNet extrahiert aus jedem Bild einen
          Merkmalsvektor und ein kleiner Klassifikator oben drauf wird trainiert. Deshalb
          reichen vergleichsweise wenige Beispiele.
        </p>
      </section>

      <section class="block">
        <h3>Trainings-Konfiguration</h3>
        <dl>
          <div>
            <dt>Epochen</dt>
            <dd>{$trainingOptions.epochs}</dd>
            <dd class="explain">
              Ein Durchlauf durch alle Beispiele = eine Epoche. Zu wenige = unterangepasst,
              zu viele = Überanpassung.
            </dd>
          </div>
          <div>
            <dt>Batch-Größe</dt>
            <dd>{$trainingOptions.batchSize}</dd>
            <dd class="explain">
              Wie viele Beispiele pro Gradientenschritt. Kleiner = rauschiger, aber oft
              besser für kleine Datensätze.
            </dd>
          </div>
          <div>
            <dt>Lernrate</dt>
            <dd>{$trainingOptions.learningRate}</dd>
            <dd class="explain">
              Schrittweite pro Update. Zu groß = schwingt über, zu klein = lernt nichts.
            </dd>
          </div>
          <div>
            <dt>Hidden Units</dt>
            <dd>{$trainingOptions.hiddenUnits}</dd>
            <dd class="explain">
              Kapazität der versteckten Schicht. Größer = mehr ausdrucksstark, aber auch
              mehr Daten nötig, um nicht überanzupassen.
            </dd>
          </div>
        </dl>
      </section>

      {#if $trainingHistory.epochs.length}
        <section class="block">
          <h3>Verlauf pro Epoche</h3>
          <table class="compact">
            <thead>
              <tr><th>#</th><th>Genauigkeit</th><th>Loss</th></tr>
            </thead>
            <tbody>
              {#each $trainingHistory.epochs as ep, i}
                <tr>
                  <td>{ep}</td>
                  <td>{($trainingHistory.accuracy[i] * 100).toFixed(2)} %</td>
                  <td>{$trainingHistory.loss[i]?.toFixed(4) ?? '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
    </div>
  {/snippet}

  {#snippet actions()}
    <button onclick={close}>Schließen</button>
  {/snippet}
</Modal>

<style lang="scss">
  .details {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .block {
    h3 {
      margin: 0 0 10px;
      font-size: 15px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(var(--md-outline-variant), 0.5);
    }
    p {
      margin: 0 0 8px;
      font-size: 13px;
      line-height: 1.55;
      color: rgb(var(--md-on-surface-variant));
    }
    .hint {
      font-size: 12px;
      font-style: italic;
    }
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px 16px;
    margin: 0;
    > div {
      display: flex;
      flex-direction: column;
    }
    dt {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgb(var(--md-on-surface-variant));
    }
    dd {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      &.explain {
        margin-top: 4px;
        font-size: 12px;
        font-weight: 400;
        color: rgb(var(--md-on-surface-variant));
        line-height: 1.4;
      }
    }
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    th,
    td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid rgba(var(--md-outline-variant), 0.4);
    }
    th {
      font-weight: 600;
      color: rgb(var(--md-on-surface-variant));
      font-size: 12px;
    }
  }
  table.compact {
    max-height: 200px;
    display: block;
    overflow-y: auto;
  }
</style>
