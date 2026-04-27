Was schon existiert (kein Neuschreiben):

MakeCode hat in pxt/pxtlib/webble.ts:266 eine vollständige PartialFlashingService-Klasse. Web Bluetooth + Service e97dd91d-…. Heute nur als Experiment (bluetoothPartialFlashing), aktiviert in pxt-calliope/pxtarget.json:462-466.
CODAL hat den MicroBitPartialFlashingService, in MakeCode-Builds per Default an.
Sicherheitsmodell ist eine zentrale Stellschraube: in MicroBitBLEService.cpp:125-127 setzt CreateCharacteristic automatisch read/write/cccd_access auf MICROBIT_BLE_SECURITY_MODE — eine globale Define-Änderung schaltet alles um.
Konkret zu tun, kompakt:

CODAL (~5 Zeilen Konfig, 30 Min): MICROBIT_BLE_SECURITY_MODE=1 + MICROBIT_BLE_WHITELIST=0 + MICROBIT_BLE_PARTIAL_FLASHING=1 (oder das vorhandene Sammel-Flag MICROBIT_BLE_OPEN=1). Eigene "Browser-Flash"-Build-Variante, nicht den Default ändern.

MakeCode: zwei Wege, nicht-exklusiv —

Weg A: bluetoothPartialFlashing aus experiments zu enabledFeatures heben (~3 Zeilen in pxtarget.json) + appTheme.bluetoothPartialFlashing=true. Dann kann MakeCode standalone direkt aus dem Browser BLE-flashen.
Weg B: gar kein Patch — Teachable bettet MakeCode mit ?controller=2 ein, der vorhandene nativeHostDeployCoreAsync-Pfad in pxt/webapp/src/cmds.ts:177-197 postet das Hex automatisch an window.parent.
Teachable: BLE-Flash-Pfad einbauen (Port der MakeCode- oder Android-Implementierung, beides liegt vor), Z. 570–572 in connection.ts entzwingen den USB-Switch, BLE-Stabilität (Filter-Liste, Backoff, Timeout), iframe-Embed mit controller=2.

Kritischer Pfad: §1.1 (CODAL-Build) → §1.2 (Verify mit nRF Connect) — ohne offene Firmware scheitert der ganze Browser-Pfad am Bonding. Ist das verifiziert, sind die anderen Schritte unabhängig.






# BLE-Flashen im Browser — konkrete TODO-Liste

> Scope: Teachable-Calliope-Svelte + Calliope-Campus laufen als Webseite in **Chrome/Edge** (Web Bluetooth + WebUSB). Wir machen **keine** native App. Editoren bleiben in ihrem eigenen Kommunikations-Modell, der "Host" (Teachable bzw. Campus) reicht durch oder ergänzt — beides ist erlaubt, was im jeweiligen Schritt einfacher ist. **Firmware-Fokus: CODAL** (`FIRMWARE/codal-microbit-v2`, betrifft Calliope mini V3). Calliope mini V1/V2 (DAL) sind außen vor.
>
> Begleitdokumente: [USB-BLE-STRATEGY.md](USB-BLE-STRATEGY.md) (Drei-Stufen-Plan), [USB-BLE-OPTIONS-FIRMWARE.md](USB-BLE-OPTIONS-FIRMWARE.md) (Firmware-Hintergründe), [UNIFIED-HOST-EDITOR-CONCEPT.md](UNIFIED-HOST-EDITOR-CONCEPT.md) (Architektur-Vision).

## Was schon da ist (kein Code-Schreiben nötig)

- **MakeCode kann BLE-Flashen.** [`MAKECODE/pxt/pxtlib/webble.ts:266`](../../MAKECODE/pxt/pxtlib/webble.ts#L266) implementiert die `PartialFlashingService`-Klasse vollständig (Service `e97dd91d-251d-470a-a062-fa1922dfa9a8`, Char `e97d3b10-…`, Cmds `STATUS / FLASH_DATA / END`, Magic-Marker-Suche, DAL-Hash-Vergleich). Aktiviert wird sie über das Experiment-Flag `bluetoothPartialFlashing`.
- **pxt-calliope-Target hat das Flag bereits** in [`MAKECODE/pxt-calliope/pxtarget.json:462-466`](../../MAKECODE/pxt-calliope/pxtarget.json#L462-L466) — als **Experiment**, das User in den Settings aktivieren müssten.
- **CODAL-Firmware enthält den `MicroBitPartialFlashingService`** in [`FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitPartialFlashingService.cpp`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitPartialFlashingService.cpp) und ist per `MICROBIT_BLE_PARTIAL_FLASHING=1` in `codal.json` aktivierbar (siehe [`docs/bluetooth/MicroBitPartialFlashing.md`](../../FIRMWARE/codal-microbit-v2/docs/bluetooth/MicroBitPartialFlashing.md)).
- **Sicherheits-Mapping ist zentral**: in [`source/bluetooth/MicroBitBLEService.cpp:125-127`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEService.cpp#L125-L127) setzt `CreateCharacteristic` automatisch `read_access`, `write_access`, `cccd_write_access` auf `MICROBIT_BLE_SECURITY_MODE`. Eine globale Defines-Änderung schaltet **alle** Characteristics um.

Daraus folgt: der schmalste Pfad ist eine **CODAL-Build-Konfiguration**, die GATT auf "open" stellt + im Browser den vorhandenen MakeCode-Code nutzen (oder, falls Teachable selbst flashen soll, dieselbe Logik kopieren).

---

## 1. CODAL-Firmware (`FIRMWARE/codal-microbit-v2`)

Ziel: Browser kann sich verbinden, ohne dass das OS einen Bond/Pairing-Dialog auslöst, und kann den Partial-Flashing-Service direkt schreiben/notifizieren.

### 1.1 Konfig anpassen (1 Datei, ~5 Zeilen)
- [ ] **`MICROBIT_BLE_SECURITY_MODE = 1`** ("OPEN_LINK") setzen — entweder via `codal.json`-`config`-Block oder als `-DMICROBIT_BLE_SECURITY_MODE=1` Compile-Define.
   - **Wirkung:** [`MicroBitBLEService.cpp:125-127`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEService.cpp#L125-L127) — alle Char-Permissions sind ohne Encryption nutzbar. Kein OS-Pair-Dialog.
- [ ] **`MICROBIT_BLE_WHITELIST = 0`** setzen.
   - **Wirkung:** [`MicroBitBLEManager.cpp:411-424`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L411-L424) — `pm_whitelist_set(NULL, 0)`-Pfad statt der Bond-basierten Liste; jeder Peer in Reichweite kann verbinden, kein stilles Verwerfen am Link-Layer.
- [ ] **`MICROBIT_BLE_PARTIAL_FLASHING = 1`** sicherstellen (Default in MakeCode-Builds, bei eigenem Codal-Programm explizit setzen).
- [ ] Optional, aber bequem: **`MICROBIT_BLE_OPEN = 1`** als Sammel-Define statt der Einzelnen — setzt SECURITY_MODE=1, WHITELIST=0, ADVERTISING_TIMEOUT=0 in einem Schritt ([`MicroBitConfig.h:184-194`](../../FIRMWARE/codal-microbit-v2/inc/MicroBitConfig.h#L184-L194)).
- [ ] **Build-Variante separat ausliefern** ("Calliope Browser-Flash"), nicht den Default ändern. Klassenraum-Risiko Drive-by-Flash siehe [USB-BLE-OPTIONS-FIRMWARE.md §1](USB-BLE-OPTIONS-FIRMWARE.md).

### 1.2 Verify-Schritt
- [ ] Mit `nRF Connect` (Mobile/Desktop) prüfen: nach `connect` erscheint Service `e97dd91d-…` direkt **ohne Pairing-Dialog**, Char `e97d3b10-…` lässt sich beschreiben.
- [ ] In Chrome `chrome://bluetooth-internals` öffnen, `requestDevice({filters:[{namePrefix:'Calliope mini'}], optionalServices:['e97dd91d-251d-470a-a062-fa1922dfa9a8']})` → GATT-Connect, Service-Discovery prüfen.

### 1.3 Optional: User-Feedback bei Connect
- [ ] LED-Symbol kurz anzeigen, wenn ein Peer verbindet — sichtbares Signal "ich rede gerade mit dem Browser". 5–10 Zeilen in `microbit_ble_evt_handler` bei `BLE_GAP_EVT_CONNECTED` ([`MicroBitBLEManager.cpp:1300+`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L1300)).

**Aufwand:** ~30 Min Konfig + ein Build-Run (~10 Min mit Docker-Image in [`FIRMWARE/codal-microbit-v2/docker/`](../../FIRMWARE/codal-microbit-v2/docker/)).

---

## 2. MakeCode (`MAKECODE/pxt-calliope` + ggf. `MAKECODE/pxt`)

Es gibt **zwei Wege**, je nachdem ob MakeCode selbst flashen soll oder ob Teachable den Flash übernimmt.

### Weg A — MakeCode selbst flasht (eigenständig auf [makecode.calliope.cc](https://makecode.calliope.cc))

Minimaler Pfad: das Experiment "Bluetooth Download" zur Default-Funktion machen.

- [ ] **Experiment aus dem `experiments`-Array nach `enabledFeatures` heben** in [`pxt-calliope/pxtarget.json:462-466`](../../MAKECODE/pxt-calliope/pxtarget.json#L462-L466).
   - Heute: User muss manuell unter ⚙️ → Experiments → "Bluetooth Download" einschalten.
   - Ziel: standardmäßig sichtbar als Pair-Button neben dem Download.
- [ ] **`pxt.appTarget.appTheme.bluetoothPartialFlashing = true`** explizit im Theme setzen (statt nur als Experiment), siehe [`webble.ts:16`](../../MAKECODE/pxt/pxtlib/webble.ts#L16).
- [ ] **`bluetoothUartFilters` schon vorhanden** ([`pxt-calliope/pxtarget.json:471-474`](../../MAKECODE/pxt-calliope/pxtarget.json#L471-L474)) — `Calliope mini`. Bei Bedarf um neue Namens-Präfixe ergänzen.
- [ ] **Pair-Flow-UX:** der Pair-Button in MakeCode (`container.tsx:281`, `core.showLoading("webblepair", …)`) führt heute durch `requestDevice`. Mit der Open-Firmware aus §1 entfällt das OS-Pairing — der Flow wird flüssig.

**Hinweis Browser-Kompatibilität:** Web Bluetooth läuft nur in Chrome/Edge auf Desktop und Android. Auf iOS-Safari und Firefox bleibt der USB-Pfad aktiv (siehe [USB-BLE-STRATEGY.md §3](USB-BLE-STRATEGY.md)).

### Weg B — Teachable flasht, MakeCode liefert nur das Hex (Proxy-Modell)

Hier ist MakeCode reiner Compiler — Teachable bettet ihn als iframe ein und fängt die Compile-Antwort ab.

- [ ] **MakeCode-iframe-URL mit `controller=2` aufrufen.** Kein Patch in MakeCode nötig; das Flag aktiviert den `nativeHostDeployCoreAsync`-Pfad in [`pxt/webapp/src/cmds.ts:177-197`](../../MAKECODE/pxt/webapp/src/cmds.ts#L177-L197), der per `window.parent.postMessage({name, download: hex}, "*")` das Hex an den Container schickt statt es als Datei downzuloaden.
- [ ] **Optional: `pxt.appTarget.appTheme.allowParentController = true`** in [`pxt-calliope/pxtarget.json`](../../MAKECODE/pxt-calliope/pxtarget.json), wenn wir den Listener auch ohne `controller=`-URL-Flag erlauben wollen.
- [ ] **Web Bluetooth-Kollision vermeiden:** wenn Teachable schon mit dem Calliope verbunden ist, sollte MakeCode nicht ebenfalls `requestDevice` aufrufen → in dieser Variante das `bluetoothPartialFlashing`-Experiment **nicht** im Target aktivieren (Experiment bleibt opt-in).

**Empfehlung:** Beide Wege parallel umsetzen — A für die "MakeCode-pur"-User, B für Teachable/Campus. Aufwand für A ist gering (~3 Zeilen `pxtarget.json`), B braucht keinen MakeCode-Patch, sondern nur Teachable-Code.

---

## 3. Teachable-Calliope-Svelte

Aktueller Stand: BLE öffnet nur Nordic-UART, Flashen wird in [`src/lib/stores/connection.ts:567-572`](../src/lib/stores/connection.ts#L567-L572) explizit auf USB gezwungen.

### 3.1 BLE-Flash-Pfad einbauen (Kern-Aufgabe)

- [ ] **UUIDs zentralisieren.** Neue Datei `src/lib/ble/profile.ts` mit:
   ```ts
   export const PARTIAL_FLASH_SERVICE = 'e97dd91d-251d-470a-a062-fa1922dfa9a8';
   export const PARTIAL_FLASH_CHAR    = 'e97d3b10-251d-470a-a062-fa1922dfa9a8';
   export const NUS_SERVICE           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
   export const NUS_TX_CHAR           = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
   export const NUS_RX_CHAR           = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
   ```
   Heute in [`connection.ts:112-114`](../src/lib/stores/connection.ts#L112-L114) hartkodiert.
- [ ] **`requestDevice` muss `optionalServices` deklarieren.** Aktuell wird die Lib `@microbit/microbit-connection` benutzt — der Aufruf in deren `bluetooth.ts` muss `e97dd91d-…` enthalten, sonst wirft `getPrimaryService` `SecurityError`. Falls die Lib das nicht zulässt, Browser-Bluetooth direkt öffnen (so wie heute schon `setupBleUart` an der Lib vorbei den NUS holt).
- [ ] **Modul `src/lib/ble/partial-flashing.ts` neu** — als Port der MakeCode-Implementation aus [`MAKECODE/pxt/pxtlib/webble.ts:266-650`](../../MAKECODE/pxt/pxtlib/webble.ts#L266-L650) **oder** der Android-Implementation aus [`Calliope-Android-App/.../PartialFlashingService.kt`](../../Calliope-Android-App/app/src/main/java/cc/calliope/mini/core/service/partialflashing/PartialFlashingService.kt). Beide Referenzen liegen vor — wir kopieren das Protokoll, schreiben es nicht neu.
   Mindest-Funktionsumfang:
   - `getStatus()` (Cmd `0xEE`) → Version + Microbit-Mode lesen.
   - `getRegionInfo(region)` (Cmd `0x00`) → Start/End/Hash der Regionen `0x01 CODAL` und `0x02 MakeCode`.
   - **Hash-Vergleich**: DAL-Hash aus dem Hex am Magic-Marker `708E3B92C615A841C49866C975EE5197` extrahieren, mit dem vom Gerät vergleichen. Mismatch → User-Hinweis "bitte einmal voll flashen über USB".
   - `flashData()` (Cmd `0x01`): 4 Pakete je 16 Bytes ergeben einen 64-Byte-Block, Notify abwarten, weiter.
   - `endOfTransmission()` (Cmd `0x02`) → Reset in App-Mode.
- [ ] **Flash-Dispatcher in [`connection.ts:563-672`](../src/lib/stores/connection.ts#L563-L672)** umstellen:
   - Aktuell Z. 570–572 erzwingen USB. Stattdessen:
     ```ts
     if (activeTransport === 'ble' && bleSupported) {
       return flashCalliopeViaBle(hex, name);
     }
     ```
   - `flashCalliopeViaBle()` als neue Funktion mit demselben State-Update-Schema (`status: 'flashing'`, `flashProgress`, `lastFlashAt`) wie `flashCalliope`.
   - Bei Hash-Mismatch oder Service nicht vorhanden: graceful Fallback auf USB mit klarer User-Meldung.
- [ ] **MTU-Chunking:** Web Bluetooth liefert Notifications in 20-Byte-Blöcken. Block-Buffer im Partial-Flashing-Modul vor dem `notifyValue`-Handler zusammensetzen (siehe `webble.ts:485+` als Vorlage).
- [ ] **Reconnect nach Flash:** beim Übergang `flashing → connected` wird der Calliope rebootet. Nach ~1.6 s reconnecten und UART neu öffnen (heute schon in [`connection.ts:636-644`](../src/lib/stores/connection.ts#L636-L644) für USB — analog für BLE).

### 3.2 BLE-Stabilität (Begleit-Aufgaben, nicht blockierend für Flashen)
- [ ] **Filter-Liste kürzen** ([`connection.ts:281`](../src/lib/stores/connection.ts#L281)) auf `Calliope mini`. micro:bit-Geräte sollten nicht mehr als Calliope-Default akzeptiert werden, das verschluckt Pair-Fehler.
- [ ] **Reconnect-Backoff:** 3 Versuche mit 1/2/3 s wie in [`PartialFlashingService.kt:1138-1229`](../../Calliope-Android-App/app/src/main/java/cc/calliope/mini/core/service/partialflashing/PartialFlashingService.kt). Heute bricht ein einzelnes Disconnect-Event direkt auf `error` ab.
- [ ] **Connect-Timeout** auf 7 s setzen (statt OS-Default 30 s). Bei Timeout: User-Hinweis "Calliope-Firmware unterstützt Browser-Flash nicht — bitte neue Firmware aufspielen oder per USB flashen", verlinkt auf §1-Build.

### 3.3 MakeCode einbetten (für Weg B oder generell)
- [ ] iframe-Komponente `src/lib/components/MakeCodeFrame.svelte` mit `src="https://makecode.calliope.cc/?controller=2&hidemenu=1&lang=de"`.
- [ ] `window.addEventListener('message', …)` filtern auf `event.source === iframe.contentWindow`, dann auf `data.download && data.name` reagieren → `flashCalliope(data.download, data.name)` aufrufen.
- [ ] Workspace-Sync (`workspacesync`/`workspacesave`) ist optional — solange wir nur Compile→Flash brauchen, reicht das `download`-Event. Wenn Projekte persistiert werden sollen, Vorbild ist [`calliope-campus/.../MakeCode.svelte:599-691`](../../calliope-campus/src/lib/components/editors/MakeCode.svelte#L599-L691).

### 3.4 UX-Anzeige
- [ ] Im UI sichtbar machen: **welcher Transport** flasht gerade (USB/BLE-Icon im Flash-Progress).
- [ ] Bei BLE-Flash: Hinweis **"Stell sicher, dass der Calliope nicht weit weg ist und der Akku geladen ist"** während der Phase — Reichweiten-Probleme sind die häufigste reale Fehlerursache.

**Aufwand-Schätzung:**
- 3.1 (BLE-Flash-Pfad): 2–3 Tage (Großteil ist Port der Bestands-Implementierung).
- 3.2 (Stabilität): 0,5 Tage.
- 3.3 (Iframe-Embed): 0,5 Tage, wenn nur `download`-Event verarbeitet wird.
- 3.4 (UX): 0,5 Tage.

---

## 4. Reihenfolge & Abhängigkeiten

```
   ┌── 1.1 CODAL-Build (open security)
   │      ↓
   │   1.2 Verify mit nRF Connect
   │      ↓
   ├── 3.1 Teachable BLE-Flash-Modul
   │      ↓
   │   3.4 UX
   │      ↓
   └── (parallel: 2.A MakeCode-Default-Flag oder 3.3 iframe-Embed je nach Strategie)
```

Kritischer Pfad ist **1.1 → 1.2**, weil ohne offene Firmware der ganze Browser-Pfad an Bonding scheitert. Ist das einmal verifiziert, sind 3.1 und 2.A unabhängig voneinander.

## 5. Was wir **nicht** tun (in dieser Phase)

- Kein neues Host-Editor-Protokoll erfinden — siehe [UNIFIED-HOST-EDITOR-CONCEPT.md](UNIFIED-HOST-EDITOR-CONCEPT.md). Erst wenn Phase oben läuft.
- Keine MicroPython-BLE-Flash-Variante — die zusätzliche Magic-Marker-Logik (`FE307F59`/`9DD7B1C1`, Region 3) bleibt für später (Vorbild: iOS-App-Plan in `MICROPYTHON_PARTIAL_FLASH_PLAN.md`).
- Kein DAL-Support — Calliope mini V1/V2 (DAL-basiert) bleiben USB-only.
- Keine Änderung am Default-Calliope-Image für Endkunden — eine separate "Browser-Flash"-Firmware-Variante.

## 6. Akzeptanzkriterien

- [ ] Frische Calliope mini V3 mit der neuen Firmware (§1) flashen lassen sich aus Chrome/Edge **ohne** OS-Pairing-Dialog.
- [ ] Compile in MakeCode (entweder im iframe in Teachable oder direkt) → Hex landet via Partial-Flashing-Service auf dem Gerät.
- [ ] Erfolgsrate **≥ 90 %** über 20 aufeinanderfolgende Flash-Versuche, Reichweite ≤ 1 m.
- [ ] Nach Flash: BLE-UART funktioniert weiter (Sensor-Daten in Teachable-TF.js-View kommen an).
- [ ] USB-Pfad bleibt unverändert funktionsfähig.
