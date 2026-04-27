# Teachable-Calliope-Svelte — USB & BLE: Entwurf

Ausgangslage und Ist-Zustand siehe [../../README.md](../../README.md).
Ziel: stabilere BLE-Kommunikation, Pfad zum BLE-Flashen, klar dokumentierte Fallbacks.

## 1. Ziele in Reihenfolge

1. **USB nicht verschlechtern** — funktioniert heute, bleibt der zuverlässige Default.
2. **BLE-Kommunikation stabil** — UART zuverlässig öffnen/halten, Reconnect ohne Reload.
3. **BLE-Flashen** — Partial Flashing Service (`e97dd91d…` / Char `e97d3b10…`), wie in der Android-App, perspektivisch auch wie in flash-app-iOS.
4. **Klare UX für Bonding/Whitelist** — Pairing auf OS-Ebene als First-Class-Schritt.

## 2. Was geht im Browser, was nicht

| Funktion | Web Bluetooth (Chrome/Edge Desktop, Android Chrome) | Web Bluetooth Safari/iOS | WebUSB |
|---|---|---|---|
| GATT-Connect, Notify, Write w/o Response | ✅ | ❌ (kein Web Bluetooth) | n/a |
| `requestDevice` mit UUID-Filter | ✅, **muss aus User-Geste** | – | ✅ analog |
| **Bond/Pairing initiieren** (PIN/„Just Works") | ❌ — Browser hat keine API dafür; OS-Prompt nur, wenn Charakteristikum Auth verlangt | – | n/a |
| **Whitelist sehen / Bond löschen** | ❌ | – | n/a |
| Partial Flashing über UUID `e97d3b10…` | ✅ technisch (Notify+WriteWoR), aber Bonding wird in Firmware verlangt | – | n/a |
| MTU steuern | ❌ (Browser fix bei ~20–23 B Payload) | – | n/a |

**Konsequenz:** BLE-Flashen ist im **Browser machbar**, sobald das Gerät einmal **OS-seitig gebondet** ist. Der Bond-Schritt selbst muss außerhalb der Webseite passieren — das ist die zentrale UX-Herausforderung, nicht ein technisches Limit.

## 3. Drei-Stufen-Strategie (Empfehlung)

### Stufe A — Best Practice: BLE voll, OS-Pairing First
- User koppelt den Calliope einmalig in den OS-Bluetooth-Einstellungen (Pairing-Modus am Gerät: Reset + Button A halten, bis Pairing-Screen erscheint).
- TeachableCalliope öffnet danach **GATT-Verbindung im Browser** und nutzt:
  - **UART** (`6e400001-…`) für Live-Daten ↔ TF.js,
  - **Partial Flashing Service** zum Flashen.
- Voraussetzung erfüllt: das Gerät verlangt Bonding (`MICROBIT_BLE_ENABLE_BONDING=true` in CODAL), Browser nutzt es transparent.

### Stufe B — Fallback: WebUSB-Flash + USB-Serial-Kommunikation
- Wie heute: Hex über WebUSB/DAPjs (partial flash), Live-Daten über USB-CDC-Serial.
- Greift, wenn (a) OS-Pairing scheitert, (b) Browser ohne Web Bluetooth (Safari/iOS), (c) Nutzer schlicht ein Kabel angesteckt hat.

### Stufe C — Letzte Linie: alles über USB
- Identisch zu B, aber ohne BLE-Erkennungsversuch. Reine Klassenraum-Variante mit Hub.

Auswahl-Logik (Pseudocode in `connection.ts`):
```ts
if (userPickedTransport) use(userPickedTransport)
else if (navigator.bluetooth && lastKnownTransport === 'ble') tryBle() ?? tryUsb()
else if (navigator.usb) tryUsb()
else showUnsupported()
```
Transport-Wahl persistieren (localStorage), aber pro Session überschreibbar.

## 4. Konkrete Änderungen am Code

### 4.1 BLE-Stabilität (kurzfristig)
Die heutige Eigenimplementierung in [`src/lib/stores/connection.ts`](../src/lib/stores/connection.ts) (Z. 345 `setupBleUart`) ist tragfähig, aber:

- **Reconnect-Pfad härten** wie in der Android-App: nach Disconnect Service-Cache invalidieren (`device.gatt!.disconnect()` + neu `connect()`), 3 Retries mit Backoff 1/2/3 s, **nicht** sofort den Store auf `error` werfen.
- **Heartbeat trennen** von Reconnect: Heartbeat verschwindet, wenn Notify aktiv ist — sonst löst er Race-Conditions aus.
- **Filter-Liste straffen** (Z. 281): nur `Calliope mini` als Default, micro:bit als Opt-in im UI. Sonst werden fremde Boards als Calliope ausgewählt und das Pairing scheitert ohne sichtbaren Grund.
- **Disconnect-Reason-Diagnose:** GATT-Status auswerten und im UI unterscheiden („Calliope hat verbindung abgewiesen — neu pairen?" vs. „Reichweite/Akku").

### 4.2 BLE-Flashen einführen
Statt eigener Implementierung **`mini-connection`-Fork als Quelle nehmen** und schrittweise dessen Bluetooth-Profil aktivieren — der Fork ist bereits im Projekt, hat USB-Partial-Flash-Code; Bluetooth-Profil-Datei (`lib/bluetooth-profile.ts`) liegt im Upstream und kann gemerged werden.

Wenn das zu groß ist, **eigenständig** auf Basis der Android-Implementierung als Referenz:
- Service `e97dd91d-251d-470a-a062-fa1922dfa9a8`, Char `e97d3b10-…` (write w/o response **und** notify).
- Cmd `0x00` REGION_INFO mit `region_id = 2` (DAL) → 8-Byte-Hash vergleichen mit Hash im neuen Hex.
- Match → Cmd `0x01` FLASH mit Sequenznummern, 16×4-Byte-Blöcke je „Flash-Window", auf Notify-Bestätigung warten.
- Mismatch → kein Partial möglich, Hinweis „bitte einmal per USB voll flashen".
- Cmd `0x02` END_OF_FLASH, Bootloader-Flag, Reset abwarten (~1.6 s), reconnect.

Das ist auch ohne MicroPython-Pfad nutzbar; MicroPython-Markers (`FE307F59`/`9DD7B1C1`, Region 3) später nachziehen — die iOS- und Android-Implementierungen liefern beide eine fertige Vorlage.

### 4.3 Bonding/Whitelist-UX
Da der Browser kein Bond auslösen kann, muss die App den User aktiv durch den OS-Schritt führen. Vorschlag:

- Eigener „Pair zuerst"-Modal-Step, wenn `requestDevice` zwar Geräte liefert, aber `connect()` mit `GATT_AUTH_FAIL` oder `NotSupportedError` scheitert.
- Plattform-spezifische Anleitungen (Win/macOS/Android/ChromeOS) als kurze Bilder/Steps — Inhalte kommen 1:1 aus der Android-App-Doku.
- „Calliope vergessen"-Hinweis: Wenn drei Reconnects scheitern, OS-Anleitung „Gerät entfernen und neu koppeln" zeigen — entspricht dem User-Bericht „Whitelist-Loch".

### 4.4 Codebasis aufräumen
- Aktive UART-UUIDs aus dem Connection-Store in eine eigene Datei `src/lib/ble/profile.ts`, daneben Partial-Flash-Profil — vorbereitend für Stufe A.
- USB- und BLE-Pfad hinter eine `Transport`-Schnittstelle (`connect, disconnect, send, onData, flash(hex, onProgress)`) ziehen. Heute hängt zu viel an einem 700-Z.-Store.

## 5. Grenzen, ehrlich

- **Safari/iOS Web** wird nie Web Bluetooth bekommen — dort bleibt nur USB (oder die native iOS-App weiterempfehlen).
- **Pairing-PIN-Modus** der Calliope-Firmware verlangt Knopfdruck am Gerät — kein App-only-Flow möglich. Das ist Feature, nicht Bug (Sicherheit).
- **WebUSB unter macOS** verlangt korrekte HID-Selektoren (VID `0x1366`/PID `0x1025` sind aus pxt-calliope übernommen, in der Lib hinterlegt). Wenn Apple in einer Major-Version etwas dreht, hilft der USB-Fallback nicht — dann ist BLE die robustere Schiene, **wenn** Pairing einmal sitzt.
- **Chromebooks im Klassenraum** sind oft mit deaktivierten Bluetooth-APIs konfiguriert — defaultmäßig USB anbieten und BLE nur, wenn `navigator.bluetooth` greifbar ist.

## 6. Reihenfolge der Umsetzung

1. **BLE-Reconnect/Diagnose** (klein, sofort, hebt heutige Erfahrung).
2. **Transport-Schnittstelle** rausziehen (Refactor, kein Verhaltenwechsel).
3. **Bonding-UX-Modal** mit Plattform-Schritten.
4. **BLE Partial Flashing** als Feature-Flag — erst Hex-Match prüfen, dann schreiben.
5. **MicroPython-Pfad** ergänzen, sobald 4 stabil.
6. **mini-connection-Fork** auf Upstream-Bluetooth-Profil rebasen, sobald 1–4 stabil sind und der Eigenanteil minimiert werden kann.
