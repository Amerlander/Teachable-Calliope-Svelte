import { writable, derived } from 'svelte/store';
import { loadLocale } from 'wuchale/load-utils';
import { currentProject, type Roi } from './projects';
// Importing the loaders is what registers them with wuchale's global registry,
// so `loadLocale` below has something to load. Nothing else uses these exports.
import '../../locales/main.loader.svelte.js';
import '../../locales/js.loader.js';

// --- App mode (derived from current project — fixed per project) ---
export type AppMode = 'image' | 'pose';
export const appMode = derived(currentProject, (p): AppMode | null => p?.mode ?? null);

// --- Language ---
// `de` is wuchale's source locale (see wuchale.config.js), so its catalog is the
// source text itself and can never be missing.
export type Lang = 'de' | 'en';
export const SOURCE_LANG: Lang = 'de';
export const currentLang = writable<Lang>(SOURCE_LANG);

/**
 * Switch the UI language. The catalog has to be in place *before* the store
 * updates, otherwise the components re-render against a catalog that isn't
 * there yet and fall back to wuchale's placeholders for a frame.
 */
export async function setLang(lang: Lang): Promise<void> {
  await loadLocale(lang);
  currentLang.set(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

// --- UI overlays ---
export const showLanguageOverlay = writable(false);
export const showAIInfoOverlay = writable(false);

// --- Training UI state ---
export const trainStatus = writable<string>('Bereit');
export const isTraining = writable(false);
export const isTesting = writable(false);
export const modelTrained = writable(false);

/**
 * `localStorage`-backed writable. Reads the initial value once on construction
 * and writes back on every change. Falls back to the default when storage is
 * unavailable (SSR, private mode, etc.).
 */
function persisted<T>(key: string, initial: T): ReturnType<typeof writable<T>> {
  let start: T = initial;
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) start = JSON.parse(raw) as T;
    } catch { /* ignore */ }
  }
  const store = writable<T>(start);
  if (typeof window !== 'undefined') {
    store.subscribe((v) => {
      try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
    });
  }
  return store;
}

// --- Workspace sidebar tab: drives the camera panel mode ---
export type WorkspaceTab = 'classes' | 'model';
export const workspaceTab = persisted<WorkspaceTab>('teachable-workspace-tab', 'model');

// --- Model tab sub-view: 'model' shows stats, 'new' shows training-prep UI ---
export type ModelTabView = 'model' | 'new';
export const modelTabView = persisted<ModelTabView>('teachable-model-tab-view', 'new');

/**
 * The region the next training run will use, in camera-frame coordinates
 * (see $lib/roi); null means the whole image. It is set in the camera panel and
 * kept for the session so a second run can use the same framing. Once a run
 * finishes, the region it used belongs to that model and is read-only there —
 * this draft only ever describes the *next* model.
 */
export const draftRoi = writable<Roi | null>(null);

// --- When true, the camera shows the draft ROI with drag handles ---
export const roiEditing = writable(false);

// --- Training phase indicator: what's happening right now ---
export type TrainPhase = 'idle' | 'preparing' | 'training' | 'done' | 'error';
export const trainPhase = writable<TrainPhase>('idle');

// Epoch counter of the running training. The run is started from the sidebar
// but its progress is shown under the video, so the two numbers have to live
// outside both components.
export const trainEpoch = writable(0);
export const trainTotalEpochs = writable(0);
export const trainProgress = derived(
  [trainEpoch, trainTotalEpochs],
  ([ep, total]) => (total ? Math.min(100, Math.round((ep / total) * 100)) : 0)
);

// --- Bluetooth ---
export const btConnected = writable(false);
export const btStatusText = writable('Nicht verbunden');
export const sendEveryPrediction = writable(false);

// i18n strings
export const TRANSLATIONS: Record<string, Record<string, string>> = {
  de: {
    'header.training': 'Trainieren',
    'header.tryout': 'Programmieren',
    'header.apply': 'Anwenden',
    'header.settings': 'Einstellungen',
    'settings.camera': 'Kamera',
    'settings.language': 'Sprachen',
    'settings.aiInfo': 'KI-Hinweise',
    'settings.switchMode': 'Modus wechseln',
    'welcome.title': 'Willkommen bei\nCalliope Teachable Machine',
    'welcome.subtitle': 'Steuere deinen Calliope mini mit Objekten, Gesten oder Farben.',
    'welcome.chooseMode': 'Wähle einen Modus:',
    'welcome.modeImage': 'Objekt',
    'welcome.modeImageDesc': 'Trainiere mit Kamerabildern',
    'welcome.modePose': 'Pose',
    'welcome.modePoseDesc': 'Trainiere mit Körperposen',
    'welcome.switchModeConfirm': 'Modus wechseln? Alle aufgenommenen Daten und das trainierte Modell gehen verloren.',
    'language.title': 'Sprache auswählen',
    'training.newClass': 'Neue Klasse:',
    'training.newClassPlaceholder': 'z. B. Hand',
    'training.addClass': '+',
    'training.classes': 'Klassen:',
    'training.clickToSelect': 'Klick zum Auswählen',
    'training.downloadAll': 'Alle herunterladen',
    'training.activeClass': 'Aktive Klasse:',
    'training.startCapture': 'Aufnahme starten',
    'training.stopCapture': 'Aufnahme stoppen',
    'training.files': 'Dateien',
    'training.clear': 'Leeren',
    'training.deleteClass': 'Klasse löschen',
    'training.captureHint': 'Halte die Taste gedrückt (10 Bilder/Sekunde)',
    'training.imagesCount': 'Bilder',
    'training.train': 'Modell Trainieren',
    'training.modelDetails': 'Modell Details',
    'training.save': 'Speichern',
    'training.load': 'Laden',
    'training.downloadProject': 'Projekt herunterladen',
    'training.importProject': 'Projekt importieren',
    'training.status': 'Lädt…',
    'training.testStatus': 'Bereit zum Testen',
    'training.testButton': 'Testen',
    'training.testHint': 'Klicke zum Starten/Stoppen der Echtzeit-Vorhersage',
    'training.model': 'Modell:',
    'training.epochs': 'Epochen:',
    'tryout.loadModelTitle': 'Modell laden',
    'tryout.uploadModel': 'Modell hochladen',
    'tryout.calliopeConnection': 'Calliope mini Verbindung',
    'tryout.notConnected': 'Nicht verbunden',
    'tryout.connect': 'Verbinden',
    'tryout.disconnect': 'Trennen',
    'tryout.sendEveryPrediction': 'Jede Klasse dauerhaft senden (ab 70% Wahrscheinlichkeit)',
    'makecode.programmingMode': 'Programmiermodus',
    'makecode.modeBlocks': 'Blöcke',
    'makecode.share': 'Teilen',
    'makecode.shareProgram': 'Programm teilen',
    'makecode.sharingInProgress': 'Wird geteilt…',
    'makecode.extensions': 'Erweiterungen',
    'makecode.extension': 'Erweiterung',
    'makecode.noExtensionsAdded': 'Keine Erweiterungen hinzugefügt',
    'makecode.openOnGithub': 'Auf GitHub öffnen',
    'makecode.removeExtension': 'Erweiterung entfernen',
    'makecode.calliopeMiniVersion': 'Calliope mini Version',
    'makecode.shareModalTitle': 'Programm teilen',
    'makecode.shareCreatingLink': 'Link wird erstellt…',
    'makecode.shareIntroBefore': 'Jeder mit diesem Link kann ',
    'makecode.shareIntroAfter': ' öffnen und kopieren.',
    'makecode.shareThisProgram': 'dieses Programm',
    'makecode.shareLinkAria': 'Link zum Programm',
    'makecode.shareCopyLink': 'Link kopieren',
    'makecode.shareLinkCopied': 'Link kopiert',
    'makecode.shareCopyFailed': 'Kopieren fehlgeschlagen',
    'makecode.shareQrAlt': 'QR-Code zum Programm',
    'makecode.shareClose': 'Schließen',
    'makecode.shareOpen': 'Öffnen',
    'makecode.shareFailed': 'Der Link konnte nicht erstellt werden. Versuche es später erneut.',
    'connection.connected': 'Verbunden',
    'connection.connecting': 'Verbinde…',
    'connection.flashing': 'Flashe',
    'connection.error': 'Fehler',
    'connection.unsupported': 'Nicht unterstützt',
    'connection.unsupportedHint': 'WebUSB wird von diesem Browser nicht unterstützt. Bitte Chrome, Edge oder Opera verwenden.',
    'connection.partialFlash': 'Partielles Flashen',
    'connection.fullFlash': 'Vollständiges Flashen',
    'connection.lastFlash': 'Zuletzt geflasht',
    'connection.phase.check': 'Calliope prüfen…',
    'connection.phase.reboot': 'Calliope neu starten…',
    'connection.phase.prepare': 'Calliope vorbereiten…',
    'connection.phase.finalising': 'Abschließen…',
    'detail.currentDetection': 'Aktuelle Erkennung',
    'detail.noDetection': 'Noch keine Erkennung.',
    'detail.log': 'Kommunikation',
    'detail.logEmpty': 'Keine Nachrichten.',
    'detail.clear': 'Leeren',
    'programs.title': 'Programme',
    'programs.empty': 'Noch kein Programm gespeichert.',
    'programs.new': 'Neues Programm',
    'programs.rename': 'Umbenennen',
    'programs.delete': 'Löschen',
    'programs.outdated': 'veraltet',
    'programs.outdatedHint':
      'Dieses Programm wurde mit anderen Klassen erstellt. Die eingebettete Erweiterung bleibt unverändert; erstelle ein neues Programm, um die aktuellen Klassen zu verwenden.',
    'apply.layerClasses': 'Klassen',
    'apply.layerDetection': 'Erkennung',
    'apply.layerAngles': 'Winkel',
    'apply.layerDistances': 'Abstände',
    'apply.layerCoords': 'Koordinaten',
    'dialogs.importTitle': 'Bilder importieren',
    'dialogs.importMessage': 'Wähle eine Klasse für die importierten Bilder:',
    'dialogs.cancel': 'Abbrechen',
    'dialogs.import': 'Importieren',
    'dialogs.modelDetailsTitle': 'Modell-Details',
    'pose.hideCamera': 'Kamera ausblenden',
    'pose.showCamera': 'Kamera anzeigen',
  },
  en: {
    'header.training': 'Train',
    'header.tryout': 'Program',
    'header.apply': 'Apply',
    'header.settings': 'Settings',
    'settings.camera': 'Camera',
    'settings.language': 'Languages',
    'settings.aiInfo': 'AI Information',
    'settings.switchMode': 'Switch Mode',
    'welcome.title': 'Welcome to\nCalliope Teachable Machine',
    'welcome.subtitle': 'Control your Calliope mini with objects, gestures or colours.',
    'welcome.chooseMode': 'Choose a mode:',
    'welcome.modeImage': 'Object',
    'welcome.modeImageDesc': 'Train with camera images',
    'welcome.modePose': 'Pose',
    'welcome.modePoseDesc': 'Train with body poses',
    'welcome.switchModeConfirm': 'Switch mode? All captured data and the trained model will be lost.',
    'language.title': 'Select language',
    'training.newClass': 'New class:',
    'training.newClassPlaceholder': 'e.g. Hand',
    'training.addClass': '+',
    'training.classes': 'Classes:',
    'training.clickToSelect': 'Click to select',
    'training.downloadAll': 'Download all',
    'training.activeClass': 'Active class:',
    'training.startCapture': 'Start capture',
    'training.stopCapture': 'Stop capture',
    'training.files': 'Files',
    'training.clear': 'Clear',
    'training.deleteClass': 'Delete class',
    'training.captureHint': 'Hold to capture (10 images/sec)',
    'training.imagesCount': 'Images',
    'training.train': 'Train model',
    'training.modelDetails': 'Model details',
    'training.save': 'Save',
    'training.load': 'Load',
    'training.downloadProject': 'Download project',
    'training.importProject': 'Import project',
    'training.status': 'Loading…',
    'training.testStatus': 'Ready to test',
    'training.testButton': 'Test',
    'training.testHint': 'Click to start/stop live prediction',
    'training.model': 'Model:',
    'training.epochs': 'Epochs:',
    'tryout.loadModelTitle': 'Load model',
    'tryout.uploadModel': 'Upload model',
    'tryout.calliopeConnection': 'Calliope mini connection',
    'tryout.notConnected': 'Not connected',
    'tryout.connect': 'Connect',
    'tryout.disconnect': 'Disconnect',
    'tryout.sendEveryPrediction': 'Send every class continuously (≥70% confidence)',
    'makecode.programmingMode': 'Programming mode',
    'makecode.modeBlocks': 'Blocks',
    'makecode.share': 'Share',
    'makecode.shareProgram': 'Share program',
    'makecode.sharingInProgress': 'Sharing…',
    'makecode.extensions': 'Extensions',
    'makecode.extension': 'Extension',
    'makecode.noExtensionsAdded': 'No extensions added',
    'makecode.openOnGithub': 'Open on GitHub',
    'makecode.removeExtension': 'Remove extension',
    'makecode.calliopeMiniVersion': 'Calliope mini version',
    'makecode.shareModalTitle': 'Share program',
    'makecode.shareCreatingLink': 'Creating link…',
    'makecode.shareIntroBefore': 'Anyone with this link can open and copy ',
    'makecode.shareIntroAfter': '.',
    'makecode.shareThisProgram': 'this program',
    'makecode.shareLinkAria': 'Link to the program',
    'makecode.shareCopyLink': 'Copy link',
    'makecode.shareLinkCopied': 'Link copied',
    'makecode.shareCopyFailed': 'Copying failed',
    'makecode.shareQrAlt': 'QR code for the program',
    'makecode.shareClose': 'Close',
    'makecode.shareOpen': 'Open',
    'makecode.shareFailed': 'The link could not be created. Please try again later.',
    'connection.connected': 'Connected',
    'connection.connecting': 'Connecting…',
    'connection.flashing': 'Flashing',
    'connection.error': 'Error',
    'connection.unsupported': 'Not supported',
    'connection.unsupportedHint': 'WebUSB is not supported by this browser. Please use Chrome, Edge or Opera.',
    'connection.partialFlash': 'Partial flash',
    'connection.fullFlash': 'Full flash',
    'connection.lastFlash': 'Last flash',
    'connection.phase.check': 'Checking Calliope…',
    'connection.phase.reboot': 'Rebooting Calliope…',
    'connection.phase.prepare': 'Preparing Calliope…',
    'connection.phase.finalising': 'Finalising…',
    'detail.currentDetection': 'Current detection',
    'detail.noDetection': 'No detection yet.',
    'detail.log': 'Communication',
    'detail.logEmpty': 'No messages.',
    'detail.clear': 'Clear',
    'programs.title': 'Programs',
    'programs.empty': 'No program saved yet.',
    'programs.new': 'New program',
    'programs.rename': 'Rename',
    'programs.delete': 'Delete',
    'programs.outdated': 'outdated',
    'programs.outdatedHint':
      'This program was created with different classes. Its embedded extension is kept unchanged; create a new program to use the current classes.',
    'apply.layerClasses': 'Classes',
    'apply.layerDetection': 'Detection',
    'apply.layerAngles': 'Angles',
    'apply.layerDistances': 'Distances',
    'apply.layerCoords': 'Coordinates',
    'dialogs.importTitle': 'Import images',
    'dialogs.importMessage': 'Choose a class for the imported images:',
    'dialogs.cancel': 'Cancel',
    'dialogs.import': 'Import',
    'dialogs.modelDetailsTitle': 'Model Details',
    'pose.hideCamera': 'Hide camera',
    'pose.showCamera': 'Show camera',
  }
};

export function t(key: string, lang: string): string {
  return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS['de']?.[key] ?? key;
}
