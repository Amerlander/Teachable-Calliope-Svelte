<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ModelCharts from './ModelCharts.svelte';
  import EpochChart from './EpochChart.svelte';
  import { examples, setTrainingOptions, setDraftRoi } from '$lib/stores';
  import { modelTabView } from '$lib/stores/app';
  import { activeModel, currentProject, type TrainedModel } from '$lib/stores/projects';
  import { exportModelToZip } from '$lib/machine';
  import { cachedConfusion, confusionRunning, ensureConfusion } from '$lib/confusion';
  import { modelLabel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import {
    INFO_TEXTS,
    EXTRACTOR_LABELS,
    OPTIMIZER_LABELS,
    bytes,
    dec,
    describeLayers,
    modelInsights,
    num,
    pct,
    roiLabel,
    weightDtype,
    type Finding,
    type FindingPane
  } from '$lib/modelInsights';

  let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();

  type Pane = 'overview' | 'classes' | 'settings' | 'architecture' | 'history' | 'confusion' | 'raw';

  const PANES: { id: Pane; label: string; group: 'model' | 'pro' }[] = [
    { id: 'overview', label: 'Überblick', group: 'model' },
    { id: 'classes', label: 'Klassen', group: 'model' },
    { id: 'settings', label: 'Einstellungen', group: 'model' },
    { id: 'architecture', label: 'Architektur', group: 'pro' },
    { id: 'history', label: 'Verlauf pro Epoche', group: 'pro' },
    { id: 'confusion', label: 'Verwechslungen', group: 'pro' },
    { id: 'raw', label: 'Rohdaten & Export', group: 'pro' }
  ];

  // Static background knowledge, one to three paragraphs per pane. Unlike the
  // findings below these never mention a result, and unlike the "?" texts they
  // are too long for a single sentence.
  const KNOW: Record<Pane, { head: string; body: string }[]> = {
    overview: [
      {
        head: 'Woran man Überanpassung merkt',
        body: 'Wenn die Genauigkeit hoch ist, das Modell im Video aber unsicher wird, sobald sich Licht oder Hintergrund ändern, hat es sich die Bilder gemerkt statt der Muster darin.'
      },
      {
        head: 'Gut testen',
        body: 'Halte auch Dinge ins Bild, die zu keiner Klasse gehören. Ein Modell ohne Klasse für „nichts davon“ muss sich immer für eine Klasse entscheiden.'
      }
    ],
    classes: [
      {
        head: 'Warum die Balance zählt',
        body: 'Beim Training zählt jedes Bild gleich viel. Eine Klasse mit doppelt so vielen Bildern bekommt damit auch doppelt so viel Aufmerksamkeit.'
      },
      {
        head: 'Wozu eine Klasse für „nichts davon“ gut ist',
        body: 'Ohne sie muss das Modell jedes Bild einer der echten Klassen zuordnen, auch wenn gar nichts Passendes im Bild ist. 30 bis 50 Bilder vom leeren Hintergrund genügen dafür.'
      },
      {
        head: 'Was gute Beispielbilder ausmacht',
        body: 'Verschiedene Abstände, Winkel und Lichtsituationen. Zwanzig fast identische Aufnahmen bringen so viel wie eine.'
      }
    ],
    settings: [
      {
        head: 'Was man zuerst ändert',
        body: 'Bei einem schwachen Modell bringen mehr und vielfältigere Bilder fast immer mehr als geänderte Einstellungen. Die Standardwerte passen für die meisten Projekte.'
      },
      {
        head: 'Epochen und Überanpassung',
        body: 'Mehr Epochen heißt mehr Lernzeit. Ab einem bestimmten Punkt lernt das Modell nichts Neues mehr, sondern merkt sich die vorhandenen Bilder genauer.'
      },
      {
        head: 'Was die Augmentierung nicht kann',
        body: 'Sie verändert vorhandene Bilder. Eine Ansicht, die nie aufgenommen wurde, kann sie nicht erfinden.'
      }
    ],
    architecture: [
      {
        head: 'Transfer-Learning in drei Sätzen',
        body: 'MobileNet ist auf Millionen Bildern vortrainiert und wandelt jedes Bild in eine Reihe von Merkmalen um. Diese Schicht bleibt unverändert. Trainiert wird nur der kleine Klassifikator darüber, deshalb reichen wenige eigene Bilder.'
      },
      {
        head: 'Was der Feature-Extraktor ändert',
        body: 'v2 erkennt feinere Unterschiede, Lite läuft schneller auf schwacher Hardware. Ein Wechsel braucht ein neues Training, weil die Merkmale nicht zueinander passen.'
      },
      {
        head: 'Warum die Summe 1 ergibt',
        body: 'Softmax verteilt die Sicherheit auf die Klassen. Steigt eine, sinken die anderen. Ein Bild, das zu keiner Klasse passt, bekommt trotzdem eine Verteilung.'
      }
    ],
    history: [
      {
        head: 'Welche Spalte zählt',
        body: 'Die geprüfte Genauigkeit ist die härtere Zahl. Sie stammt von Bildern, die im Training zurückgehalten wurden.'
      },
      {
        head: 'Wenn die Kurven auseinanderlaufen',
        body: 'Steigt die Trainings-Genauigkeit weiter, während die geprüfte stehen bleibt, merkt sich das Modell einzelne Bilder. Dann früher aufhören oder mehr Bilder aufnehmen.'
      }
    ],
    confusion: [
      {
        head: 'Erkannt und Treffgenauigkeit',
        body: 'Erkannt heißt: wie viele Bilder dieser Klasse gefunden wurden. Treffgenauigkeit heißt: wie oft die Klasse stimmte, wenn das Modell sie vorhergesagt hat.'
      },
      {
        head: 'Warum die Zahlen freundlich aussehen',
        body: 'Gerechnet wird mit den Beispielbildern im Projekt, die das Modell größtenteils schon kennt. Im Video mit neuen Bildern gibt es meist mehr Verwechslungen.'
      }
    ],
    raw: [
      {
        head: 'Was im ZIP steckt',
        body: 'Die Gewichte, die Klassennamen, der Bildbereich, der Feature-Extraktor und die Kalibrierung. Die Trainings-Einstellungen und die Beispielbilder bleiben im Projekt.'
      },
      {
        head: 'Was beim Löschen passiert',
        body: 'Programme bleiben unberührt: sie laufen mit jedem Modell, weil ihre Blöcke Klassen über die Position ansprechen. Ist dies das geladene Modell, wird das nächste geladen.'
      },
      {
        head: 'Glättung',
        body: 'Der Median über die letzten Vorhersagen wirkt beim Testen und beim Streamen an den Calliope. Das Training ist davon unberührt.'
      }
    ]
  };

  // Shown instead of the two paragraphs above when the run has no checked values:
  // both of those describe a column that is not on screen then.
  const KNOW_HISTORY_UNCHECKED: { head: string; body: string }[] = [
    {
      head: 'Wie man den Verlauf liest',
      body: 'Die Genauigkeit soll steigen und dann flach auslaufen, der Verlust soll fallen. Steigt der Verlust am Ende wieder, merkt sich das Modell einzelne Bilder statt der Muster darin.'
    },
    {
      head: 'Was eine Validierung bringt',
      body: 'Mit einer Validierung hält das Modell einen Teil der Bilder zurück und misst pro Epoche daran mit. Diese Zahl ist die härtere, weil sie von Bildern kommt, die es im Training nicht gesehen hat.'
    }
  ];

  function knowOf(p: Pane): { head: string; body: string }[] {
    if (p === 'history' && !facts?.hasValidation) return KNOW_HISTORY_UNCHECKED;
    return KNOW[p];
  }

  let pane = $state<Pane>('overview');
  // Never retried on its own: a failed measurement would otherwise restart the
  // moment the running flag drops, since nothing else changed.
  let matrixFailedFor = $state<string | null>(null);
  let matrixError = $state('');

  const model = $derived($activeModel);
  const isPose = $derived(model?.mode === 'pose');
  // The matrix lives on the model, keyed by a fingerprint of the images it was
  // measured on (confusion.ts). Reopening the dialog or switching panes reads it
  // back instead of measuring again.
  const confusion = $derived(cachedConfusion(model, $examples));
  const matrix = $derived(confusion?.matrix ?? []);
  const matrixClasses = $derived(confusion?.classes ?? []);
  const matrixRunning = $derived(!!model && $confusionRunning.includes(model.id));
  const matrixTotal = $derived(confusion?.samples ?? 0);
  const insights = $derived(model ? modelInsights(model, matrix.length ? matrix : null) : null);
  const facts = $derived(insights?.facts ?? null);
  const layers = $derived(model ? describeLayers(model) : []);

  // Which panes carry a finding, for the marker in the navigation.
  const flagged = $derived.by(() => {
    const set = new Set<FindingPane>();
    for (const tip of insights?.tips ?? []) {
      if (tip.id !== 'tipp.kompaktesModell' && tip.id !== 'tipp.augmentierungAn') set.add(tip.pane);
    }
    return set;
  });

  function tipsOf(p: Pane): Finding[] {
    const tips = insights?.tips ?? [];
    if (p === 'overview') return tips.slice(0, 4);
    return tips.filter((t) => t.pane === (p as FindingPane));
  }

  // The step belongs to whatever the top tip was about, so it only shows up on
  // the overview and on that tip's own pane.
  function stepOf(p: Pane): Finding | null {
    const step = insights?.nextStep ?? null;
    if (!step) return null;
    if (p === 'overview') return step;
    return step.pane === (p as FindingPane) ? step : null;
  }

  function close() {
    isOpen = false;
  }

  // Opening the dialog, or switching to another model, starts on the overview
  // again. The matrix itself is not reset here: it belongs to the model, not to
  // this view.
  $effect(() => {
    void model?.id;
    void isOpen;
    pane = 'overview';
    matrixError = '';
    matrixFailedFor = null;
  });

  // Measuring runs every example image through the model, so it waits until a
  // pane needs the numbers. Asking twice is harmless: a cached matrix answers at
  // once and a running measurement is joined rather than started again. It also
  // keeps going when the dialog closes — the result lands on the model.
  $effect(() => {
    if (!isOpen || !model) return;
    if (pane !== 'confusion' && pane !== 'classes') return;
    if (confusion || matrixRunning || matrixFailedFor === model.id) return;
    void startMatrix(model);
  });

  function startMatrix(m: TrainedModel) {
    matrixError = '';
    matrixFailedFor = null;
    return ensureConfusion(m).catch((err) => {
      matrixError = (err as Error).message;
      matrixFailedFor = m.id;
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotification(`${what} kopiert`, { type: 'success' });
    } catch {
      showNotification('Kopieren nicht möglich', { type: 'error' });
    }
  }

  function recordJson(m: TrainedModel): string {
    // Everything but the weights, which are binary and would swamp the view.
    return JSON.stringify(
      {
        id: m.id,
        label: m.label,
        trainedAt: new Date(m.trainedAt).toISOString(),
        source: m.source,
        mode: m.mode,
        classes: m.classes,
        exampleCounts: m.exampleCounts,
        featureExtractor: m.featureExtractor,
        roi: m.roi ?? null,
        options: m.options,
        metadata: m.metadata,
        classRanges: m.classRanges ?? null,
        smoothing: m.smoothing ?? null
      },
      null,
      2
    );
  }

  async function exportHistoryCsv(m: TrainedModel) {
    const h = m.history;
    const hasVal = (h.valAccuracy?.length ?? 0) > 0;
    const head = hasVal
      ? 'Epoche;Genauigkeit;Verlust;Geprüfte Genauigkeit;Geprüfter Verlust'
      : 'Epoche;Genauigkeit;Verlust';
    const rows = h.epochs.map((e, i) => {
      const base = [e, h.accuracy[i] ?? '', h.loss[i] ?? ''];
      const extra = hasVal ? [h.valAccuracy?.[i] ?? '', h.valLoss?.[i] ?? ''] : [];
      return [...base, ...extra].join(';').replace(/\./g, ',');
    });
    try {
      const saveAs = (await import('file-saver')).saveAs;
      const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
      saveAs(blob, `${(m.label || 'modell').replace(/[^a-z0-9_\- ]/gi, '_')}_verlauf.csv`);
    } catch {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }

  async function onExport(m: TrainedModel) {
    try {
      await exportModelToZip(m);
      showNotification('Modell exportiert', { type: 'success' });
    } catch {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }

  /** Carry this run's setup into the composer for a new model. */
  function reuseSettings(m: TrainedModel, withRoi: boolean) {
    setTrainingOptions({ ...m.options });
    if (withRoi) setDraftRoi(m.roi ?? null);
    modelTabView.set('new');
    close();
    showNotification(
      withRoi ? 'Einstellungen und Bildbereich übernommen' : 'Einstellungen übernommen',
      { type: 'success' }
    );
  }

  const summary = $derived.by(() => {
    if (!model || !facts) return null;
    const h = model.history;
    if (!h.epochs.length) return null;
    let bestAcc = 0;
    let bestAccEpoch = h.epochs[0];
    let lowLoss = Infinity;
    let lowLossEpoch = h.epochs[0];
    let bestVal = -1;
    let bestValEpoch = h.epochs[0];
    h.epochs.forEach((e, i) => {
      if ((h.accuracy[i] ?? 0) > bestAcc) {
        bestAcc = h.accuracy[i];
        bestAccEpoch = e;
      }
      if ((h.loss[i] ?? Infinity) < lowLoss) {
        lowLoss = h.loss[i];
        lowLossEpoch = e;
      }
      const v = h.valAccuracy?.[i];
      if (v != null && v > bestVal) {
        bestVal = v;
        bestValEpoch = e;
      }
    });
    return { bestAcc, bestAccEpoch, lowLoss, lowLossEpoch, bestVal, bestValEpoch };
  });
</script>

<Modal title="Modell-Details" {isOpen} size="fullscreen" flush onclose={close}>
  {#snippet subtitle()}
    {#if model}
      <span class="sub-line">
        <span>{modelLabel(model)}</span>
        <span aria-hidden="true">·</span>
        <span>Projekt „{$currentProject?.name ?? '–'}“</span>
        <span aria-hidden="true">·</span>
        <span>trainiert am {new Date(model.trainedAt).toLocaleString('de-DE')}</span>
        <span class="chip">aktiv</span>
        <span class="chip muted">{isPose ? 'Pose' : 'Objekt'}</span>
        {#if model.source === 'imported'}<span class="chip muted">importiert</span>{/if}
      </span>
    {/if}
  {/snippet}

  {#snippet children()}
    {#if !model || !facts || !insights}
      <div class="no-model">Kein Modell ausgewählt.</div>
    {:else}
      <div class="cols">
        <nav class="nav">
          <div class="nav-group">Modell</div>
          {#each PANES.filter((p) => p.group === 'model') as item (item.id)}
            <button
              type="button"
              class="nav-item"
              class:active={pane === item.id}
              onclick={() => (pane = item.id)}
            >
              {item.label}
              {#if flagged.has(item.id as FindingPane)}
                <span class="n-mark" title="Hier gibt es etwas zu sehen">!</span>
              {/if}
              {#if item.id === 'classes'}
                <span class="n-count">{model.classes.length}</span>
              {/if}
            </button>
          {/each}
          <div class="nav-group">Für Fortgeschrittene</div>
          {#each PANES.filter((p) => p.group === 'pro') as item (item.id)}
            <button
              type="button"
              class="nav-item"
              class:active={pane === item.id}
              onclick={() => (pane = item.id)}
            >
              {item.label}
              {#if flagged.has(item.id as FindingPane)}
                <span class="n-mark" title="Hier gibt es etwas zu sehen">!</span>
              {/if}
              {#if item.id === 'history' && facts.epochsRun}
                <span class="n-count">{facts.epochsRun}</span>
              {/if}
            </button>
          {/each}
        </nav>

        <div class="data">
          {#if pane === 'overview'}
            <div class="pane-head">
              <h3>Überblick</h3>
              <span class="hint">
                {#if facts.epochsRun}
                  {facts.epochsRun === facts.epochsConfigured
                    ? `${facts.epochsRun} Epochen`
                    : `${facts.epochsRun} von ${facts.epochsConfigured} Epochen`} ·
                {/if}
                {facts.totalExamples} Bilder · Bildbereich {roiLabel(model)}
              </span>
            </div>

            <div class="kpis">
              <div class="kpi">
                <div class="k-label">
                  Genauigkeit <InfoTooltip {...INFO_TEXTS.accuracy} />
                </div>
                <div class="k-value">{pct(facts.accuracy)}</div>
                <div class="k-sub">
                  {facts.hasValidation
                    ? `Training · ${pct(facts.valAccuracy)} geprüft`
                    : 'auf den Trainingsbildern'}
                </div>
              </div>
              <div class="kpi">
                <div class="k-label">Verlust <InfoTooltip {...INFO_TEXTS.loss} /></div>
                <div class="k-value">{dec(facts.loss)}</div>
                <div class="k-sub">
                  {facts.firstLoss != null ? `von ${dec(facts.firstLoss, 2)} gefallen` : '–'}
                </div>
              </div>
              <div class="kpi">
                <div class="k-label">Klassen <InfoTooltip {...INFO_TEXTS.classes} /></div>
                <div class="k-value">{model.classes.length}</div>
                <div class="k-sub">{model.classes.join(' · ')}</div>
              </div>
              <div class="kpi">
                <div class="k-label">Beispiele <InfoTooltip {...INFO_TEXTS.examples} /></div>
                <div class="k-value">{facts.totalExamples}</div>
                <div class="k-sub">
                  {model.classes.length
                    ? `Ø ${Math.round(facts.totalExamples / model.classes.length)} pro Klasse`
                    : '–'}
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head">Trainingsverlauf</div>
              <ModelCharts />
            </div>

            <div class="card">
              <div class="card-head">
                Klassen <span class="hint">{facts.totalExamples} Bilder</span>
              </div>
              {#each facts.classes as c (c.name)}
                <div class="r cls">
                  <div class="nm">
                    {c.name}
                    {#if facts.min && c.name === facts.min.name && facts.max && facts.max.count > c.count}
                      <span class="pill">
                        {Math.round((1 - c.count / facts.max.count) * 100)} % weniger
                      </span>
                    {/if}
                  </div>
                  <div class="bar">
                    <span
                      class:weak={facts.min?.name === c.name}
                      style="width:{facts.max?.count ? (c.count / facts.max.count) * 100 : 0}%"
                    ></span>
                  </div>
                  <div class="numc">{c.count}</div>
                  <div class="subc">{pct(c.share)}</div>
                </div>
              {/each}
            </div>
          {:else if pane === 'classes'}
            <div class="pane-head">
              <h3>Klassen</h3>
              <span class="hint">
                {model.classes.length} Klassen · {facts.totalExamples} Bilder · Reihenfolge wie im Modell
              </span>
            </div>

            <div class="card">
              <div class="card-head">
                Bilder und Erkennung pro Klasse
                <span class="hint">
                  {#if matrixRunning}
                    Erkennung wird berechnet…
                  {:else if matrixError}
                    Erkennung nicht verfügbar
                  {:else if confusion && matrixTotal === 0}
                    keine Beispielbilder im Projekt
                  {:else if confusion}
                    Erkennung aus {matrixTotal} Beispielbildern
                  {:else}
                    Erkennung aus den Beispielbildern im Projekt
                  {/if}
                </span>
              </div>
              <div class="r cls-wide head-row">
                <div>Klasse</div>
                <div>Anteil</div>
                <div class="subc">Bilder</div>
                <div class="subc">Anteil</div>
                <div class="subc">Erkannt <InfoTooltip {...INFO_TEXTS.recall} /></div>
              </div>
              {#each facts.classes as c (c.name)}
                <div class="r cls-wide">
                  <div class="nm">
                    {c.name}
                    {#if facts.min?.name === c.name && facts.classes.length > 1}
                      <span class="pill">wenigste Bilder</span>
                    {/if}
                    {#if c.count > 0 && c.count < 30}
                      <span class="pill">unter 30</span>
                    {/if}
                  </div>
                  <div class="bar">
                    <span
                      class:weak={facts.min?.name === c.name}
                      style="width:{facts.max?.count ? (c.count / facts.max.count) * 100 : 0}%"
                    ></span>
                  </div>
                  <div class="numc">{c.count}</div>
                  <div class="subc">{pct(c.share)}</div>
                  <div class="subc">{c.recall != null ? pct(c.recall) : '–'}</div>
                </div>
              {/each}
            </div>

            <div class="card plain">
              <div class="card-head">Ausgabe des Modells</div>
              <p>
                Das Modell gibt für jedes Bild {model.classes.length}
                {model.classes.length === 1 ? 'Wert' : 'Werte'} aus, einen pro Klasse, in der
                Reihenfolge {model.classes.join(', ')}. Diese Reihenfolge steht auch in den
                Programmen, die dieses Modell benutzen. Klassen, die du im Projekt später
                umbenennst, ändern sie nicht.
              </p>
              <div class="btn-row">
                <Button
                  variant="ghost"
                  size="small"
                  onclick={() => copy(model.classes.join(', '), 'Klassennamen')}
                >
                  Klassennamen kopieren
                </Button>
              </div>
            </div>
          {:else if pane === 'settings'}
            <div class="pane-head">
              <h3>Einstellungen</h3>
              <span class="hint">
                {model.source === 'imported'
                  ? 'importiertes Modell — die Werte kamen nicht mit'
                  : 'so war dieser Lauf konfiguriert'}
              </span>
            </div>

            {#if model.source === 'imported'}
              <div class="card plain">
                <p>
                  Ein Modell-ZIP führt die Trainings-Einstellungen nicht mit. Was hier stünde,
                  wären die Standardwerte dieses Projekts und nicht die des Laufs, aus dem das
                  Modell stammt.
                </p>
              </div>
            {:else}
              <div class="card">
                <div class="card-head">Grundeinstellungen</div>
                <div class="opt-grid">
                  <div class="opt">
                    <span class="o-label">Epochen <InfoTooltip {...INFO_TEXTS.epochs} /></span>
                    <span class="o-value">
                      {facts.earlyStopped
                        ? `${facts.epochsRun} / ${facts.epochsConfigured}`
                        : facts.epochsConfigured}
                    </span>
                  </div>
                  <div class="opt">
                    <span class="o-label">Batch-Größe <InfoTooltip {...INFO_TEXTS.batchSize} /></span>
                    <span class="o-value">{model.options.batchSize}</span>
                  </div>
                  <div class="opt">
                    <span class="o-label">Lernrate <InfoTooltip {...INFO_TEXTS.learningRate} /></span>
                    <span class="o-value">{model.options.learningRate}</span>
                  </div>
                  <div class="opt">
                    <span class="o-label">Hidden Units <InfoTooltip {...INFO_TEXTS.hiddenUnits} /></span>
                    <span class="o-value">{model.options.hiddenUnits}</span>
                  </div>
                </div>
              </div>

              <div class="card">
                <div class="card-head">Erweiterte Einstellungen</div>
                <div class="opt-grid">
                  {#if !isPose}
                    <div class="opt">
                      <span class="o-label">
                        Feature-Extraktor <InfoTooltip {...INFO_TEXTS.featureExtractor} />
                      </span>
                      <span class="o-value">
                        {EXTRACTOR_LABELS[model.featureExtractor ?? model.options.featureExtractor] ??
                          '–'}
                      </span>
                    </div>
                  {/if}
                  <div class="opt">
                    <span class="o-label">Optimierer <InfoTooltip {...INFO_TEXTS.optimizer} /></span>
                    <span class="o-value">
                      {OPTIMIZER_LABELS[model.options.optimizer] ?? model.options.optimizer}
                    </span>
                  </div>
                  <div class="opt">
                    <span class="o-label">Dropout <InfoTooltip {...INFO_TEXTS.dropout} /></span>
                    <span class="o-value">
                      {model.options.dropout ? model.options.dropout : 'aus'}
                    </span>
                  </div>
                  <div class="opt">
                    <span class="o-label">
                      Validierung <InfoTooltip {...INFO_TEXTS.validationSplit} />
                    </span>
                    <span class="o-value">
                      {model.options.validationSplit
                        ? `${Math.round(model.options.validationSplit * 100)} %`
                        : 'aus'}
                    </span>
                  </div>
                  <div class="opt">
                    <span class="o-label">Stop-Loss <InfoTooltip {...INFO_TEXTS.earlyStopLoss} /></span>
                    <span class="o-value">
                      {model.options.earlyStopLoss
                        ? `${dec(model.options.earlyStopLoss, 3)}${facts.earlyStopped ? '' : ' · nicht erreicht'}`
                        : 'aus'}
                    </span>
                  </div>
                  {#if !isPose}
                    <div class="opt">
                      <span class="o-label">Bildbereich <InfoTooltip {...INFO_TEXTS.roi} /></span>
                      <span class="o-value">{roiLabel(model)}</span>
                    </div>
                  {/if}
                </div>

                <div class="sub-block">
                  <div class="sub-h">
                    Augmentierung: {model.options.augmentation ? 'an' : 'aus'}
                    <InfoTooltip {...INFO_TEXTS.augmentation} />
                  </div>
                  {#if model.options.augmentation}
                    {@const a = model.options.augmentationSettings}
                    <div class="opt-grid">
                      <div class="opt">
                        <span class="o-label">Horizontal spiegeln</span>
                        <span class="o-value">{a.horizontalFlip ? 'an' : 'aus'}</span>
                      </div>
                      <div class="opt">
                        <span class="o-label">Rotation</span>
                        <span class="o-value">± {a.rotationDegrees}°</span>
                      </div>
                      <div class="opt">
                        <span class="o-label">Helligkeit</span>
                        <span class="o-value">± {a.brightnessJitter}</span>
                      </div>
                      <div class="opt">
                        <span class="o-label">Zoom</span>
                        <span class="o-value">± {a.zoomJitter}</span>
                      </div>
                      <div class="opt">
                        <span class="o-label">Extra-Kopien pro Bild</span>
                        <span class="o-value">{a.multiplier}</span>
                      </div>
                      <div class="opt">
                        <span class="o-label">Trainiert mit</span>
                        <span class="o-value">
                          {facts.effectiveExamples} Beispielen{facts.countsExact ? '' : ' (gerechnet)'}
                        </span>
                      </div>
                    </div>
                  {:else}
                    <p class="quiet">
                      Trainiert wurde ohne zusätzliche Varianten, mit
                      {facts.effectiveExamples} der {facts.totalExamples} aufgenommenen Bilder.
                    </p>
                  {/if}
                  {#if facts.validationExamples}
                    <p class="quiet">
                      {facts.validationExamples}
                      {facts.validationExamples === 1 ? 'Bild wurde' : 'Bilder wurden'} zum Prüfen
                      zurückgehalten, je Klasse ausgelost. Ihre augmentierten Varianten fallen weg,
                      damit die geprüfte Zahl nicht beschönigt wird.
                    </p>
                  {/if}
                </div>
              </div>

              <div class="card plain">
                <div class="card-head">Weitertrainieren</div>
                <p>
                  Diese Werte lassen sich in ein neues Modell übernehmen. Das bestehende Modell
                  bleibt erhalten, damit du die beiden Läufe vergleichen kannst.
                </p>
                <div class="btn-row">
                  <Button size="small" onclick={() => reuseSettings(model, true)}>
                    Einstellungen für neues Modell übernehmen
                  </Button>
                  <Button variant="ghost" size="small" onclick={() => reuseSettings(model, false)}>
                    Ohne Bildbereich übernehmen
                  </Button>
                </div>
              </div>
            {/if}
          {:else if pane === 'architecture'}
            <div class="pane-head">
              <h3>Architektur</h3>
              <span class="hint">
                Transfer-Learning · {num(facts.params)} trainierte Parameter
              </span>
            </div>

            {#if layers.length}
              <div class="card">
                <div class="card-head">Was durch das Modell läuft</div>
                <div class="layers">
                  {#each layers as l (l.index)}
                    <div class="layer" class:frozen={l.frozen}>
                      <span class="l-idx">{l.index}</span>
                      <span class="l-name">
                        {l.name}
                        {#if l.note}<span class="pill">{l.note}</span>{/if}
                      </span>
                      <span class="l-shape">{l.shape}</span>
                      <span class="l-params">{l.params != null ? num(l.params) : '–'}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="card">
              <div class="card-head">Steckbrief</div>
              <div class="opt-grid">
                <div class="opt">
                  <span class="o-label">Schichten <InfoTooltip {...INFO_TEXTS.layers} /></span>
                  <span class="o-value">{num(facts.layers)}</span>
                </div>
                <div class="opt">
                  <span class="o-label">
                    Trainierte Parameter <InfoTooltip {...INFO_TEXTS.params} />
                  </span>
                  <span class="o-value">{num(facts.params)}</span>
                </div>
                <div class="opt">
                  <span class="o-label">Modellgröße <InfoTooltip {...INFO_TEXTS.sizeBytes} /></span>
                  <span class="o-value">{bytes(facts.sizeBytes)}</span>
                </div>
                <div class="opt">
                  <span class="o-label">Eingabegröße</span>
                  <span class="o-value">224 × 224 Pixel</span>
                </div>
                <div class="opt">
                  <span class="o-label">Ausgabe</span>
                  <span class="o-value">{model.classes.length} Wahrscheinlichkeiten</span>
                </div>
                <div class="opt">
                  <span class="o-label">Modus</span>
                  <span class="o-value">{isPose ? 'Pose' : 'Objekt'}</span>
                </div>
                <div class="opt">
                  <span class="o-label">Format</span>
                  <span class="o-value">TensorFlow.js Layers</span>
                </div>
                <div class="opt">
                  <span class="o-label">Zahlenformat</span>
                  <span class="o-value">{weightDtype(model)}</span>
                </div>
              </div>
            </div>
          {:else if pane === 'history'}
            <div class="pane-head">
              <h3>Verlauf pro Epoche</h3>
              <span class="hint">
                {facts.epochsRun}
                {facts.epochsRun === 1 ? 'Epoche' : 'Epochen'}
                {facts.hasValidation ? ' · mit geprüften Werten' : ''}
              </span>
            </div>

            <div class="card">
              <div class="card-head">Kurven</div>
              <EpochChart history={model.history} />
              {#if model.history.epochs.length && !facts.hasValidation && !facts.imported}
                <p class="quiet">
                  {#if (model.options.validationSplit ?? 0) === 0}
                    Für diesen Lauf war keine Validierung eingestellt, deshalb gibt es nur die
                    Trainingswerte. Mit einem Validierungs-Anteil kommen die geprüften Kurven und
                    Spalten dazu.
                  {:else}
                    Dieser Lauf hat die geprüften Werte noch nicht mitgeschrieben — sie werden erst
                    seit kurzem gespeichert. Ein neues Training füllt die Kurven und Spalten.
                  {/if}
                </p>
              {/if}
            </div>

            {#if model.history.epochs.length}
              <div class="card">
                <div class="card-head">
                  Alle Epochen
                  <span class="hint">
                    <button class="link" onclick={() => exportHistoryCsv(model)}>
                      als CSV speichern
                    </button>
                  </span>
                </div>
                <div class="scroll-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Genauigkeit</th>
                        <th>Verlust</th>
                        {#if facts.hasValidation}
                          <th>
                            Geprüfte Genauigkeit <InfoTooltip {...INFO_TEXTS.valAccuracy} />
                          </th>
                          <th>Geprüfter Verlust</th>
                        {/if}
                      </tr>
                    </thead>
                    <tbody>
                      {#each model.history.epochs as e, i (e)}
                        <tr>
                          <td>{e}</td>
                          <td>{pct(model.history.accuracy[i], 2)}</td>
                          <td>{dec(model.history.loss[i])}</td>
                          {#if facts.hasValidation}
                            <td>{pct(model.history.valAccuracy?.[i], 2)}</td>
                            <td>{dec(model.history.valLoss?.[i])}</td>
                          {/if}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>

              {#if summary}
                <div class="card plain">
                  <div class="card-head">Zusammenfassung</div>
                  <div class="opt-grid">
                    <div class="opt">
                      <span class="o-label">Beste Genauigkeit</span>
                      <span class="o-value">
                        {pct(summary.bestAcc)} · Epoche {summary.bestAccEpoch}
                      </span>
                    </div>
                    <div class="opt">
                      <span class="o-label">Niedrigster Verlust</span>
                      <span class="o-value">
                        {dec(summary.lowLoss)} · Epoche {summary.lowLossEpoch}
                      </span>
                    </div>
                    {#if facts.hasValidation && summary.bestVal >= 0}
                      <div class="opt">
                        <span class="o-label">Bester geprüfter Wert</span>
                        <span class="o-value">
                          {pct(summary.bestVal)} · Epoche {summary.bestValEpoch}
                        </span>
                      </div>
                    {/if}
                    {#if facts.plateauEpoch != null}
                      <div class="opt">
                        <span class="o-label">Plateau ab</span>
                        <span class="o-value">Epoche {facts.plateauEpoch}</span>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            {/if}
          {:else if pane === 'confusion'}
            <div class="pane-head">
              <h3>Verwechslungen</h3>
              <span class="hint">
                {#if confusion}
                  {matrixTotal} Beispielbilder · gemessen am
                  {new Date(confusion.computedAt).toLocaleString('de-DE')}
                {:else}
                  Beispielbilder im Projekt, die zu den Klassen dieses Modells gehören
                {/if}
              </span>
            </div>

            {#if matrixError}
              <div class="card plain">
                <p>Die Matrix konnte nicht berechnet werden: {matrixError}</p>
                <div class="btn-row">
                  <Button size="small" onclick={() => startMatrix(model)}>Nochmal versuchen</Button>
                </div>
              </div>
            {:else if !confusion}
              <div class="card plain">
                <p>
                  Die Bilder werden durch das Modell geschickt. Das läuft weiter, auch wenn du
                  woanders hinsiehst oder den Dialog schließt.
                </p>
              </div>
            {:else if matrixTotal === 0}
              <div class="card plain">
                <p>
                  Im Projekt liegen keine Beispielbilder zu den Klassen dieses Modells. Bei einem
                  importierten Modell ist das normal, denn ein ZIP führt keine Bilder mit.
                </p>
              </div>
            {:else}
              <div class="card">
                <div class="card-head">Verwechslungsmatrix</div>
                <div class="cm-axis">vorhergesagt →</div>
                <div
                  class="cm"
                  style="grid-template-columns:96px repeat({matrixClasses.length}, minmax(0, 1fr))"
                >
                  <div class="hd"></div>
                  {#each matrixClasses as c (c)}
                    <div class="hd" title={c}>{c}</div>
                  {/each}
                  {#each matrix as row, i (matrixClasses[i])}
                    <div class="rl" title={matrixClasses[i]}>{matrixClasses[i]}</div>
                    {#each row as cell, j}
                      {@const rowTotal = row.reduce((a, b) => a + b, 0)}
                      {@const share = rowTotal > 0 ? cell / rowTotal : 0}
                      {@const shade =
                        i === j ? 0.08 + share * 0.72 : Math.min(0.32, 0.04 + share * 1.2)}
                      <div
                        class="cell"
                        class:diag={i === j}
                        class:inverted={shade > 0.45}
                        style="background:rgba(var(--md-on-surface), {shade})"
                      >
                        {cell}
                      </div>
                    {/each}
                  {/each}
                </div>
                <p class="quiet">
                  Zeile ist die wahre Klasse, Spalte die Vorhersage. Auf der Diagonale stehen die
                  Treffer, alles daneben sind Fehler.
                </p>
              </div>

              <div class="card">
                <div class="card-head">Pro Klasse</div>
                <table>
                  <thead>
                    <tr>
                      <th>Klasse</th>
                      <th>Erkannt <InfoTooltip {...INFO_TEXTS.recall} /></th>
                      <th>Treffgenauigkeit <InfoTooltip {...INFO_TEXTS.precision} /></th>
                      <th>Fehler</th>
                      <th>Verwechselt mit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each facts.classes as c (c.name)}
                      <tr>
                        <td>{c.name}</td>
                        <td>{c.recall != null ? pct(c.recall) : '–'}</td>
                        <td>{c.precision != null ? pct(c.precision) : '–'}</td>
                        <td>{c.errors ?? '–'}</td>
                        <td>
                          {c.confusedWith?.length
                            ? c.confusedWith.map((e) => `${e.name} (${e.count})`).join(', ')
                            : '–'}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {:else if pane === 'raw'}
            <div class="pane-head">
              <h3>Rohdaten &amp; Export</h3>
              <span class="hint">{model.id} · {bytes(facts.sizeBytes)} Gewichte</span>
            </div>

            <div class="card">
              <div class="card-head">
                Datensatz dieses Modells
                <span class="hint">
                  <button class="link" onclick={() => copy(recordJson(model), 'JSON')}>
                    JSON kopieren
                  </button>
                </span>
              </div>
              <pre>{recordJson(model)}</pre>
            </div>

            <div class="card">
              <div class="card-head">Weitergeben</div>
              <div class="btn-row">
                <Button size="small" onclick={() => onExport(model)}>Als ZIP exportieren</Button>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={!model.history.epochs.length}
                  onclick={() => exportHistoryCsv(model)}
                >
                  Verlauf als CSV
                </Button>
                <Button variant="ghost" size="small" onclick={() => copy(model.id, 'Modell-ID')}>
                  Modell-ID kopieren
                </Button>
              </div>
            </div>

            <!-- No "used by" list: no program names a model. Any of them runs on
                 this one, and which is loaded is chosen in the header. -->
          {/if}
        </div>

        <aside class="rail">
          {#if tipsOf(pane).length || (pane === 'overview' && insights.verdict)}
            <div class="rail-h">Was auffällt</div>
            {#if pane === 'overview' && insights.verdict}
              <div class="find">
                <span class="f-head">{insights.verdict.head}</span>
                {insights.verdict.body}
              </div>
            {/if}
            {#each tipsOf(pane) as tip (tip.id)}
              <div class="find">
                <span class="f-head">{tip.head}</span>
                {tip.body}
              </div>
            {/each}
            {#if stepOf(pane)}
              {@const step = stepOf(pane)}
              <div class="find next">
                <span class="f-head">{step?.head}</span>
                {step?.body}
              </div>
            {/if}
          {/if}

          <div class="rail-h" class:second={tipsOf(pane).length > 0}>Gut zu wissen</div>
          {#each knowOf(pane) as k (k.head)}
            <div class="know">
              <h5>{k.head}</h5>
              <p>{k.body}</p>
            </div>
          {/each}
        </aside>
      </div>
    {/if}
  {/snippet}

  {#snippet actions()}
    <span class="foot-note">
      {#if model}
        {model.id} · {model.classes.length}
        {model.classes.length === 1 ? 'Klasse' : 'Klassen'}
      {/if}
    </span>
    <Button onclick={close}>Schließen</Button>
  {/snippet}
</Modal>

<style lang="scss">
  .no-model {
    padding: 24px;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
  }
  .sub-line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 7px;
    border-radius: 99px;
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
    &.muted {
      background: rgba(var(--md-on-surface), 0.1);
      color: rgb(var(--md-on-surface-variant));
    }
  }
  .foot-note {
    margin-right: auto;
    font-size: 11.5px;
    color: rgb(var(--md-on-surface-variant));
  }

  // Navigation, content and the column that reads the numbers. Each of the three
  // scrolls on its own so switching panes never moves the navigation.
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 196px minmax(0, 1fr) 322px;
  }
  .nav {
    border-right: 1px solid rgb(var(--md-outline-variant));
    padding: 0 10px 16px 24px;
    overflow-y: auto;
  }
  .nav-group {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    margin: 15px 0 6px 8px;
    &:first-child {
      margin-top: 0;
    }
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    padding: 8px 10px;
    margin-bottom: 2px;
    border: none;
    box-shadow: none;
    min-height: unset;
    border-radius: var(--md-radius-sm);
    background: transparent;
    color: rgb(var(--md-on-surface));
    &:hover {
      background: rgba(var(--md-surface-variant), 0.7);
    }
    &.active {
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      font-weight: 600;
    }
  }
  .n-count {
    margin-left: auto;
    font-size: 11px;
    color: rgb(var(--md-on-surface-variant));
    font-variant-numeric: tabular-nums;
  }
  .nav-item.active .n-count {
    color: rgba(255, 255, 255, 0.72);
  }
  // Attention marker without colour, so the dialog stays monochrome.
  .n-mark {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
    font-size: 9px;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
  }
  .nav-item.active .n-mark {
    background: rgb(var(--md-on-primary));
    color: rgb(var(--md-primary));
  }

  .data {
    overflow-y: auto;
    padding: 0 20px 20px;
    min-width: 0;
  }
  .pane-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .hint {
      font-size: 11.5px;
      color: rgb(var(--md-on-surface-variant));
      margin-left: auto;
      text-align: right;
    }
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .kpi {
    background: rgba(var(--md-surface-variant), 0.5);
    border-radius: var(--md-radius-md);
    padding: 9px 12px;
    min-width: 0;
    .k-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgb(var(--md-on-surface-variant));
      display: flex;
      align-items: center;
    }
    .k-value {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .k-sub {
      font-size: 11px;
      color: rgb(var(--md-on-surface-variant));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .card {
    background: rgba(var(--md-surface-variant), 0.32);
    border-radius: var(--md-radius-md);
    padding: 10px 12px;
    margin-bottom: 12px;
    &.plain {
      background: transparent;
      border: 1px solid rgb(var(--md-outline-variant));
    }
    p {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.55;
      color: rgb(var(--md-on-surface-variant));
    }
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    .hint {
      margin-left: auto;
      text-transform: none;
      letter-spacing: 0;
      font-weight: 400;
      font-size: 11px;
    }
  }
  .quiet {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: rgb(var(--md-on-surface-variant));
  }
  .btn-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .link {
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    background: transparent;
    border: none;
    box-shadow: none;
    min-height: unset;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }

  .r {
    display: grid;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    padding: 8px 2px;
    border-bottom: 1px solid rgba(var(--md-outline-variant), 0.55);
    &:last-child {
      border-bottom: none;
    }
    &.cls {
      grid-template-columns: minmax(0, 1fr) 112px 44px 54px;
    }
    &.cls-wide {
      grid-template-columns: minmax(0, 1fr) 130px 46px 56px 74px;
    }
    &.head-row {
      border-bottom: 1px solid rgb(var(--md-outline-variant));
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: rgb(var(--md-on-surface-variant));
    }
    .nm {
      font-weight: 600;
      display: flex;
      align-items: center;
      min-width: 0;
    }
    .numc {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .subc {
      text-align: right;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      font-variant-numeric: tabular-nums;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
  }
  .head-row .subc {
    font-size: 10px;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: rgba(var(--md-on-surface), 0.1);
    overflow: hidden;
    span {
      display: block;
      height: 100%;
      border-radius: 99px;
      background: rgba(var(--md-on-surface), 0.55);
      &.weak {
        background: rgba(var(--md-on-surface), 0.28);
      }
    }
  }
  .pill {
    font-size: 10px;
    font-weight: 600;
    margin-left: 7px;
    padding: 1px 7px;
    border-radius: 99px;
    white-space: nowrap;
    flex-shrink: 0;
    background: rgba(var(--md-on-surface), 0.09);
    color: rgb(var(--md-on-surface-variant));
    text-transform: none;
    letter-spacing: 0;
  }

  .opt-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
  }
  .opt {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.45);
    min-width: 0;
    .o-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: rgb(var(--md-on-surface-variant));
      display: flex;
      align-items: center;
    }
    .o-value {
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  }
  .sub-block {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid rgb(var(--md-outline-variant));
    border-radius: var(--md-radius-sm);
  }
  .sub-h {
    display: flex;
    align-items: center;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgb(var(--md-on-surface-variant));
    font-weight: 600;
    margin-bottom: 8px;
  }

  .layers {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .layer {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto auto;
    gap: 10px;
    align-items: center;
    padding: 8px 11px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.45);
    font-size: 12.5px;
    &.frozen {
      background: transparent;
      border: 1px dashed rgb(var(--md-outline-variant));
    }
    .l-idx {
      font-size: 10px;
      color: rgb(var(--md-on-surface-variant));
      font-variant-numeric: tabular-nums;
    }
    .l-name {
      font-weight: 600;
      display: flex;
      align-items: center;
      min-width: 0;
    }
    .l-shape {
      font-size: 11.5px;
      color: rgb(var(--md-on-surface-variant));
      font-variant-numeric: tabular-nums;
    }
    .l-params {
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      min-width: 74px;
      text-align: right;
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    th,
    td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid rgba(var(--md-outline-variant), 0.55);
      vertical-align: top;
    }
    th {
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: rgb(var(--md-on-surface-variant));
      font-weight: 600;
      white-space: nowrap;
    }
    td {
      font-variant-numeric: tabular-nums;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
  }
  .scroll-table {
    max-height: 300px;
    overflow-y: auto;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.32);
  }

  // Greyscale rather than a colour ramp: the dialog carries no colour of its own.
  .cm {
    display: grid;
    gap: 3px;
    font-size: 11.5px;
    > div {
      padding: 9px 4px;
      text-align: center;
      border-radius: 4px;
      font-variant-numeric: tabular-nums;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hd {
      color: rgb(var(--md-on-surface-variant));
      font-weight: 600;
      white-space: nowrap;
    }
    .rl {
      color: rgb(var(--md-on-surface-variant));
      font-weight: 600;
      text-align: right;
      padding-right: 8px;
      white-space: nowrap;
    }
    .cell.diag {
      font-weight: 700;
    }
    // Past roughly half opacity the surface colour no longer reads on it.
    .cell.inverted {
      color: rgb(var(--md-surface));
    }
  }
  .cm-axis {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgb(var(--md-on-surface-variant));
    margin: 0 0 6px 96px;
  }

  pre {
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.45);
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    color: rgb(var(--md-on-surface));
    overflow-x: auto;
    max-height: 320px;
  }

  .rail {
    border-left: 1px solid rgb(var(--md-outline-variant));
    background: rgba(var(--md-surface-variant), 0.35);
    padding: 0 18px 20px;
    overflow-y: auto;
    min-width: 0;
  }
  .rail-h {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    margin: 0 0 9px;
    &.second {
      margin-top: 22px;
    }
  }
  // Every finding looks the same. The one call to action is inverted, not coloured.
  .find {
    background: rgb(var(--md-surface));
    border-radius: var(--md-radius-sm);
    padding: 9px 11px;
    margin-bottom: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: rgb(var(--md-on-surface-variant));
    .f-head {
      display: block;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      margin-bottom: 2px;
    }
    &.next {
      background: rgb(var(--md-primary));
      color: rgba(255, 255, 255, 0.85);
      .f-head {
        color: rgb(var(--md-on-primary));
      }
    }
  }
  .know {
    margin-bottom: 14px;
    h5 {
      margin: 0 0 3px;
      font-size: 12.5px;
      font-weight: 600;
    }
    p {
      margin: 0;
      font-size: 12px;
      line-height: 1.55;
      color: rgb(var(--md-on-surface-variant));
    }
  }

  // The camera pane can be dragged narrow, but this dialog is its own window —
  // below roughly a tablet the three columns stack instead.
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .nav,
    .rail {
      border: none;
      padding: 0 20px 12px;
      overflow: visible;
    }
    .data {
      overflow: visible;
    }
  }
</style>
