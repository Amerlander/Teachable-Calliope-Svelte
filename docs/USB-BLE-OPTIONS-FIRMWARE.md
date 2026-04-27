Frage 1 — DFU/BLE ohne OS-Pairing: Ja, technisch sauber möglich. In FIRMWARE/codal-microbit-v2/inc/MicroBitConfig.h:184 existiert bereits MICROBIT_BLE_OPEN als bewusst vorgesehener Schalter, der SECURITY_MODE=1, WHITELIST=0 und unbegrenztes Advertising aktiviert. Empfohlene Mittelvariante: nur MICROBIT_BLE_WHITELIST=0 setzen, Bonding/Encryption beibehalten — verschlüsselt, aber ohne aktives Whitelisten, "Just Works"-Pairing oft transparent.

Frage 2 — stille Ablehnung verbessern: Die Ablehnung passiert im Nordic SoftDevice Link-Layer-Filter (MicroBitBLEManager.cpp:1193) — der Application-Layer sieht den Connection Request also gar nicht; deshalb auch keine LED-Reaktion möglich. Was geht: auf BLE_GAP_EVT_AUTH_STATUS-Fail (der wird gefeuert, wenn ein verbundener Peer ohne gültigen Bond etwas Verschlüsseltes lesen will) ein LED-Muster anzeigen — ~20 Zeilen Patch. App-seitig: schneller Timeout (~7 s) + OS-spezifischer "vergessen & neu koppeln"-Wizard, weil der Browser das Problem nicht selbst lösen kann.

Empfehlung: "Teachable"-Firmware mit WHITELIST=0 + Auth-Fail-LED-Feedback — löst beide Fragen ohne offenes BLE.




# Optionen jenseits des Standard-Firmware-Verhaltens

Dieses Dokument analysiert zwei Fragen, die nicht in der Anwendungs-Schicht (Browser/App) gelöst werden, sondern in der **Calliope-Firmware** selbst — also `FIRMWARE/codal-microbit-v2`. Begleitdokument zu [USB-BLE-STRATEGY.md](USB-BLE-STRATEGY.md).

## Frage 1: BLE-/DFU-Flashen ohne OS-Pairing — möglich?

**Kurz: Ja, technisch sauber. Es existiert bereits ein Compile-Flag.**

### Der bereits vorhandene Schalter `MICROBIT_BLE_OPEN`

In [`FIRMWARE/codal-microbit-v2/inc/MicroBitConfig.h`](../../FIRMWARE/codal-microbit-v2/inc/MicroBitConfig.h#L184-L194) gibt es einen "Convenience"-Schalter:

```c
#ifndef MICROBIT_BLE_OPEN
    #define MICROBIT_BLE_OPEN                       0
#endif

#if CONFIG_ENABLED(MICROBIT_BLE_OPEN)
    #define MICROBIT_BLE_SECURITY_MODE              1   // SEC_OPEN
    #define MICROBIT_BLE_WHITELIST                  0
    #define MICROBIT_BLE_ADVERTISING_TIMEOUT        0
    #define MICROBIT_BLE_DEFAULT_TX_POWER           6
#endif
```

Setzt man das Flag auf `1` und kompiliert die Firmware neu, fallen genau die drei Hürden weg, die heute Pairing erzwingen:

| Voreinstellung | `MICROBIT_BLE_OPEN=1` | Bedeutung |
|---|---|---|
| `MICROBIT_BLE_SECURITY_MODE=3` (MITM) | `=1` (OPEN_LINK) | Charakteristika sind ohne Encryption lesbar/schreibbar |
| `MICROBIT_BLE_WHITELIST=1` | `=0` | Geräte verbindet sich auch mit unbekannten Peers |
| `MICROBIT_BLE_ADVERTISING_TIMEOUT` (CODAL-Default) | `=0` | Werbt dauerhaft, nicht nur kurz nach Reset |
| `MICROBIT_BLE_ENABLE_BONDING=true` | bleibt `true`, aber durch Sec-Mode 1 nie ausgelöst | Pairing-Prompt fällt weg |

Das ist genau das, was die Web-Bluetooth-API braucht: Connect → GATT-Discovery → Notify+Write — ohne dass der Browser jemals einen Bond initiieren müsste (was er auch gar nicht kann).

### Was das praktisch heißt

- **Eine eigene "Teachable"-Firmware** (oder ein eigenes MakeCode-Target) mit `MICROBIT_BLE_OPEN=1` würde Browser-only-Flashen **vollständig** ermöglichen — Partial Flashing, UART, alles.
- Die Firmware würde sich beim ersten `requestDevice()`/`connect()` ohne Nachfrage verbinden, und der Partial-Flashing-Service `e97dd91d-…` wäre ohne `BLE_GAP_SEC_STATUS` direkt beschreibbar.
- Es ist **derselbe Mechanismus**, den die offiziellen `microbit-samples` für Entwickler-Builds nutzen — kein Hack, sondern ein bewusst vorgesehener Modus.

### Konkreter Pfad

1. Eigener Build-Target-Branch in [`pxt-calliope`](../../MAKECODE/pxt-calliope/) (oder direkt `microbit-v2-samples`) mit Patch in der `MicroBitConfig.h` oder über `-DMICROBIT_BLE_OPEN=1` in `compile_options`.
2. Alternativ: nur **Whitelist** ausschalten (`MICROBIT_BLE_WHITELIST=0`), Bonding/Encryption beibehalten — dann verbindet sich der Calliope mit **jedem** Gerät, verschlüsselt aber weiterhin. Browser akzeptieren das, der Bond-Prompt erscheint dann beim ersten Encrypted-Read, oft transparent als "Just Works"-Pairing ohne PIN.
3. Eigener Image-Name "Calliope mini Teachable", damit Lehrer:innen die offene Variante bewusst auswählen.

### Sicherheits- und Schul-Implikationen ehrlich

- Mit `MICROBIT_BLE_OPEN=1` kann **jedes** Gerät in Reichweite den Calliope flashen — in einem Klassenzimmer mit 25 Calliopes ist das ein realer DoS- und Spaß-Vektor. Empfehlung deshalb: Variante mit `WHITELIST=0` + Bonding aktiv → Pairing geschieht weiterhin verschlüsselt, aber ohne aktives whitelisten in der Firmware. So bleibt eine Hürde gegen Drive-by-Flashing.
- Vorhandene Bonds gehen bei einem Firmware-Update üblicherweise verloren (Flash-Sektor mit Peer-Manager-Daten wird mit überschrieben). Das beseitigt nebenbei auch alte verwaiste Bonds — siehe Frage 2.
- Wer sich strikt an die offizielle micro:bit-Firmware halten will, kann diesen Schritt nicht gehen: dann bleibt nur OS-Pairing.

### Variante: Pairing-Lite via Button-Geste

Statt komplett offen wäre auch denkbar, beim Boot-Time-Button-Halten kurzzeitig in einen "Open-Window"-Modus zu wechseln (z. B. 60 s). Im normalen Betrieb bleibt Whitelist aktiv, aber während der "Window-Phase" ohne. Das ist genau das, was `pairingMode()` heute macht — nur dass es heute **trotzdem** in Bonding mündet. Eine schlankere Variante würde `pm_whitelist_set(NULL, 0)` in `pairingMode()` aufrufen und SEC_OPEN als zeitweiligen Modus aktivieren. Das ist ein Patch von ~30 Zeilen in [`MicroBitBLEManager.cpp`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L800-L830) (siehe `pairingMode()`). Nachteil: erfordert immer noch Knopfdruck am Gerät — Grenze: das ist bei großen Klassen mühsam, aber explizit „User-Intent".

## Frage 2: Stille Ablehnung bei fehlendem Bond — verbesserbar?

**Kurz: Ja, aber das saubere "Why" passiert in der Firmware. Im Browser bleibt nur Heuristik.**

### Warum das heute still passiert

Die Ablehnung passiert nicht im GATT-Layer (also nach Connect), sondern im **Link-Layer-Filter** des Nordic SoftDevice — `gap_adv_params.filter_policy` ist auf "nur Whitelist" gesetzt ([`MicroBitBLEManager.cpp:1193`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L1193)). Connection Requests von nicht-gewhitelisteten Peers werden **vom SoftDevice verworfen, bevor der Application-Layer überhaupt aufwacht**. Das Gerät hat keine Chance, eine Notification zu senden — es weiß zu diesem Zeitpunkt selbst nicht, dass jemand es ansprechen wollte.

Dasselbe gilt umgekehrt: der Browser bekommt vom OS einen generischen `GATT_ERROR (133)` oder `Connection Failed to Establish` — ohne semantische Information, dass es am fehlenden Bond lag.

### Verbesserungsmöglichkeiten in der Firmware

1. **Sichtbares Feedback bei abgewiesener Verbindung.**
   Auch wenn der App-Layer Connection Requests nicht direkt sieht, bekommt er sehr wohl mit, wenn sich jemand über `BLE_GAP_EVT_CONNECTED` mit "auth failure" wieder trennt. In `microbit_ble_evt_handler` ([`MicroBitBLEManager.cpp:1328-1329`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L1328-L1329)) wird `BLE_GAP_EVT_AUTH_STATUS` bereits verarbeitet. Erweiterung: bei `auth_status != SUCCESS` ein **LED-Muster** (z. B. blinkendes "?" oder ein Schloss-Icon) für 3 s anzeigen. Dann sieht der/die Nutzer:in **am Gerät**, dass eine Verbindung scheiterte — und nicht erst, nachdem sie 30 s in der App auf "verbinde…" gestarrt hat.
   Aufwand: ~20 Zeilen, eigenständiger Patch.

2. **Connection Request Listener trotz Whitelist (Advertising-Set-Variante).**
   Mit dem Nordic SoftDevice ≥ 7.x und `BLE_GAP_ADV_FP_FILTER_BOTH` lassen sich auch zurückgewiesene Requests im `BLE_GAP_EVT_RSSI_CHANGED` oder über extended advertising sehen. Realistisch komplex; Empfehlung: Variante 1.

3. **"Pair-needed"-Service unverschlüsselt lassen.**
   Ein einzelner GATT-Service mit einer Read-Charakteristik, die *ohne* Encryption les- und nur als Read antwortbar ist, würde dem Browser auch ohne Bond eine kurze Status-Antwort liefern ("hello, pair me"). Das setzt voraus, dass die Whitelist *aus* ist (siehe Frage 1, Variante 2). Damit wäre der Connect erfolgreich, das Pair-Erfordernis aber explizit kommuniziert. Ist effektiv eine Mischung aus Frage 1 + 2.

4. **Bond-Slot-Aufräumung sichtbar machen.**
   `MICROBIT_BLE_MAXIMUM_BONDS` ist begrenzt; volle Slots erzwingen den Löschpfad in [`MicroBitBLEManager.cpp:395-404`](../../FIRMWARE/codal-microbit-v2/source/bluetooth/MicroBitBLEManager.cpp#L395-L404), was sich nach außen nicht zeigt. Patch: beim Verdrängen kurz eine Meldung auf der LED-Matrix scrollen ("BOND FULL — deleted oldest"). Nachteil: keine Hilfe für den eigentlichen Whitelist-Mismatch-Fall, aber löst eine andere häufige Ursache desselben Symptoms.

### Verbesserungsmöglichkeiten App-seitig (Browser)

Der Browser kann das *Problem* nicht beheben, aber das *Erleben* drastisch verbessern:

1. **Schneller Timeout + klare Diagnose-Heuristik.**
   Wenn `bluetoothDevice.gatt.connect()` länger als ~7 s ohne Resolve hängt, ist das praktisch immer ein Whitelist/Bond-Mismatch. Promise mit `AbortController` abschneiden, dem User sofort den OS-Pair-Modal anbieten — nicht warten, bis das OS einen generischen Fehler zurückgibt.
2. **Bond-Recreate-Anleitung wie in der Android-App.**
   Die Android-App ([`PartialFlashingService.kt:1138-1229`](../../Calliope-Android-App/app/src/main/java/cc/calliope/mini/core/service/partialflashing/PartialFlashingService.kt)) räumt auf GATT-Fehler 5/19/22/133 mit *Service-Cache leeren + ggf. Bond löschen + neu Bonden*. Im Web können wir den ersten Schritt nicht selbst machen, aber wir können mit OS-spezifischer Anleitung "Calliope vergessen → neu pairen" sehr genau das nachstellen, was die Android-App automatisch tut.
3. **Connect-Anzeige am Gerät erfragen.**
   Falls Variante 1 in der Firmware umgesetzt wird (LED-Muster bei Auth-Fail), die App-UX darauf abstimmen: "Schau auf den Calliope — siehst du ein Schloss-Symbol? Dann bitte einmal in den OS-Einstellungen vergessen und neu koppeln."

## Empfehlungs-Matrix

| Maßnahme | Wo | Aufwand | Wirkung | Risiko |
|---|---|---|---|---|
| Eigene Firmware mit `MICROBIT_BLE_WHITELIST=0`, Bonding aktiv | FIRMWARE | klein (1 Define) | Pair-Schritt entfällt **bei Erst-Connect**, danach normal | Drive-by-Pairing in Reichweite |
| Eigene Firmware mit `MICROBIT_BLE_OPEN=1` (Demo/Workshop) | FIRMWARE | klein (1 Define) | komplett offen, Browser-only | Klassenraum-DoS möglich |
| LED-Feedback auf `BLE_GAP_EVT_AUTH_STATUS`-Fail | FIRMWARE | klein (~20 LoC) | User sieht *am Gerät*, dass Verbindung scheiterte | keins |
| Pair-Window via Button-Geste (zeitweise OPEN) | FIRMWARE | mittel (~30 LoC) | User-Intent gewahrt, Drive-by reduziert | Lehrer-Training nötig |
| Schneller Connect-Timeout + Diagnose-Modal | App | klein | UX bei Whitelist-Loch deutlich besser | keins |
| OS-spezifischer "Calliope vergessen"-Wizard | App | mittel | repariert den Hauptbug-Fall | keins |

## Empfehlung in einem Satz

**Den größten Hebel hat eine "Teachable"-Firmware-Variante mit `MICROBIT_BLE_WHITELIST=0` + LED-Feedback bei Auth-Fail** — das löst Frage 1 elegant (Browser kann ohne OS-Pairing initiieren), Frage 2 sichtbar (Nutzer:in sieht Ablehnung am Gerät), und behält Verschlüsselung bei. App-seitige Verbesserungen sind unabhängig davon Pflicht-Polish.
