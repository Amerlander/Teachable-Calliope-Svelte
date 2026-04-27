Klares Konzept entlang deiner Vorgaben:

Firmware bleibt unverändert — core-mini-codal/pxt.json Defaults (security_level=NO_MITM, whitelist=1, partial_flashing=1) werden nicht angefasst, damit Mobile-Apps nicht brechen.
MakeCode bleibt unverändert — eingebettet als iframe mit ?controller=2, postet Hex per postMessage an Teachable (vorhandener nativeHostDeployCoreAsync-Pfad in pxt/webapp/src/cmds.ts:177-197).
Drei Modi in Teachable, vom User wählbar:
USB: heute schon
BLE-vollständig: setzt einmaliges OS-Pairing voraus (Just Works, meist transparent), Flash über Partial-Flashing-Service e97dd91d-…
BLE-hybrid: BLE für UART, beim Flash kommt ein Modal "bitte Calliope per USB anstecken" — danach geht's automatisch auf BLE zurück
Auto-Übergang: connect() wirft SecurityError/Timeout → User-Frage "auf BLE-hybrid wechseln?" statt harter Error-State.
Sechs Schritte, jeder einzeln testbar, geschätzt 4–5 Entwickler-Tage gesamt:

iframe einbinden + download-Message empfangen
Transport-Auswahl-UI
BLE-Partial-Flashing-Modul (Port der MakeCode-Klasse aus pxt/pxtlib/webble.ts:266-650)
Hybrid-Modus mit USB-Prompt
Fehler-Übergänge & Filter-Straffung
Diagnose/Logging
Konkrete Code-Stellen für jeden Schritt sind verlinkt; explizit aufgelistet, was bewusst aufgeschoben wird (Workspace-Persistenz, Serial-Bridge ins iframe, MicroPython-BLE, DAL).



# BLE-Flashen — Zwischenlösung mit OS-Pairing

> **Strategie (final).** Firmware und MakeCode bleiben unverändert. Calliope mini 3 läuft mit Default-CODAL-Settings (`security_level = NO_MITM`, `whitelist = 1`, `partial_flashing = 1` — siehe [`pxt-calliope/libs/core/pxt.json:114-132`](../../MAKECODE/pxt-calliope/libs/core/pxt.json#L114-L132) und [`core-mini-codal/pxt.json:25-42`](../../MAKECODE/pxt-calliope/libs/core-mini-codal/pxt.json#L25-L42)). MakeCode wird einfach mit `?controller=2` in **Teachable** als iframe eingebettet und liefert per `postMessage` das Hex.
>
> **Teachable** macht alle Geräte-Kommunikation: USB oder BLE. BLE-Flash funktioniert nur, wenn der User den Calliope einmalig auf OS-Ebene gepaart hat ("Just Works", kein PIN). Wer das nicht kann/will, fährt **Hybrid**: BLE für die Live-Kommunikation, beim Flashen prompt zum USB-Anstecken, danach zurück auf BLE.
>
> Begleitdokumente: [USB-BLE-STRATEGY.md](USB-BLE-STRATEGY.md), [USB-BLE-OPTIONS-FIRMWARE.md](USB-BLE-OPTIONS-FIRMWARE.md), [UNIFIED-HOST-EDITOR-CONCEPT.md](UNIFIED-HOST-EDITOR-CONCEPT.md). Diese Datei ersetzt [BLE-FLASH-TODO.md](BLE-FLASH-TODO.md) als aktiver Plan.

## 0. Was wir explizit **nicht** anfassen

- **CODAL-Firmware**: Default bleibt. Kein Open-Modus, kein Whitelist-aus, keine Encryption-aus — sonst brechen Android- und iOS-App, die Verschlüsselung des Partial-Flashing-Service voraussetzen. Die OS-Bond-Pflicht ist Feature, nicht Bug.
- **MakeCode**: keine PR gegen `pxt`/`pxt-calliope`. Wir benutzen den vorhandenen `controller=2`-Pfad ([`pxt/webapp/src/cmds.ts:177-197`](../../MAKECODE/pxt/webapp/src/cmds.ts#L177-L197)).
- **Mobile Apps**: außerhalb des Scopes. Sie funktionieren weiterhin, weil sie auf OS-Ebene eh bonden.

## 1. Drei Modi für Teachable

Der User wählt im UI einen dieser Modi (Default-Auswahl: Auto-Detect basierend auf `navigator.bluetooth`/`navigator.usb`):

| Modus | Flashen | Live-Kommunikation | Voraussetzung |
|---|---|---|---|
| **USB** | WebUSB / DAPLink, partial-flash (heute schon) | USB-CDC-Serial (heute schon) | USB-Kabel angeschlossen |
| **BLE-vollständig** | BLE Partial Flashing Service `e97dd91d-…` | Nordic UART | Calliope ist auf OS-Ebene gepairt (Bond existiert) |
| **BLE-hybrid** | USB (Prompt zum Anstecken bei jedem Flash) | Nordic UART ohne Bond | OS-Pairing nicht möglich oder verweigert |

Schaltbar zur Laufzeit. Zustand persistieren in `localStorage`.

### Übergänge
```
   ┌────────────┐  Pair klappt    ┌────────────────┐
   │   Auto     │ ───────────────▶│ BLE-vollständig│
   └────────────┘                  └────────────────┘
        │                                  ▲ ▼ Pair-Daten weg / Reichweite
        │ Pair scheitert / nicht möglich   │
        ▼                                  │
   ┌────────────┐ ◀────────────────────────┘
   │ BLE-hybrid │  bei Flash → kurzer USB-Block, dann zurück
   └────────────┘
        │ User wählt manuell
        ▼
   ┌────────────┐
   │   USB      │
   └────────────┘
```

## 2. Konkrete Schritte in Teachable

Reihenfolge so, dass nach jedem Schritt etwas Sicht- und Testbares vorliegt.

### Schritt 1 — MakeCode als iframe einbetten (kein Geräte-Bezug, isoliert testbar)
**Aufwand: ~0,5 Tag.**

- [ ] Komponente `src/lib/components/MakeCodeFrame.svelte` mit:
  ```svelte
  <iframe
    src="https://makecode.calliope.cc/?controller=2&hidemenu=1&lang=de"
    sandbox="allow-scripts allow-same-origin allow-popups"
    bind:this={frame}
  />
  ```
- [ ] `window.addEventListener('message', onMessage)` — Filtern auf `event.source === frame.contentWindow`, dann Cases:
  - `event.data.download && event.data.name` → Hex + Name an Connection-Store weiterreichen.
  - `event.data.save && event.data.name` → später, wenn wir Projekte persistieren wollen.
  - `event.data.type === 'pxteditor'` mit `id`/`action` → für `workspacesync`/`workspacesave` (optional, für Projekt-Persistenz).
- [ ] Event "Hex empfangen" als Svelte-Action/Store-Event modellieren, damit der Flash-Pfad daran hängen kann ohne den iframe direkt zu kennen.
- [ ] Akzeptanztest: in MakeCode "Download" klicken → Teachable loggt `Hex received: <name>, <bytes>`. Noch kein Flash.

### Schritt 2 — Transport-Auswahl-UI (UX, isoliert testbar)
**Aufwand: ~0,5 Tag.**

- [ ] In der Connection-Bar (oder als Dropdown am Connect-Button): drei Modi auswählbar.
- [ ] Persistenz: `localStorage.getItem('calliope.transport')` mit `'usb' | 'ble-full' | 'ble-hybrid'`.
- [ ] State-Machine im Store: `transportMode` zusätzlich zum bestehenden `activeTransport`.
- [ ] Anzeige: aktiver Transport als Icon/Text, neben dem Verbindungs-Status.
- [ ] Akzeptanztest: Modus-Wechsel ohne Verbindung verändert den State und ein erneutes "Connect" benutzt den neu gewählten Pfad.

### Schritt 3 — BLE-vollständig: Partial-Flashing-Service in Teachable
**Aufwand: ~2 Tage. Kernschritt.**

- [ ] Neue Datei `src/lib/ble/profile.ts` mit den UUID-Konstanten:
  ```ts
  export const PARTIAL_FLASH_SERVICE = 'e97dd91d-251d-470a-a062-fa1922dfa9a8';
  export const PARTIAL_FLASH_CHAR    = 'e97d3b10-251d-470a-a062-fa1922dfa9a8';
  export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  export const NUS_TX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  export const NUS_RX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  ```
- [ ] Neue Datei `src/lib/ble/partial-flashing.ts`. Implementierung als TypeScript-Port der MakeCode-Klasse [`pxt/pxtlib/webble.ts:266-650`](../../MAKECODE/pxt/pxtlib/webble.ts#L266-L650). Funktionsumfang:
  - `getStatus()` (Cmd `0xEE`) → Microbit-Mode + PFS-Version lesen.
  - `getRegionInfo(region)` (Cmd `0x00`) für Region 1 (CODAL) und Region 2 (MakeCode).
  - **Hash-Vergleich:** im Hex den Magic-Marker `708E3B92C615A841C49866C975EE5197` finden, DAL-Hash dahinter extrahieren, mit dem Geräte-Hash aus Region 1 vergleichen. Mismatch ⇒ User-Hinweis "DAL passt nicht — bitte einmal voll per USB flashen".
  - `flashData(addr, payload[16])` (Cmd `0x01`): Pakete einzeln schreiben, Notify-Bestätigung pro 64-Byte-Block (4 Pakete) abwarten, Sequenznummer.
  - `endOfTransmission()` (Cmd `0x02`).
- [ ] `requestDevice` mit `optionalServices: [PARTIAL_FLASH_SERVICE, NUS_SERVICE]` aufrufen, sonst wirft `getPrimaryService` `SecurityError` (siehe heutige UART-Logik in [`connection.ts:345-389`](../src/lib/stores/connection.ts#L345-L389)).
- [ ] Bei diesem `connect()` löst der Browser die OS-Bond-Anforderung aus. Auf macOS/Linux/Android oft transparent ("Just Works"). Auf Windows kann eine System-Notification erscheinen ("Pair this device?") — beides ist OK.
- [ ] In [`connection.ts:563-672`](../src/lib/stores/connection.ts#L563-L672) `flashCalliope()` umbauen:
  ```ts
  if (transportMode === 'ble-full') {
    return flashCalliopeViaBle(hex, name);  // neu
  }
  if (transportMode === 'ble-hybrid') {
    return flashCalliopeHybrid(hex, name);  // neu, siehe Schritt 4
  }
  // Default: USB-Pfad wie heute
  ```
  Den heutigen erzwungenen Wechsel auf USB (Z. 570–572) **nicht** entfernen, sondern in den USB-Fall einrücken.
- [ ] Reconnect nach Flash: das Gerät rebootet, Bond bleibt erhalten — nach ~1.6 s reconnect, UART neu öffnen.
- [ ] Akzeptanztest: ohne USB-Kabel, Calliope einmalig OS-gepairt, MakeCode-Compile → Hex landet via BLE auf dem Gerät, Programm läuft, UART-Daten kommen in Teachable an.

### Schritt 4 — BLE-hybrid: Flash über USB, Kommunikation über BLE
**Aufwand: ~1 Tag. UX-lastig.**

- [ ] Im Hybrid-Modus auf einkommendes `download`-Event aus Schritt 1:
  1. BLE-Verbindung **nicht** trennen (UART bleibt offen, falls aktiv — bei manchen DAPLink-Boards stört der USB-Anschluss BLE nicht).
  2. Modal/Bar einblenden: "Bitte Calliope per USB anstecken — dann auf 'Flashen' klicken."
  3. Auf User-Klick: `requestDevice` (WebUSB) wenn noch keine USB-Verbindung steht, dann normaler USB-Flash-Pfad (Schritt 1 von [USB-BLE-STRATEGY.md §3](USB-BLE-STRATEGY.md)).
  4. Nach Flash: USB-Verbindung schließen, BLE prüfen — bei Verlust einmal reconnecten.
  5. Modal schließt sich, "Flash erfolgreich".
- [ ] Optional: Hinweis im Modal "Du kannst diesen Schritt überspringen, wenn du in den Bluetooth-Einstellungen deines Computers ein Pairing einrichtest". Link auf eine Plattform-spezifische Anleitung (Windows/macOS/Linux/Android).
- [ ] Beim **erstmaligen** Wechsel auf BLE-hybrid (Auto-Detect-Heuristik nach Pairing-Fehler oder explizite User-Wahl): einmalig erklären, was der Modus tut.
- [ ] Akzeptanztest: BLE-hybrid aktiv, USB-Kabel ab, MakeCode-Compile → Modal kommt, Kabel anstecken, Flash läuft, danach BLE-Kommunikation läuft weiter.

### Schritt 5 — Auto-Detect & Fehler-Übergänge
**Aufwand: ~0,5 Tag. UX-Politur.**

- [ ] Beim Connect-Versuch in `ble-full`:
  - `connect()`-Timeout 7 s.
  - Wirft `connect()` `SecurityError` oder Timeout: User fragen "Pairing nicht möglich — auf BLE-hybrid wechseln?" → bei Ja Modus umstellen, sonst auf USB fallback.
- [ ] Beim Versuch, einen unencrypted-only Service auf einem unbonded Peer zu lesen, kommt `NotSupportedError` — dasselbe Modal anbieten.
- [ ] Reconnect-Backoff (1/2/3 s, max 3 Versuche) bei Disconnect, Vorlage [`PartialFlashingService.kt:1138-1229`](../../Calliope-Android-App/app/src/main/java/cc/calliope/mini/core/service/partialflashing/PartialFlashingService.kt#L1138).
- [ ] Filter-Liste straffen ([`connection.ts:281`](../src/lib/stores/connection.ts#L281)): nur `Calliope mini` als Default — heute werden auch micro:bit-Boards angeboten, was das Pair-Erlebnis verwirrt.

### Schritt 6 — Diagnose & Logging
**Aufwand: ~0,5 Tag. Wichtig für die spätere Stabilität.**

- [ ] Bei jedem Flash: Transport, Größe, Dauer, Erfolg/Fehler in den bereits vorhandenen Log-Stream ([`connection.ts:appendLog`](../src/lib/stores/connection.ts)) schreiben.
- [ ] Bei BLE-Fehlern: GATT-Statuscode klassifizieren ("Reichweite/Akku" vs. "Bond fehlt" vs. "Service nicht da"), klar kommunizieren.
- [ ] Optional Telemetrie (anonyme Counter), damit wir wissen, wie oft welcher Modus benutzt wird und wo er scheitert. Heute haben wir diese Daten gar nicht.

## 3. Zwischen-Akzeptanzkriterien

Nach den Schritten 1–3 (Minimum Viable):
- [ ] MakeCode-iframe lädt, "Download"-Klick liefert Hex an Teachable.
- [ ] Auf einem **OS-gepairten** Calliope mini 3: Flash via BLE klappt, ≥ 90 % Erfolg über 20 aufeinander folgende Flashes (≤ 1 m Abstand).
- [ ] USB-Pfad unverändert.

Nach Schritten 4–6 (Robust):
- [ ] BLE-hybrid funktioniert: BLE-UART aktiv, USB-Anstecken-Prompt beim Flash, danach BLE wieder.
- [ ] Pair-Fehler im BLE-vollständig-Modus führen automatisch zu einem nutzbaren Fallback, nicht zu einem `error`-State.
- [ ] Log enthält genug Information, dass ein:e Lehrer:in einen Fehler an uns durchstellen kann.

## 4. Was offen bleibt (bewusst aufgeschoben)

- **Workspace-Persistenz im iframe** (`workspacesync`/`workspacesave`). Brauchen wir nur, wenn Projekte über Sessions hinweg bestehen sollen. Bis dahin: Compile-Resultat ist die einzige interessante Antwort.
- **Serial-from-Device durch das iframe an MakeCode**. Cross-Origin nicht möglich. Wenn wir das wollen, müssen wir MakeCode auf eigener Subdomain hosten — separates Thema.
- **MicroPython-BLE-Flash**. Anderes Region-Schema, andere Magic-Marker, brauchen wir für Teachable nicht.
- **DAL-Geräte (Calliope mini V1/V2)**. Diese laufen mit alter Firmware, die sich vom CODAL-Default unterscheidet — bleiben USB-only bis auf weiteres.
- **Entscheidung "MakeCode standalone soll selbst BLE flashen"**. Aktuell deaktiviert — lieber konsistent, dass nur Teachable als Host flasht.

## 5. Reihenfolge (Empfehlung, ein:e Entwickler:in)

1. Schritt 1 (iframe) — **isoliert, niedriges Risiko**, bringt sofort sichtbares Ergebnis.
2. Schritt 2 (Transport-UI) — UX-Gerüst, blockiert nichts.
3. Schritt 3 (BLE-Flash) — Kernarbeit; Port der MakeCode-Klasse + Verdrahtung in `connection.ts`.
4. Schritt 5 (Fehler-Übergänge) — sobald Schritt 3 läuft, Pair-Failures sauber abfangen.
5. Schritt 4 (BLE-hybrid) — für Geräte/Umgebungen ohne stabiles Pairing.
6. Schritt 6 (Diagnose) — die ganze Zeit über mitführen, am Ende politur.

**Gesamt-Aufwand:** 4–5 Entwickler-Tage für eine stabile Zwischenlösung. Alles andere (Firmware-Optionen, Host-Editor-Protokoll, mobile App-Konvergenz) ist explizit eine spätere Iteration.
