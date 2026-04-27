
# Kerngedanken:

**Architektur-Bild:** Eine Host-Schicht besitzt die einzige Geräteverbindung. Editoren laufen als Gäste (iframe/WebView) und reichen Compile-Hex, Serial und Status über ein einheitliches HostEditorProtocol durch. Auf Mobil ist Host die System-App, auf Desktop entweder der Editor selbst (Teachable) oder Calliope Campus.

**Was schon existiert:** MakeCode kennt mit controller=2 (pxt/pxtlib/shell.ts:30) genau diesen Modus — Compile-Output kommt per postMessage statt Browser-Download. Die iOS-App (EditorViewController.swift:316-349) und die Android-App (WebFragment.java:100-114) implementieren das bereits — nur Desktop und Campus (heute controller=1) machen es noch nicht.

**Vorgeschlagenes Protokoll (§3):** klare Editor↔Host-Aktionen (host.flash, host.serialWrite, host.requestFirmware, editor.deviceState, editor.flashProgress, editor.serialData), gleiches API auf allen Plattformen, je nach Umgebung über postMessage / WKScriptMessageHandler / addJavascriptInterface.

**Profil-Manager (§5):** Host liest DAL-Hash via Partial-Flashing-Service, vergleicht mit Editor-Erwartung, flasht nur wenn nötig — löst das stille "veraltete Runtime nach Editor-Wechsel"-Problem.

Roadmap in 4 Phasen, Teachable als Test-Ballon zuerst (DeviceManager extrahieren → BLE stabilisieren → Partial-Flash via BLE → MakeCode auf controller=2 umstellen), dann Campus, dann Mobil-Apps angleichen, dann Firmware-Polish.

**Risiken ehrlich aufgelistet:** Firefox kann es nicht (Empfehlung Chrome/Edge auf Desktop), controller=2 ist undokumentiert (Versionshandshake nötig), WebView-API-Drift, Sicherheitsfragen bei fremden Editor-URLs, autoritative Wahrheit muss beim Host liegen.


# Konzept: Host-besitzt-das-Gerät — eine plattformübergreifende Architektur

> **TL;DR.** Eine **Host-Schicht** besitzt die einzige Verbindung zum Calliope (BLE/USB), die **Editoren laufen als Gäste** in einem WebView/iframe und reichen Compile-Output („Hex"), Serial-I/O und Status über ein einheitliches Nachrichten-Protokoll an den Host durch. Auf Mobil ist der Host eine native System-App, auf Desktop ist er der Browser oder — bei Calliope Campus — der Campus selbst. **Teachable-Calliope-Svelte** ist der Test-Ballon, weil er die typische Mischung aus eingebettetem MakeCode + Flashen + Live-Kommunikation in der einfachsten Form abbildet.
>
> Das Protokoll dafür existiert bereits: MakeCode kennt mit `controller=2` einen Modus, in dem Compile-Hex per `postMessage` an den Container geht statt im Editor heruntergeladen zu werden. Android- und iOS-System-App fangen genau diesen Pfad heute schon ab. Der gleiche Mechanismus lässt sich auf Desktop und auf andere Editoren übertragen — die Aufgabe ist, ihn als ein **gemeinsames Host-API** zu definieren und für jeden Editor den passenden Adapter zu bauen.

Begleitdokumente: [USB-BLE-STRATEGY.md](USB-BLE-STRATEGY.md), [USB-BLE-OPTIONS-FIRMWARE.md](USB-BLE-OPTIONS-FIRMWARE.md), Übersicht: [../../README.md](../../README.md).

---

## 1. Vision

```
                ┌─────────────────────────────────────────────────────────┐
                │                       HOST (besitzt Gerät)              │
                │  ┌─ DeviceManager ──────────────────────────┐           │
                │  │  Transport: BLE | WebUSB | Native USB    │           │
                │  │  Flasher  : partial-flash | DFU | UF2    │           │
                │  │  Serial   : UART (BLE) | CDC (USB)       │           │
                │  │  Firmware : version, capabilities, hash  │           │
                │  └──────────────────────────────────────────┘           │
                │                       ▲                                 │
                │     postMessage / JS-Bridge  (HostEditorProtocol v1)    │
                │                       ▼                                 │
                │  ┌─ Editor-Slot (iframe / WKWebView / Android WebView)─┐│
                │  │  MakeCode (controller=2)  │  Blocks (Patch nötig)   ││
                │  │  Python-Editor (Patch)    │  Teachable (eigene)    ││
                │  │  Scratch (sep. Pfad, BLE-Live-Bridge)              ││
                │  └────────────────────────────────────────────────────┘│
                └─────────────────────────────────────────────────────────┘

  Mobil      Desktop-Browser-Direkt        Desktop-Campus
  -----      -----------------------       --------------
  Host = native App         Host = Editor selbst (z.B.    Host = Calliope Campus
  Editor = WebView          Teachable, Python-Editor)     Editor = iframe (controller=2)
```

Die Architektur ist **rekursiv selbstähnlich**: Mobile App, Campus, Teachable und ein "nackter" Browser-Editor implementieren alle dasselbe `HostEditorProtocol`. Auf jeder Plattform spielt eine andere Komponente die Host-Rolle, aber der Editor sieht immer dieselbe Schnittstelle.

---

## 2. Was existiert schon

### 2.1 MakeCode `controller=2` ist die zentrale Stütze

Im PXT-Framework definiert in [`MAKECODE/pxt/pxtlib/shell.ts:30`](../../MAKECODE/pxt/pxtlib/shell.ts#L30) — URL-Parameter `controller=(0|1|2)` schaltet den Layout-Type auf `Controller` (Z. 43) und setzt `ControllerMode = Basic | App` (Z. 9–13).

- **`controller=1` (Basic):** Editor übernimmt Workspace-Sync, **Download bleibt im Editor** (Hex-Datei wird heruntergeladen, OS-Save-Dialog).
- **`controller=2` (App):** Editor schickt Compile-Output **per postMessage** an den Container (`{ download: hexString, name }`) — kein Browser-Download. Genau das, was eine native App oder ein "smarter Host" will.

Empfangsseite siehe [`MAKECODE/pxt/pxteditor/editorcontroller.ts:25–69`](../../MAKECODE/pxt/pxteditor/editorcontroller.ts#L25-L69) (`bindEditorMessages`). Unterstützte Aktionen u. a. `compile`, `saveproject`, `importproject`, `newproject`, `pair`, `switchblocks/javascript/python`, `simulator*`, `print`. Über `pxt.appTarget.appTheme.allowParentController` kann ein Target auch ohne URL-Flag explizit Controller-Nachrichten erlauben.

### 2.2 Vorhandene Implementierungen — alle benutzen dasselbe Muster

| Wer | Modus | Hex-Abfang | Serial/UART | Quelle |
|---|---|---|---|---|
| **iOS-App** | WKWebView, ohne JS-Bridge | `WKDownloadDelegate` fängt `.hex` → `uploadHex()` → native BLE | außerhalb des WebView (CoreBluetooth direkt) | `EditorViewController.swift:316-349` |
| **Android-App** | WebView + `addJavascriptInterface` | `Android.handleControllerDownload(hex, name)` von controller=2-Editor → native DFU-Activity | `AndroidBle.writeText()`/`onUart` injected | `WebFragment.java:100-114`, `WebBleFragment.kt:189-200` |
| **makecode-embed** | iframe + postMessage-Driver | `onDownload({hex, name})`-Callback | (nicht implementiert) | `makecode-frame-driver.ts:284-305` |
| **calliope-campus** | iframe + `controller=1` (heute) | nicht intercepted — Editor lädt selbst herunter | nicht implementiert | `MakeCode.svelte:803, 599-691` |
| **Teachable-Calliope-Svelte** | Eigenständig (kein iframe heute) | direkt USB/BLE im Store | direkt im Store | `connection.ts` |

**Beobachtung:** Die Mobil-Apps machen exakt das, was wir global brauchen. Auf Desktop fehlt es. Campus benutzt heute noch `controller=1`.

### 2.3 Das, was MakeCode-Controller-Protocol *nicht* abdeckt

- **Live-Serial in den Editor zurück** (z. B. für TF.js-Sensor-Daten in Teachable). Es gibt zwar `simmessage`/Simulator-Proxy, aber kein offizielles "echtes Gerät → postMessage-an-Editor"-Schema.
  → Android löst es heute durch *eigene* Injection (`window.onUart`, `window.sendUART`). Gleicher Trick auf Desktop möglich, ohne Patch im Editor.
- **Firmware-Identifikation** (welches Hex-Profil ist gerade auf dem Gerät — MakeCode? Blocks? MicroPython? Welche Version?). Nichts im Protokoll vorgesehen.
  → Host muss das selbst tracken (Hex-Hash, Magic-Marker, optional Calliope Device-Info-Service `0x180a`).
- **Pair/Connect-Flow** — `pair`-Action existiert (`editorcontroller.ts:268`), aber im Wesentlichen als Trigger; die echte Logik liegt im Container.

---

## 3. Das einheitliche `HostEditorProtocol` (Vorschlag)

Ein Layer, der auf allen Plattformen gleich aussieht und unter der Haube je nach Umgebung verschieden transportiert wird (`postMessage` im Web, `webkit.messageHandlers.*` auf iOS, `Android.*` auf Android).

### 3.1 Editor → Host

| Action | Payload | Kommentar |
|---|---|---|
| `host.ready` | `{editor, version, capabilities[]}` | Editor gibt sich beim Host bekannt. |
| `host.flash` | `{kind: 'hex'\|'uf2'\|'partial', data, name, hash?}` | Ersetzt MakeCodes `download`. Host entscheidet Transport. |
| `host.serialWrite` | `{bytes\|text}` | Editor will an UART/CDC senden. |
| `host.requestSerialOpen` | `{baud?}` | Editor will Live-Stream abonnieren. |
| `host.status` | `{busy\|idle\|error, message?}` | Editor reportet eigenen Status (für Host-UI). |
| `host.requestPair` | `{}` | Editor bittet den Host, einen Pair/Connect-Flow auszulösen. |
| `host.requestFirmware` | `{kind, hash?}` | „Ich brauche Profil-Firmware X — Host, sorg dafür." |

### 3.2 Host → Editor

| Action | Payload | Kommentar |
|---|---|---|
| `editor.deviceState` | `{transport, connected, fwProfile, fwHash}` | Host informiert über Verbindungs- und Firmware-Lage. |
| `editor.flashProgress` | `{percent, phase}` | Während des Flashens. |
| `editor.flashResult` | `{ok, error?}` | Endergebnis. |
| `editor.serialData` | `{bytes\|text}` | Live-Daten vom Gerät. |
| `editor.simulatorMessageProxy` | `…` | bleibt MakeCode-kompatibel. |

### 3.3 Lifecycle

1. iframe lädt mit `controller=2&hostProto=v1`.
2. Editor sendet `host.ready`. Host antwortet mit `editor.deviceState`.
3. Bei „Compile" sendet Editor `host.flash` statt Browser-Download → Host flasht und antwortet mit `editor.flashProgress`/`editor.flashResult`.
4. Bei `host.requestSerialOpen` öffnet Host UART und pumpt `editor.serialData`.
5. Bei `host.requestFirmware` prüft Host den vorhandenen Profil-Hash — wenn passt, no-op; sonst flasht er das Profil-Hex (z. B. "Calliope Blocks Runtime") und antwortet erst dann mit `editor.deviceState`.

### 3.4 Auf Mobil: Mapping auf nativ

- **Android:** `addJavascriptInterface("Host", …)`. JS-Bridge-Aufrufe in `host.*`-Methoden gemappt; Host→Editor via `webView.evaluateJavascript("window.__host.dispatch(…)")`.
- **iOS:** `WKUserContentController.add(self, name: "host")`, JS ruft `window.webkit.messageHandlers.host.postMessage(…)`. Host→Editor via `evaluateJavaScript`.
- **Desktop-Browser:** klassisches `postMessage(target, msg, "*")` zwischen Host-Frame und iframe.

Damit ist **derselbe Editor-Code** überall einsetzbar — er muss nur `window.parent.postMessage(...)` benutzen und die Plattform-Schicht legt die korrekte Brücke an.

---

## 4. Editoren-Adapter: was zu tun ist

### 4.1 MakeCode (`pxt`) — fertig, fast
- `controller=2` setzen, `pxt.appTarget.appTheme.allowParentController = true` im `pxt-calliope`-Target.
- Eigenes Theme-Flag `useHostEditorProtocol` (Patch in `editorcontroller.ts`), das beim Compile-Resultat die `host.flash`-Action statt des proprietären `download`-Messages sendet (Wrapper, kein Big Refactor — beide Formate parallel kompatibel).
- Pull-Request gegen Upstream MakeCode anstreben; bis dahin Patch im Calliope-Fork.

### 4.2 Calliope-Mini-Python-Editor — Patch in eigenen Repo
- Heute: nimmt selbst WebUSB. Patch: hinter Feature-Flag `?host=1` Editor-internen `partial-flashing.ts` deaktivieren und stattdessen `host.flash` posten. Adapter ist klein, weil bereits `DeviceConnection`-Schnittstelle existiert.
- Serial-Konsole entsprechend gegen `editor.serialData` mappen.

### 4.3 ml-trainer & MakeCode-Blocks-/Calliope-Editor — Patch
- Beide nutzen `@microbit/microbit-connection`. Im `host=1`-Modus die Library nicht initialisieren, sondern eine Stub-Implementation einsetzen, die `connect/flash/onSerial` auf das Host-Protokoll mappt.
- Vorteil: Editor-Code bleibt unverändert, nur die Transport-Schicht wird gewechselt.

### 4.4 Scratch (scratch-gui) — Sonderfall
- Scratch-Link-Modell existiert bereits (WebSocket → Desktop-Service → BLE). Auf Mobil ist heute Scrub im Einsatz, das CoreBluetooth direkt benutzt.
- Kompatible Variante: einen "Host-Scratch-Link"-Adapter schreiben, der die WebSocket-Anfragen auf das Host-Protokoll mappt. Für Calliope-Campus genug; für Scrub bleibt der native Pfad.

### 4.5 Teachable-Calliope-Svelte — Test-Ballon
- **Doppelrolle:** ist gleichzeitig **Host** (eigener `DeviceManager` mit USB+BLE) **und Container** (bettet MakeCode ein, betreibt eigene TF.js-UI).
- Erste Stufe: das im aktuellen `connection.ts` versteckte Geräte-Handling als sauberes `DeviceManager`-Modul herausziehen, mit der Schnittstelle aus §3 als öffentlichem API.
- Zweite Stufe: das eingebettete MakeCode auf `controller=2` umstellen und mit dem `DeviceManager` verdrahten — d. h. nicht mehr Hex per Browser-Download, sondern direkt aus dem Compile-Event flashen.
- Damit ist Teachable die **Referenz-Implementierung des Host-API auf Desktop**. Die mobile App-Seite kann genau dasselbe `host`-Interface (mit anderem Transport) anbieten und der Editor läuft unverändert.

---

## 5. Firmware-Profile und Profil-Wechsel

Wenn der Host zentral entscheidet, „brauche ich ein anderes Hex auf dem Gerät", braucht er einen **Profil-Index**:

| Profil | Hex-Quelle | Identifikation am Gerät |
|---|---|---|
| MakeCode-Runtime | aus `host.flash`-Aufruf, dynamisch | Magic-Marker `708E3B92…` + DAL-Hash (siehe iOS-App) |
| Blocks-Runtime (Calliope „Blocks") | `https://calliope.cc/downloads/blocks.hex` (siehe scratch-gui-Update-Pfad) | Hash auf bekannten Wert prüfen |
| MicroPython | calliope-mini-python-editor | Magic `FE307F59`/`9DD7B1C1` |
| ml-trainer-Bridge | spezielles Hex (Pattern-Pairing/Radio) | Service-UUID `xxxx-…` (siehe ml-trainer) |
| Teachable-Runtime | aktuell identisch zu MakeCode-Build | DAL-Hash |

**Profil-Wechsel-Heuristik:**
1. Host liest beim Connect den DAL-Hash via Partial-Flashing-Service (`REGION_INFO`, region 2) — kein Roundtrip nötig auf USB.
2. Vergleicht mit Erwartung des aktiven Editors.
3. Stimmt: kein Flash, sofort fertig.
4. Stimmt nicht: Flash des Profils → Reboot → reconnect → Editor benachrichtigen.

Damit verschwindet die heutige Schwäche, dass beim Wechsel zwischen Editoren stillschweigend ein veraltetes Profil läuft.

---

## 6. Plattform-Spezifika

### 6.1 Mobil (Android, iOS)
- **Pflicht-Pfad:** Host = System-App, alle Editoren als WebView mit `controller=2`-äquivalent.
- Konsequenz für **andere** Editoren als MakeCode: dieselben Patches wie auf Desktop nötig (s. §4) — auf Mobil ist es nicht-verhandelbar, weil WebViews **kein** Web Bluetooth/WebUSB haben.
- iOS: Web Bluetooth gibt es überhaupt nur in den Apps Bluefy/WebBLE. Der App-Host-Pfad ist die einzige saubere Lösung für Safari-Bestimmungs-Mobil-Browser.

### 6.2 Desktop-Browser-Direkt (z. B. Teachable im Chrome)
- Editor *ist* Host, nutzt Web Bluetooth + WebUSB direkt.
- Vorteil: kein Round-Trip, kein iframe.
- Nachteil: jeder Editor implementiert das Geräte-Handling separat (das, was wir heute haben).
- → durch `DeviceManager`-Lib (extrahiert aus Teachable) eindämmen.

### 6.3 Desktop-Calliope-Campus
- Campus = Host. Editoren werden in iframes geladen, Campus übernimmt Geräte-I/O.
- Vorteil: Wechsel zwischen MakeCode/Blocks/Python/Teachable im selben Tab, **eine** Verbindung, ein Profil-Manager.
- Voraussetzung: `controller=2` für MakeCode (heute `controller=1`), Adapter für andere Editoren.

### 6.4 Linux / Chromebooks im Klassenraum
- Web Bluetooth oft eingeschränkt → WebUSB als Default; Host fallback-Logik in `DeviceManager`.

---

## 7. Risiken und Grenzen — ehrlich

1. **Editoren ohne Maintenance-Zugriff.** Wir besitzen die Forks von MakeCode, Python-Editor, ml-trainer, Calliope-Blocks. Bei Upstream-Editoren (z. B. Snap!, OpenRoberta) wäre ein Adapter immer ein Patch — oft nicht trivial.
2. **WebView-API-Drift.** Android System-WebView und iOS WKWebView entwickeln sich unabhängig; `WKDownloadDelegate` gab es erst ab iOS 14.5. Wir müssen Mindest-API-Levels festschreiben.
3. **Nicht-Edge-Browser auf Desktop.** Firefox unterstützt weder Web Bluetooth noch WebUSB nativ. Empfehlung: **Chrome/Edge** als Pflicht für Desktop-Direct, Firefox-Nutzern wird Campus oder eine native App empfohlen.
4. **MTU- und Chunking-Quirks.** Web Bluetooth begrenzt Notify-Payloads auf ~20 B; iOS-WKWebView hat dasselbe BLE-Stack-Problem auf Edge-Cases. Der `DeviceManager` muss diese Quirks **innerhalb** der Host-Schicht kapseln, damit Editor-Adapter sie nicht sehen.
5. **`controller=2` ist undokumentiert genug.** Wir hängen am MakeCode-internen Vertrag; Microsoft kann das Format ändern. Mitigation: Versionierung im Hostprotokoll (`hostProto=v1`), beidseitiger Capability-Handshake.
6. **Sicherheit auf Mobil.** Die System-App führt fremde Editor-URLs in einer WebView aus — XSS-/Phishing-Vektor in Schul-Kontext. Editor-Whitelist + CSP-Header-Inspection in der App ist Pflicht.
7. **Zwei Wahrheiten über das Gerät.** Wenn Host und Editor unterschiedliche Modelle haben (Editor "fertig geflashed", Host weiß "abgebrochen bei 78 %"), gibt's Konfusion. Lösung: Host ist **autoritativ**, Editor zeigt nur an, was per `editor.deviceState`/`editor.flashProgress` reinkommt — keine eigenen Annahmen.

---

## 8. Roadmap / TODO

### Phase 0 — Vorarbeiten (1–2 Wochen)
- [ ] **Protokoll-Spec** (`HostEditorProtocol-v1.md`) als eigene Datei in diesem Doc-Ordner schreiben (Action-Liste, JSON-Schemas, Sequenzdiagramme).
- [ ] **Capability-Matrix** pro Editor anlegen: was kann Editor heute (compile/serial/etc.), was braucht er vom Host.
- [ ] **Profil-Hash-Liste** der wichtigsten Firmware-Hexen kuratieren (MakeCode, Blocks, MicroPython, ml-trainer, Teachable).

### Phase 1 — Teachable als Test-Ballon (3–4 Wochen)
- [ ] `DeviceManager`-Modul aus [`src/lib/stores/connection.ts`](../src/lib/stores/connection.ts) extrahieren — Schnittstelle wie in §3.
- [ ] BLE-Stabilisierung gemäß [USB-BLE-STRATEGY.md §4.1](USB-BLE-STRATEGY.md).
- [ ] BLE-Partial-Flashing implementieren (Referenz: Android-App).
- [ ] MakeCode mit `controller=2` einbetten, eigenen `host.flash`-Pfad fahren, alten Browser-Download-Pfad als Fallback behalten.
- [ ] `editor.serialData`-Pfad: TF.js-Datenstrom geht über Host (statt direkt aus dem Connection-Store), so dass das Editor-Frontend nichts vom Transport weiß.
- [ ] **Akzeptanztest:** MakeCode-Compile → Hex landet ohne Browser-Download im Calliope (BLE und USB), Sensor-Daten kommen im TF.js-Trainings-View an.

### Phase 2 — Calliope Campus auf controller=2 (3–4 Wochen)
- [ ] [`MakeCode.svelte:803`](../../calliope-campus/src/lib/components/editors/MakeCode.svelte#L803) auf `controller=2` umstellen, `host.flash`-Empfänger im Campus.
- [ ] Campus-`DeviceManager` als Wiederverwendung des Teachable-Moduls (gemeinsames npm-Paket).
- [ ] Profil-Manager: Editor-Wechsel triggert ggf. Re-Flash der Runtime.
- [ ] Calliope-Mini-Python-Editor & Calliope-Blocks-Editor patchen (`?host=1`-Modus).
- [ ] **Akzeptanztest:** im Campus zwischen MakeCode → Blocks → Python wechseln, Host flasht passende Runtime, eine BLE-Verbindung über alle drei Wechsel hinweg.

### Phase 3 — Mobil-Apps konvergieren (4–6 Wochen)
- [ ] iOS: existierenden `WKDownloadDelegate`-Pfad auf den neuen `host.flash`-Vertrag erweitern (zusätzlich zum bestehenden `download`-Event); Serial-Bridge à la Android via `WKScriptMessageHandler` einführen.
- [ ] Android: `WebFragment.handleControllerDownload` umbenennen/aliasen auf `host.flash`; UART-Injection (heute schon in `WebBleFragment.kt:189-200`) auf das standardisierte API hinheben.
- [ ] Beide Apps lesen dieselbe Editor-Whitelist (z. B. `https://calliope.cc/editor/*`).

### Phase 4 — Politur (laufend)
- [ ] Firmware "Teachable"-Variante mit `MICROBIT_BLE_WHITELIST=0` + LED-Auth-Fail (siehe [USB-BLE-OPTIONS-FIRMWARE.md](USB-BLE-OPTIONS-FIRMWARE.md)) — entfernt das Whitelist-Loch und macht abgewiesene Verbindungen sichtbar.
- [ ] Bonding-UX-Wizard (Plattform-spezifisch) im Host.
- [ ] Telemetrie: anonyme Counter pro Transport (USB/BLE), pro Flash-Phase, pro Fehlertyp — wir wissen heute nicht, **wie oft** der BLE-Pfad in der Praxis scheitert.

---

## 9. Warum gerade Teachable den ersten Schritt machen sollte

- **Kleinster Scope:** kein Multi-Editor-Wechsel, kein Profil-Manager, kein Mehrbenutzer-Kontext (Campus). Nur eine Editor-Instanz, ein Datenstrom, ein Flash-Event.
- **Aber alle Bauteile vorhanden:** USB-Flash, BLE-UART, eingebettetes MakeCode, Live-Daten-Verbrauch (TF.js). Was hier funktioniert, lässt sich 1:1 auf Campus heben.
- **Die App-Schicht ist schon Svelte:** sauberer Reaktiv-Store, einfache State-Machine — gute Voraussetzung, einen klaren Cut zwischen `DeviceManager` (Plattform) und Editor-/UI-Schicht zu ziehen.
- **Realistisches Versagensbild:** Teachable ist genau das Setup, in dem die heutigen BLE-Probleme aufschlagen. Wenn wir es dort lösen, lösen wir es auch für Campus.

**Konkret als Nächstes:** §8 Phase 0 abschließen (Protokoll-Spec + Capability-Matrix + Profil-Hashes), dann Phase 1.1 — Extraktion des `DeviceManager`-Moduls aus `connection.ts` ohne Verhaltenswechsel als reiner Refactor. Das ist die kleinste Aktion, die uns den größten Architektur-Hebel verschafft.
