import { writable, type Readable } from 'svelte/store';
import {
  createWebUSBConnection,
  createWebBluetoothConnection,
  ConnectionStatus,
  BluetoothPartialFlashDalMismatchError,
  BluetoothPartialFlashServiceMissingError,
  flashOverBluetooth,
  type BluetoothFlashPhase,
  type MicrobitWebUSBConnection,
  type MicrobitWebBluetoothConnection,
  type BoardVersion,
} from '@microbit/microbit-connection';

/**
 * Active transport for an open connection. Mirrors which physical channel is
 * carrying serial today. Distinct from `CalliopeTransportMode` (the user's
 * preferred flashing strategy).
 */
export type CalliopeTransport = 'usb' | 'ble';

/**
 * User's preferred way of getting code onto the board.
 *
 * - `usb` — flash and stream over WebUSB. Default for first-time users.
 * - `ble-full` — flash and stream over Web Bluetooth. Requires that the
 *   Calliope is already paired/bonded at OS level (Just Works, no PIN); the
 *   browser cannot trigger bonding itself.
 * - `ble-hybrid` — stream over BLE, but flash over USB. When a flash is
 *   requested we surface a "plug in USB" prompt; after the flash finishes we
 *   return to BLE for live communication. For users who can't or won't pair on
 *   OS level.
 */
export type CalliopeTransportMode = 'usb' | 'ble-full' | 'ble-hybrid';

export type CalliopeStatus =
  | 'unknown'
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'flashing'
  | 'error';

/**
 * Calliope hardware family. Independent of the micro:bit library's BoardVersion
 * (which only knows V1/V2). Calliope mini 1 and 2 both ship the DAL firmware and
 * map to micro:bit V1-class silicon; mini 3 ships CODAL and maps to V2-class silicon.
 * We derive the Calliope version from the WebUSB device's productName string
 * (DAPLink reports "Arm Calliope mini V3 CMSIS-DAP" for mini 3).
 */
export type CalliopeVersion = 'V1' | 'V2' | 'V3';

/**
 * Pre-flash phase the BLE flash protocol is currently in. Used by the UI to
 * show an indeterminate spinner with a meaningful label while we're not yet
 * transferring data — checking the device, rebooting it into pairing mode,
 * etc. Once `'flashing'` is reached we have a real percentage to show.
 */
export type CalliopeFlashPhase = 'check' | 'reboot' | 'prepare' | 'flashing' | 'finalising';

export interface CalliopeState {
  status: CalliopeStatus;
  boardVersion?: BoardVersion;
  /** Calliope-family version — V1/V2 (DAL) or V3 (CODAL). */
  calliopeVersion?: CalliopeVersion;
  /** 0–100 once the actual flash data transfer is running. Undefined while
   *  in a pre-flash phase (the UI shows an indeterminate spinner instead). */
  flashProgress?: number;
  /** Active phase — only meaningful while `status === 'flashing'`. */
  flashPhase?: CalliopeFlashPhase;
  flashPartial?: boolean;
  errorMessage?: string;
  lastFlashName?: string;
  lastFlashAt?: number;
  /** Which transport `status` currently reflects. */
  transport: CalliopeTransport;
  /** User's preferred flash strategy. Persisted in localStorage. */
  transportMode: CalliopeTransportMode;
  /** Whether the browser supports each transport. */
  usbSupported: boolean;
  bleSupported: boolean;
  /** Human-readable name of the currently-selected mini (e.g. "Calliope mini [vavep]"
   *  for BLE, "Arm Calliope mini V3 CMSIS-DAP" for USB). Stays populated even
   *  while disconnected so the popover can show the last paired device. */
  deviceName?: string;
  /** Wall-clock time of the most recent successful (re)connect. */
  connectedAt?: number;
  /** True when there's a previously-permitted BLE device the browser remembers
   *  (so a Connect click can silent-resume without opening the picker). */
  hasPairedBleDevice: boolean;
}

function detectCalliopeVersion(
  productName: string | undefined,
  boardVersion: BoardVersion | undefined,
): CalliopeVersion | undefined {
  // Product name is the most reliable signal: DAPLink firmware on mini 3 advertises
  // "Arm Calliope mini V3 CMSIS-DAP". Older mini 1/2 boards advertise "V1"/"V2".
  if (productName) {
    const m = /Calliope[^V]*V(\d)/i.exec(productName);
    if (m) {
      const n = m[1];
      if (n === '1' || n === '2' || n === '3') return `V${n}` as CalliopeVersion;
    }
  }
  // Fall back to the micro:bit library's board version: mini 3 is CODAL/V2-class,
  // mini 1/2 are DAL/V1-class. Without the productName hint we can't disambiguate
  // mini 2 from mini 3, but we at least avoid labelling mini 3 as V1.
  if (boardVersion === 'V2') return 'V3';
  if (boardVersion === 'V1') return 'V1';
  return undefined;
}

const usbSupported =
  typeof navigator !== 'undefined' && 'usb' in navigator;
const bleSupported =
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

const TRANSPORT_MODE_STORAGE_KEY = 'calliope.transportMode';

function loadTransportMode(): CalliopeTransportMode {
  if (typeof localStorage === 'undefined') return usbSupported ? 'usb' : 'ble-hybrid';
  const v = localStorage.getItem(TRANSPORT_MODE_STORAGE_KEY);
  if (v === 'usb' || v === 'ble-full' || v === 'ble-hybrid') {
    // Sanity-clamp to what the browser actually supports.
    if (v === 'usb' && !usbSupported && bleSupported) return 'ble-full';
    if ((v === 'ble-full' || v === 'ble-hybrid') && !bleSupported) return 'usb';
    return v;
  }
  return usbSupported ? 'usb' : bleSupported ? 'ble-full' : 'usb';
}

const initial: CalliopeState = {
  status: usbSupported || bleSupported ? 'disconnected' : 'unknown',
  transport: usbSupported ? 'usb' : 'ble',
  transportMode: loadTransportMode(),
  usbSupported,
  bleSupported,
  hasPairedBleDevice: false,
};

const state = writable<CalliopeState>(initial);
export const calliopeState: Readable<CalliopeState> = { subscribe: state.subscribe };

// Ring buffer of TX/RX messages for the "communication log" panel.
//
// Repetitive serial traffic (e.g. the per-frame `C 0 100 99` confidence
// updates the Teachable streamer pumps every ~150 ms) would scroll legitimate
// info/error events off the top of the panel within a second. To keep the
// log readable, consecutive same-kind tx/rx entries are merged: only the
// latest payload is kept, but a `count` prefix shows how many times that
// pattern repeated. As soon as a different-kind line (info/error or
// different first token) arrives, a new merged group starts.
export interface CalliopeLogEntry {
  /** Stable id for keyed Svelte renders — does not change when a row is merged. */
  id: number;
  /** Wall-clock time of the most recent occurrence in this group. */
  time: number;
  direction: 'tx' | 'rx' | 'info' | 'error';
  /** Most recent payload (for tx/rx) or the message itself (info/error). */
  text: string;
  /** How many same-kind messages have been merged into this row. ≥ 1. */
  count: number;
  /** Optional grouping tag. When set, a new log entry with the same `kind`
   *  REPLACES the most recent entry instead of appending — used for streaming
   *  status (e.g. flash progress %) that would otherwise spam the log. */
  kind?: string;
}
const LOG_MAX = 200;
let logIdCounter = 0;
const logStore = writable<CalliopeLogEntry[]>([]);
export const calliopeLog: Readable<CalliopeLogEntry[]> = { subscribe: logStore.subscribe };

function messageKind(text: string): string {
  // First whitespace-delimited token. For protocol lines like "C 24 57 20"
  // this is just "C"; for "Connected (BLE)" it's "Connected".
  const idx = text.indexOf(' ');
  return idx < 0 ? text : text.slice(0, idx);
}

function appendLog(entry: Omit<CalliopeLogEntry, 'time' | 'id' | 'count'>) {
  logStore.update((arr) => {
    const last = arr.length > 0 ? arr[arr.length - 1] : undefined;
    // Explicit `kind` grouping: replace the most recent entry that has the
    // same kind in-place. Used for streaming status like flash percentage.
    if (entry.kind && last && last.kind === entry.kind) {
      const next = arr.slice();
      next[next.length - 1] = {
        ...last,
        time: Date.now(),
        text: entry.text,
        direction: entry.direction,
      };
      return next;
    }
    const mergeable =
      !!last &&
      (entry.direction === 'tx' || entry.direction === 'rx') &&
      last.direction === entry.direction &&
      messageKind(last.text) === messageKind(entry.text);
    if (mergeable && last) {
      // Replace the last entry in-place with an updated copy. We can't
      // mutate `last` directly because the store dispatches based on array
      // identity, so we shallow-copy the array and the last element.
      const next = arr.slice();
      next[next.length - 1] = {
        ...last,
        time: Date.now(),
        text: entry.text,
        count: last.count + 1,
      };
      return next;
    }
    const next = arr.length >= LOG_MAX ? arr.slice(arr.length - LOG_MAX + 1) : arr.slice();
    next.push({
      id: ++logIdCounter,
      time: Date.now(),
      count: 1,
      ...entry,
    });
    return next;
  });
}
export function clearCalliopeLog() {
  logStore.set([]);
}

// micro:bit / Calliope BLE UART Service UUIDs — exposed by MakeCode programs
// that include the `bluetooth` package and call `bluetooth.startUartService()`.
//
// IMPORTANT: micro:bit's UART characteristic naming follows the device's
// perspective, NOT the standard Nordic UART Service convention. Read carefully:
//   • 6e400002 = "TX from board's POV" — board writes here, browser SUBSCRIBES.
//   • 6e400003 = "RX from board's POV" — browser writes here, board reads.
// We previously had this swapped, which silently routed all our outgoing
// messages to the board's outbound buffer where they were ignored — the
// board never received any of the per-class confidence lines, so the
// `bluetooth.onUartDataReceived` handler in the seed program never fired.
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // browser → board (board's RX char)
const NUS_TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // board → browser (board's TX char, notify)

let usbConn: MicrobitWebUSBConnection | null = null;
let usbInitPromise: Promise<MicrobitWebUSBConnection> | null = null;
let bleConn: MicrobitWebBluetoothConnection | null = null;
let bleInitPromise: Promise<MicrobitWebBluetoothConnection> | null = null;
// Direct GATT handles for BLE UART. The lib's serialWrite is a no-op on BLE,
// and its eager UART service activation breaks connect when the running hex
// doesn't expose UART. We manage the characteristics ourselves so missing
// UART degrades gracefully (board still appears connected, just no data).
let bleRxChar: BluetoothRemoteGATTCharacteristic | null = null; // browser → board
let bleTxChar: BluetoothRemoteGATTCharacteristic | null = null; // board → browser
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let rxBuffer = '';
let bleRxBuffer = '';
let activeTransport: CalliopeTransport = initial.transport;
const HEARTBEAT_MS = 1000;

const bleLineSubs = new Set<(line: string) => void>();

function activeConn():
  | MicrobitWebUSBConnection
  | MicrobitWebBluetoothConnection
  | null {
  return activeTransport === 'usb' ? usbConn : bleConn;
}

async function bleSerialWrite(line: string): Promise<void> {
  if (!bleRxChar) return; // UART service wasn't available on this board
  const bytes = new TextEncoder().encode(line);
  const CHUNK = 20; // BLE UART characteristics commonly cap at 20 bytes per write
  const ch = bleRxChar as BluetoothRemoteGATTCharacteristic & {
    writeValueWithoutResponse?: (b: BufferSource) => Promise<void>;
  };
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    if (ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(slice);
    else await ch.writeValue(slice);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (activeTransport === 'usb') {
      if (!usbConn || usbConn.status !== ConnectionStatus.CONNECTED) return;
      void usbConn.serialWrite('H\n').catch(() => {});
    } else {
      if (!bleConn || bleConn.status !== ConnectionStatus.CONNECTED) return;
      void bleSerialWrite('H\n').catch(() => {});
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function mapStatus(s: ConnectionStatus): CalliopeStatus {
  switch (s) {
    case ConnectionStatus.NOT_SUPPORTED:
      return 'unsupported';
    case ConnectionStatus.SUPPORT_NOT_KNOWN:
      return 'unknown';
    case ConnectionStatus.NO_AUTHORIZED_DEVICE:
    case ConnectionStatus.DISCONNECTED:
      return 'disconnected';
    case ConnectionStatus.CONNECTING:
    case ConnectionStatus.RECONNECTING:
      return 'connecting';
    case ConnectionStatus.CONNECTED:
      return 'connected';
    default:
      return 'unknown';
  }
}

async function getUsbConnection(): Promise<MicrobitWebUSBConnection> {
  if (usbConn) return usbConn;
  if (usbInitPromise) return usbInitPromise;
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    state.update((s) => ({ ...s, status: 'unsupported' }));
    throw new Error('WebUSB not supported in this browser');
  }
  usbInitPromise = (async () => {
    const { DeviceSelectionMode } = await import('@microbit/microbit-connection');
    const c = createWebUSBConnection({
      deviceSelectionMode: DeviceSelectionMode.UseAnyAllowed,
    });
    await c.initialize();
    c.addEventListener('status', (ev) => {
      const mapped = mapStatus(ev.status);
      const bv = c.getBoardVersion();
      const pn = (c as unknown as { getDevice?: () => { productName?: string } | undefined })
        .getDevice?.()?.productName;
      const cv = detectCalliopeVersion(pn, bv);
      // Only apply to the shared state when USB is the active transport.
      // Otherwise USB's disconnect-on-boot-up would clobber the BLE status.
      const applyStatus = activeTransport === 'usb';
      state.update((s) => {
        if (!applyStatus) return { ...s, boardVersion: bv, calliopeVersion: cv ?? s.calliopeVersion };
        if (s.status === 'flashing' && mapped === 'connected') return s;
        return {
          ...s,
          status: mapped,
          boardVersion: bv,
          calliopeVersion: cv ?? s.calliopeVersion,
          errorMessage:
            mapped === 'error' || mapped === 'connected' ? undefined : s.errorMessage,
        };
      });
      if (!applyStatus) return;
      if (mapped === 'connected') {
        startHeartbeat();
        appendLog({ direction: 'info', text: 'Connected' });
        state.update((s) => ({
          ...s,
          deviceName: pn ?? s.deviceName ?? 'Calliope mini (USB)',
          connectedAt: Date.now(),
        }));
      } else {
        stopHeartbeat();
        if (mapped === 'disconnected') {
          appendLog({ direction: 'info', text: 'Disconnected' });
          state.update((s) => ({ ...s, connectedAt: undefined }));
        }
      }
    });
    c.addEventListener('backgrounderror', (ev) => {
      if (activeTransport !== 'usb') return;
      state.update((s) => ({
        ...s,
        status: 'error',
        errorMessage: ev.errorMessage,
        flashProgress: undefined,
      }));
      appendLog({ direction: 'error', text: ev.errorMessage });
    });
    c.addEventListener('serialdata', ((ev: unknown) => {
      // Buffer at the emitter and emit whole lines.
      const data = (ev as { data?: string })?.data ?? '';
      rxBuffer += data;
      let idx: number;
      while ((idx = rxBuffer.indexOf('\n')) >= 0) {
        const line = rxBuffer.slice(0, idx).replace(/\r$/, '');
        rxBuffer = rxBuffer.slice(idx + 1);
        if (line) appendLog({ direction: 'rx', text: line });
      }
    }) as EventListener);
    {
      const bv = c.getBoardVersion();
      const pn = (c as unknown as { getDevice?: () => { productName?: string } | undefined })
        .getDevice?.()?.productName;
      state.update((s) => ({
        ...s,
        status: mapStatus(c.status),
        boardVersion: bv,
        calliopeVersion: detectCalliopeVersion(pn, bv) ?? s.calliopeVersion,
      }));
    }
    usbConn = c;
    return c;
  })();
  return usbInitPromise;
}

/**
 * Create (or return the cached) BLE connection using @microbit/microbit-connection
 * (calliope-edu fork). The chooser filters by name prefix `Calliope mini`,
 * `BBC micro:bit`, and `uBit` — covering Calliope, regular micro:bit, and
 * legacy programs regardless of which hex (blocks/MakeCode/ml-trainer) the
 * board is running.
 */
async function getBleConnection(): Promise<MicrobitWebBluetoothConnection> {
  if (bleConn) return bleConn;
  if (bleInitPromise) return bleInitPromise;
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    state.update((s) => ({ ...s, status: 'unsupported' }));
    throw new Error('Web Bluetooth not supported in this browser');
  }
  bleInitPromise = (async () => {
    const c = createWebBluetoothConnection();
    await c.initialize();
    c.addEventListener('status', (ev) => {
      if (activeTransport !== 'ble') return;
      const mapped = mapStatus(ev.status);
      state.update((s) => {
        if (s.status === 'flashing') return s;
        return {
          ...s,
          status: mapped,
          errorMessage:
            mapped === 'error' || mapped === 'connected' ? undefined : s.errorMessage,
        };
      });
      if (mapped === 'connected') {
        startHeartbeat();
        appendLog({ direction: 'info', text: 'Connected (BLE)' });
        // The lib's auto-reconnect (after a flash reboot or a transient drop)
        // brings GATT back but does not reopen our UART subscription. Re-run
        // setupBleUart() on every (re)connect so sendSerialLine() actually
        // reaches the board. Skip while we're mid-flash — flashCalliopeViaBle
        // owns the partial-flashing characteristic and reopens UART itself
        // once the post-flash reset settles.
        let isFlashing = false;
        state.update((s) => { isFlashing = s.status === 'flashing'; return s; });
        if (!isFlashing) {
          void setupBleUart();
        }
      } else {
        stopHeartbeat();
        // Drop direct GATT handles so subsequent writes don't fire on a
        // closed device. setupBleUart() reopens them on the next connect.
        bleRxChar = null;
        bleTxChar = null;
        bleRxBuffer = '';
        if (mapped === 'disconnected') {
          appendLog({ direction: 'info', text: 'Disconnected (BLE)' });
          state.update((s) => ({ ...s, connectedAt: undefined }));
        }
      }
    });
    c.addEventListener('backgrounderror', (ev) => {
      if (activeTransport !== 'ble') return;
      state.update((s) => ({
        ...s,
        status: 'error',
        errorMessage: ev.errorMessage,
      }));
      appendLog({ direction: 'error', text: ev.errorMessage });
    });
    // Note: we deliberately do NOT subscribe to the lib's `uartdata` event.
    // The lib's UARTService eagerly calls getPrimaryService(NUS) when that
    // event is activated, which throws and kills the connection if the
    // running hex doesn't expose UART. We open the UART characteristic
    // ourselves in `setupBleUart()` after a successful connect, where a
    // missing service degrades to "connected, no data" instead of failing.
    bleConn = c;
    return c;
  })();
  return bleInitPromise;
}

/**
 * After the lib's connect() succeeds, manually open the Nordic UART service
 * on the underlying BluetoothDevice and wire up TX-notifications + RX-write.
 *
 * Right after a flash + reboot the board's user program needs a moment to
 * call `bluetooth.startUartService()` — the BLE stack registers the UART
 * service only once that call happens. So we retry a few times with backoff
 * before giving up. On a board that legitimately doesn't expose UART (a
 * non-Teachable hex) the retry loop simply ends with a warning; we stay
 * connected, just no data flows.
 */
async function setupBleUart(): Promise<void> {
  bleRxChar = null;
  bleTxChar = null;
  const device = (bleConn as unknown as { device?: BluetoothDevice } | null)?.device;
  const gatt = device?.gatt;
  if (!gatt?.connected) return;
  // Backoff schedule: 0s, 0.5s, 1.5s, 3s, 5s — totalling ~10s of patience for
  // the user's program to start UART.
  const delays = [0, 500, 1000, 1500, 2000];
  let service: BluetoothRemoteGATTService | undefined;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    if (!gatt.connected) return; // lost connection mid-retry
    try {
      service = await gatt.getPrimaryService(NUS_SERVICE_UUID);
      break;
    } catch {
      // Not yet — try again after the next backoff slot.
    }
  }
  if (!service) {
    appendLog({
      direction: 'info',
      text: 'No UART service on this board — flash a program with bluetooth.startUartService() to stream data over BLE.',
    });
    // The Teachable seed program always exposes UART, so on Teachable the
    // service-missing case nearly always means "BLE connected but the OS
    // bond is missing — Calliope hides authenticated services from
    // unbonded peers". Prompt the OS-pairing explainer so the user knows
    // how to fix it. We don't gate this on `hasSeenBlePairingInfo` —
    // re-surfacing it on a failed connect is the whole point.
    const mode = readMode();
    if (mode === 'ble-full' || mode === 'ble-hybrid') {
      blePairingInfoVisible.set(true);
    }
    return;
  }
  try {
    bleRxChar = await service.getCharacteristic(NUS_RX_CHAR_UUID);
    bleTxChar = await service.getCharacteristic(NUS_TX_CHAR_UUID);
    // Cast to a structural type since the bundled DOM lib types only declare
    // a subset of the Web Bluetooth GATT characteristic API.
    type TxChar = BluetoothRemoteGATTCharacteristic & {
      startNotifications: () => Promise<unknown>;
      addEventListener: (
        type: string,
        listener: () => void,
      ) => void;
      value?: DataView;
    };
    const tx = bleTxChar as unknown as TxChar;
    await tx.startNotifications();
    tx.addEventListener('characteristicvaluechanged', () => {
      const v = tx.value;
      if (!v) return;
      bleRxBuffer += new TextDecoder().decode(new Uint8Array(v.buffer));
      let idx: number;
      while ((idx = bleRxBuffer.indexOf('\n')) >= 0) {
        const line = bleRxBuffer.slice(0, idx).replace(/\r$/, '');
        bleRxBuffer = bleRxBuffer.slice(idx + 1);
        if (!line) continue;
        appendLog({ direction: 'rx', text: line });
        bleLineSubs.forEach((cb) => { try { cb(line); } catch { /* ignore */ } });
      }
    });
    appendLog({ direction: 'info', text: 'BLE UART ready' });
  } catch (e) {
    bleRxChar = null;
    bleTxChar = null;
    appendLog({ direction: 'error', text: `BLE UART setup failed: ${(e as Error).message}` });
  }
}

async function connectWithRetry(c: MicrobitWebUSBConnection, tries = 2): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await c.connect();
      return;
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? '';
      // User cancellation and unsupported — don't retry.
      if (/no-device-selected|cancell|not.?supported/i.test(msg)) throw err;
      appendLog({
        direction: 'info',
        text: `Connect attempt ${i + 1} failed: ${msg}`,
      });
      // Brief backoff; DAPLink sometimes needs a moment after a failed handshake.
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

/**
 * Optional-services list the lib needs available on the GATT server after
 * pairing. Mirrors the lib's hard-coded list so its post-connect calls (e.g.
 * `getBoardVersion()` reading the device-info service) still work even though
 * we're picking the device with `acceptAllDevices` ourselves.
 */
const BLE_OPTIONAL_SERVICES = [
  'e95d0753-251d-470a-a062-fa1922dfa9a8', // accelerometer
  'e95d9882-251d-470a-a062-fa1922dfa9a8', // button
  '0000180a-0000-1000-8000-00805f9b34fb', // device_information
  'e95d93b0-251d-470a-a062-fa1922dfa9a8', // dfu_control
  'e95d93af-251d-470a-a062-fa1922dfa9a8', // event
  'e95d127b-251d-470a-a062-fa1922dfa9a8', // io_pin
  'e95dd91d-251d-470a-a062-fa1922dfa9a8', // led
  'e95df2d8-251d-470a-a062-fa1922dfa9a8', // magnetometer
  'e95d6100-251d-470a-a062-fa1922dfa9a8', // temperature
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // nordic UART
  'e97dd91d-251d-470a-a062-fa1922dfa9a8', // partial flashing
];

interface PickedDevice {
  device: BluetoothDevice;
  /** Came from `getDevices()` — i.e. previously-permitted, no chooser shown. */
  fromCache: boolean;
}

/**
 * Reset BLE-related cached state to a clean slate. Empirically, Chrome's
 * Web Bluetooth picker stops scanning for new devices after a few back-to-
 * back failed/aborted attempts — users found that toggling transport modes
 * and back unsticks it. Doing the same teardown ourselves before every
 * connect/picker open avoids the "no devices found" trap without the user
 * having to mode-cycle manually.
 */
async function resetBleConnectionState(): Promise<void> {
  if (bleConn) {
    try { await disconnectCalliope(); } catch { /* ignore */ }
  }
  bleConn = null;
  bleInitPromise = null;
  bleRxChar = null;
  bleTxChar = null;
  // Brief pause so Chrome's adapter view actually settles before the next
  // requestDevice scan. Without this, the chooser frequently opens with an
  // empty list even though a Calliope is broadcasting in range.
  await new Promise((r) => setTimeout(r, 250));
}

/**
 * Pick a Calliope to connect over BLE. We try `getDevices()` first — that
 * returns devices the user has already granted permission to in any prior
 * session, even if they're currently only doing directed advertising (which
 * happens with `whitelist=1` + an existing OS bond, the default for Calliope
 * mini 3). Chrome's `requestDevice` chooser only shows actively-broadcast
 * advertising, so an OS-paired Calliope in app mode would otherwise be
 * invisible — exactly the problem we hit. If `forceChooser` is set, or no
 * permitted device is available, we fall back to the chooser.
 */
async function pickBleDevice(forceChooser: boolean): Promise<PickedDevice | null> {
  const bt = (navigator as unknown as {
    bluetooth: {
      requestDevice: (opts: unknown) => Promise<BluetoothDevice>;
      getDevices?: () => Promise<BluetoothDevice[]>;
    };
  }).bluetooth;
  if (!forceChooser && bt.getDevices) {
    try {
      const known = await bt.getDevices();
      if (known.length === 1) {
        const dev = known[0] as unknown as { name?: string; id?: string };
        appendLog({
          direction: 'info',
          text: `Reusing previously-paired device: ${dev.name ?? dev.id ?? 'BLE device'}`,
        });
        return { device: known[0], fromCache: true };
      }
      // With more than one previously-paired device we can't disambiguate
      // without UI, so fall through to the chooser. Single-device classrooms
      // are the common case anyway.
      if (known.length > 1) {
        appendLog({
          direction: 'info',
          text: `${known.length} previously-paired devices — opening chooser to pick one.`,
        });
      }
    } catch (err) {
      appendLog({ direction: 'info', text: `getDevices failed: ${(err as Error).message}` });
    }
  }
  // Use explicit name-prefix filters instead of acceptAllDevices. Chrome's
  // newer Web Bluetooth chooser (the "permissions backend" UI) sometimes
  // returns an empty list with acceptAllDevices when the origin already has
  // device permissions cached — even though every Calliope in range is
  // advertising. Active scanning by namePrefix bypasses that quirk and also
  // gives a much cleaner picker (no headphones / wrist-bands etc).
  try {
    const picked = await bt.requestDevice({
      filters: [
        { namePrefix: 'Calliope mini' }, // Calliope mini 1/2/3 across firmwares
        { namePrefix: 'BBC micro:bit' }, // micro:bit family
        { namePrefix: 'uBit' },          // legacy programs
      ],
      optionalServices: BLE_OPTIONAL_SERVICES,
    });
    return { device: picked, fromCache: false };
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (/no-device-selected|cancell/i.test(msg)) return null;
    // Fall back to a wide-open chooser if name filtering itself failed for
    // some reason — better to surface a noisy picker than nothing.
    if (/type|filter/i.test(msg)) {
      try {
        const picked = await bt.requestDevice({
          acceptAllDevices: true,
          optionalServices: BLE_OPTIONAL_SERVICES,
        });
        return { device: picked, fromCache: false };
      } catch (e2) {
        const m2 = (e2 as Error)?.message ?? '';
        if (/no-device-selected|cancell/i.test(m2)) return null;
        throw e2;
      }
    }
    throw err;
  }
}

async function attachBleDeviceAndConnect(
  c: MicrobitWebBluetoothConnection,
  picked: PickedDevice,
): Promise<void> {
  (c as unknown as { device?: BluetoothDevice }).device = picked.device;
  const meta = picked.device as unknown as { name?: string; id?: string };
  const label = meta.name ?? meta.id ?? 'BLE device';
  appendLog({
    direction: 'info',
    text: `${picked.fromCache ? 'Resuming' : 'Selected'}: ${label}`,
  });
  // Reflect the chosen device immediately in state so the popover shows the
  // human-readable name even while we're still negotiating the GATT link.
  state.update((s) => ({ ...s, deviceName: label, hasPairedBleDevice: true }));
  await c.connect();
  await setupBleUart();
  state.update((s) => ({ ...s, connectedAt: Date.now() }));
}

/**
 * Refresh whether the browser remembers a previously-permitted BLE device for
 * this origin. Called on init and after forget/pair operations so the UI can
 * conditionally show the "forget device" action and the OS-pairing info modal.
 */
async function refreshPairedBleStatus(): Promise<void> {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) return;
  const bt = (navigator as unknown as {
    bluetooth: { getDevices?: () => Promise<BluetoothDevice[]> };
  }).bluetooth;
  if (!bt.getDevices) return;
  try {
    const known = await bt.getDevices();
    const first = known[0] as unknown as { name?: string; id?: string } | undefined;
    state.update((s) => ({
      ...s,
      hasPairedBleDevice: known.length > 0,
      // Only remember the name if we don't already have one from an active
      // session — an active connection's name is more informative.
      deviceName: s.deviceName ?? first?.name ?? first?.id,
    }));
  } catch {
    /* permissions backend unavailable — leave state alone */
  }
}

/**
 * Drop the browser's permission grant for the currently-paired BLE device.
 * Useful when the user wants to switch to a different mini: without this, the
 * picker stays empty for the old device (Chrome hides already-permitted
 * devices from the chooser) and the new mini might never appear.
 *
 * Note: this only forgets the *browser* permission. The OS-level Bluetooth
 * pairing is separate and untouched — the user clears that in the OS settings
 * when they want to fully unpair.
 */
export async function forgetCalliopeBleDevice(): Promise<void> {
  // Disconnect first so we don't accidentally keep talking to a device the
  // user is trying to walk away from.
  if (bleConn?.status === ConnectionStatus.CONNECTED) {
    try { await disconnectCalliope(); } catch { /* ignore */ }
  }
  const device = (bleConn as unknown as { device?: BluetoothDevice } | null)?.device;
  const forgetable = device as unknown as { forget?: () => Promise<void> } | undefined;
  if (forgetable?.forget) {
    try {
      await forgetable.forget();
      appendLog({ direction: 'info', text: 'BLE device permission revoked.' });
    } catch (err) {
      appendLog({
        direction: 'error',
        text: `Forget failed: ${(err as Error).message}`,
      });
    }
  }
  // Also forget anything else the browser remembers for this origin so the
  // next picker is fresh (covers cases where bleConn.device wasn't the same
  // BluetoothDevice handle returned by getDevices()).
  if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
    const bt = (navigator as unknown as {
      bluetooth: { getDevices?: () => Promise<BluetoothDevice[]> };
    }).bluetooth;
    if (bt.getDevices) {
      try {
        const all = await bt.getDevices();
        for (const d of all) {
          const f = d as unknown as { forget?: () => Promise<void> };
          if (f.forget) {
            try { await f.forget(); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
  }
  // Drop our cached connection wrapper so the next connect builds a clean one.
  bleConn = null;
  bleInitPromise = null;
  bleRxChar = null;
  bleTxChar = null;
  state.update((s) => ({
    ...s,
    hasPairedBleDevice: false,
    deviceName: undefined,
    connectedAt: undefined,
  }));
}

export async function connectCalliope(forceChooser = false): Promise<void> {
  try {
    if (activeTransport === 'ble') {
      // Reset BLE state before every connect attempt. Mirrors the manual
      // mode-toggle workaround users had to do when Chrome's picker stopped
      // scanning between attempts.
      await resetBleConnectionState();
      const c = await getBleConnection();
      const picked = await pickBleDevice(forceChooser);
      if (!picked) {
        state.update((s) => ({ ...s, status: 'disconnected', errorMessage: undefined }));
        return;
      }
      try {
        await attachBleDeviceAndConnect(c, picked);
      } catch (err) {
        // The cached device may be stale (out of range, OS bond gone,
        // running a hex without BLE). Fall back to the chooser so the user
        // can pick a fresh one without having to dig out the "Anderes Gerät"
        // link first.
        if (picked.fromCache) {
          appendLog({
            direction: 'info',
            text: `Cached device didn't respond — opening chooser…`,
          });
          // Chrome's permissions backend hides already-permitted devices
          // from the chooser even when they're broadcasting. Forget the
          // cached device first so the new requestDevice() shows it again.
          const forgetable = picked.device as unknown as { forget?: () => Promise<void> };
          if (typeof forgetable.forget === 'function') {
            try {
              await forgetable.forget();
              appendLog({ direction: 'info', text: 'Forgot stale cached device.' });
            } catch (forgetErr) {
              appendLog({
                direction: 'info',
                text: `Forget failed (non-fatal): ${(forgetErr as Error).message}`,
              });
            }
          }
          const re = await pickBleDevice(true);
          if (!re) {
            state.update((s) => ({ ...s, status: 'disconnected', errorMessage: undefined }));
            return;
          }
          await attachBleDeviceAndConnect(c, re);
        } else {
          throw err;
        }
      }
    } else {
      const c = await getUsbConnection();
      await connectWithRetry(c);
    }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (/no-device-selected|cancell/i.test(message)) {
      state.update((s) => ({ ...s, status: 'disconnected', errorMessage: undefined }));
      return;
    }
    state.update((s) => ({ ...s, status: 'error', errorMessage: message }));
  }
}

export async function disconnectCalliope(): Promise<void> {
  const c = activeConn();
  if (!c) return;
  // Cap the wait so a stuck lib disconnect can't trap the user — the BLE
  // wrapper has been seen to wait forever on `gatt.disconnect()` if Chrome
  // and the device disagree about the link state. After the timeout we just
  // forge ahead; subsequent connect attempts open a fresh GATT anyway.
  const t = new Promise<void>((res) => setTimeout(res, 2000));
  try {
    await Promise.race([c.disconnect(), t]);
  } catch {
    /* ignore */
  }
}

/**
 * Whether the user has been shown the BLE OS-pairing explainer at least once.
 * The modal explains a constraint that doesn't change between sessions, so
 * once acknowledged we don't badger them again.
 */
const BLE_PAIRING_INFO_SEEN_KEY = 'calliope.blePairingInfoSeen';

function hasSeenBlePairingInfo(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(BLE_PAIRING_INFO_SEEN_KEY) === '1';
}

function markBlePairingInfoSeen(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(BLE_PAIRING_INFO_SEEN_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Visible signal that the UI should pop up the OS-pairing explainer. The
 * modal component subscribes and clears the flag (via `dismissBlePairingInfo`)
 * once the user closes it.
 */
const blePairingInfoVisible = writable(false);
export const calliopeBlePairingInfo: Readable<boolean> = {
  subscribe: blePairingInfoVisible.subscribe,
};
export function dismissBlePairingInfo(): void {
  markBlePairingInfoSeen();
  blePairingInfoVisible.set(false);
}
/** Force-show the modal (for the "What is OS pairing?" link in the popover). */
export function showBlePairingInfo(): void {
  blePairingInfoVisible.set(true);
}

/**
 * Set the user's preferred flash strategy. Persisted across reloads. Updating
 * the mode also picks a sensible active transport: `usb` mode opens USB,
 * `ble-*` modes open BLE (the hybrid mode only switches to USB transiently
 * during a flash). The actual connection is not opened here — the user clicks
 * Connect in the UI.
 */
export function setCalliopeTransportMode(mode: CalliopeTransportMode): void {
  if (mode === 'usb' && !usbSupported) return;
  if ((mode === 'ble-full' || mode === 'ble-hybrid') && !bleSupported) return;
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(TRANSPORT_MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }
  state.update((s) => ({ ...s, transportMode: mode }));
  // Align active transport with the mode so a fresh Connect uses the right one.
  const desired: CalliopeTransport = mode === 'usb' ? 'usb' : 'ble';
  if (desired !== activeTransport) {
    void setCalliopeTransport(desired);
  }
  appendLog({ direction: 'info', text: `Flash mode: ${mode}` });
  // First-time switch into ble-full triggers the OS-pairing explainer. The
  // browser has no API to query OS-level pairing state, so we use "no paired
  // device on file for this origin" as a proxy for "this user probably hasn't
  // set up bonding yet". Hybrid mode doesn't need this — the BLE side is just
  // for live data, no flash protocol is involved, no PIN required.
  if (mode === 'ble-full' && !hasSeenBlePairingInfo()) {
    let hasPair = false;
    state.update((s) => { hasPair = s.hasPairedBleDevice; return s; });
    if (!hasPair) blePairingInfoVisible.set(true);
  }
}

/**
 * Switch between USB and BLE. Disconnects whichever transport is currently
 * active before the switch; the user then clicks Connect to pair over the new
 * transport. We never auto-connect on switch because BLE, unlike USB, has no
 * silent "already-authorized" reconnect path.
 */
export async function setCalliopeTransport(t: CalliopeTransport): Promise<void> {
  if (t === activeTransport) return;
  if (t === 'usb' && !usbSupported) return;
  if (t === 'ble' && !bleSupported) return;
  const prev = activeConn();
  if (prev && prev.status === ConnectionStatus.CONNECTED) {
    try { await prev.disconnect(); } catch { /* ignore */ }
  }
  activeTransport = t;
  state.update((s) => ({ ...s, transport: t, status: 'disconnected', errorMessage: undefined }));
  appendLog({ direction: 'info', text: `Transport switched to ${t.toUpperCase()}` });
}

/**
 * Try to silently reconnect to a previously-authorized Calliope on app start
 * or after a browser reload. Only attempts a real connect when `navigator.usb.getDevices()`
 * already returns an authorized DAPLink device — so we never prompt the user
 * unless they explicitly click Connect.
 */
export async function tryAutoReconnect(): Promise<void> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
  try {
    const devices = (await (navigator as unknown as {
      usb: { getDevices(): Promise<{ vendorId: number; productId: number }[]> };
    }).usb.getDevices()) as { vendorId: number; productId: number }[];
    const authorized = devices.find(
      (d) => d.vendorId === 0x0d28 && d.productId === 0x0204,
    );
    if (!authorized) return;
    appendLog({ direction: 'info', text: 'Auto-reconnecting to authorized device' });
    const c = await getUsbConnection();
    await c.connect();
  } catch (err) {
    // Silent — the user never asked for anything here.
    appendLog({
      direction: 'info',
      text: `Auto-reconnect skipped: ${(err as Error)?.message ?? err}`,
    });
  }
}

// Kick off the silent reconnect attempt once in the browser, shortly after
// module init. This covers the "I reloaded the tab and lost my connection"
// case without requiring a user click.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    void tryAutoReconnect();
    void refreshPairedBleStatus();
  }, 250);
}

/**
 * MakeCode appends its own metadata records (compressed project source, header)
 * after the Intel-HEX EOF record so the `.hex` file can be re-imported as a
 * project. dapjs's parser rejects any records after EOF ("there is data after
 * an eof record"). Strip everything from the first EOF record onward, keeping
 * the EOF line itself.
 */
function stripMakeCodeMetadata(hex: string): string {
  const EOF = ':00000001FF';
  const idx = hex.indexOf(EOF);
  if (idx < 0) return hex;
  // Keep the EOF record itself, plus its trailing newline if any.
  let end = idx + EOF.length;
  if (hex[end] === '\r') end++;
  if (hex[end] === '\n') end++;
  return hex.slice(0, end);
}

/**
 * Hybrid mode needs UI cooperation: when MakeCode hands us a hex, BLE
 * (currently the active transport) can't flash, so we have to ask the user to
 * plug in USB. The store exposes `usbPlugRequest` for the UI to render a
 * modal; the modal calls `confirm()` once the user has plugged in, or
 * `cancel()` to abort the flash.
 */
export interface UsbPlugRequest {
  reason: 'hybrid-flash';
  fileName: string;
  confirm: () => void;
  cancel: () => void;
}
const usbPlugRequest = writable<UsbPlugRequest | null>(null);
export const calliopeUsbPlugRequest: Readable<UsbPlugRequest | null> = {
  subscribe: usbPlugRequest.subscribe,
};

function awaitUsbPlugConfirm(fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    usbPlugRequest.set({
      reason: 'hybrid-flash',
      fileName,
      confirm: () => {
        usbPlugRequest.set(null);
        resolve();
      },
      cancel: () => {
        usbPlugRequest.set(null);
        reject(new Error('user-cancelled'));
      },
    });
  });
}

/** Top-level flash dispatcher. Routes to USB or BLE based on transportMode. */
export async function flashCalliope(
  hex: string,
  name: string = 'project',
): Promise<void> {
  // Re-entrancy guard. The MakeCode iframe can deliver multiple onDownload
  // events for a single Compile (workspace sync side-effects), and a user
  // who clicks Download again because the progress bar hasn't moved yet
  // would otherwise queue a parallel flash that fights the first one for
  // the device.
  let busy = false;
  state.update((s) => { busy = s.status === 'flashing'; return s; });
  if (busy) {
    appendLog({
      direction: 'info',
      text: `Flash bereits aktiv — zusätzlicher Versuch ignoriert (${name}).`,
    });
    return;
  }

  const mode = readMode();
  if (mode === 'ble-full' && bleSupported) {
    return flashCalliopeViaBle(hex, name);
  }
  if (mode === 'ble-hybrid' && bleSupported) {
    return flashCalliopeHybrid(hex, name);
  }
  return flashCalliopeViaUsb(hex, name);
}

function readMode(): CalliopeTransportMode {
  let m: CalliopeTransportMode = 'usb';
  state.update((s) => {
    m = s.transportMode;
    return s;
  });
  return m;
}

async function flashCalliopeViaUsb(
  hex: string,
  name: string,
): Promise<void> {
  // BLE cannot reflash via this path; switch active transport to USB so the
  // flash uses DAPLink. After the flash we leave the user wherever they were
  // — the higher-level dispatcher decides whether to come back to BLE.
  if (activeTransport !== 'usb') {
    await setCalliopeTransport('usb');
  }
  if (!usbSupported) {
    state.update((s) => ({ ...s, status: 'error', errorMessage: 'WebUSB not supported — flashing requires USB' }));
    return;
  }
  let c: MicrobitWebUSBConnection;
  try {
    c = await getUsbConnection();
  } catch (err) {
    state.update((s) => ({ ...s, status: 'error', errorMessage: (err as Error).message }));
    return;
  }
  if (c.status !== ConnectionStatus.CONNECTED) {
    try {
      await connectWithRetry(c);
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (/no-device-selected|cancell/i.test(message)) {
        state.update((s) => ({ ...s, status: 'disconnected' }));
        return;
      }
      state.update((s) => ({ ...s, status: 'error', errorMessage: message }));
      return;
    }
  }

  state.update((s) => ({
    ...s,
    status: 'flashing',
    flashProgress: 0,
    flashPartial: undefined,
    errorMessage: undefined,
    lastFlashName: name,
  }));

  const cleanHex = stripMakeCodeMetadata(hex);
  appendLog({
    direction: 'info',
    text: `Flashing via USB "${name}" (${Math.round(cleanHex.length / 1024)} KB)`,
  });
  try {
    await c.flash(async () => cleanHex, {
      partial: true,
      progress: (pct: number | undefined, partial: boolean) => {
        const intPct = pct === undefined ? undefined : Math.round(pct * 100);
        state.update((s) => ({
          ...s,
          flashProgress: intPct,
          flashPartial: partial,
        }));
        if (intPct !== undefined) {
          appendLog({
            direction: 'info',
            text: `Flash: ${intPct}%`,
            kind: 'flash-progress',
          });
        }
      },
      minimumProgressIncrement: 0.05,
    });
    state.update((s) => ({
      ...s,
      status: 'connected',
      flashProgress: undefined,
      flashPartial: undefined,
      lastFlashAt: Date.now(),
    }));
    appendLog({ direction: 'info', text: `Flash finished: ${name}` });
    // The board resets after flash → DAPLink drops serial and the library
    // moves to DISCONNECTED. Reopen the connection so streaming keeps working
    // without the user clicking Connect again. Give the board a moment to
    // re-enumerate before the reconnect handshake, or it races the reset.
    await new Promise((r) => setTimeout(r, 600));
    try {
      await connectWithRetry(c, 3);
    } catch (err) {
      appendLog({
        direction: 'error',
        text: `Reconnect after flash failed: ${(err as Error).message}`,
      });
    }
  } catch (err) {
    state.update((s) => ({
      ...s,
      status: 'error',
      errorMessage: (err as Error).message,
      flashProgress: undefined,
    }));
    appendLog({ direction: 'error', text: `Flash failed: ${(err as Error).message}` });
  }
}

/**
 * BLE-hybrid: keep BLE for live data, but flash via USB. We disconnect BLE
 * during the flash (the board reboots and loses its GATT state anyway) and
 * reopen it once the flash settles.
 */
async function flashCalliopeHybrid(
  hex: string,
  name: string,
): Promise<void> {
  if (!usbSupported) {
    state.update((s) => ({ ...s, status: 'error', errorMessage: 'Hybrid mode needs WebUSB' }));
    return;
  }
  appendLog({ direction: 'info', text: `Hybrid flash: prompting for USB cable` });
  try {
    await awaitUsbPlugConfirm(name);
  } catch {
    appendLog({ direction: 'info', text: 'Hybrid flash cancelled by user' });
    return;
  }
  // Drop BLE so DAPLink (USB) can take over without contention.
  if (activeTransport === 'ble' && bleConn?.status === ConnectionStatus.CONNECTED) {
    try { await bleConn.disconnect(); } catch { /* ignore */ }
  }
  await flashCalliopeViaUsb(hex, name);
  // Return to BLE for live communication. Don't auto-pop a chooser — just
  // flag the desired transport so the next user-initiated Connect uses BLE.
  // (Requesting a chooser here without user gesture would be blocked.)
  if (bleSupported) {
    activeTransport = 'ble';
    state.update((s) => ({ ...s, transport: 'ble' }));
    appendLog({
      direction: 'info',
      text: 'Flash done — click Connect to resume BLE streaming.',
    });
  }
}

/**
 * BLE-full: flash via Web Bluetooth using the partial-flashing service. The
 * Calliope must already be paired/bonded at OS level — the browser cannot
 * trigger pairing. We use the device the user already picked for streaming;
 * if there isn't one the user has to click Connect first.
 *
 * The actual flash orchestration (GATT cache refresh, lib auto-reconnect
 * suppression, pairing-mode switch, retry on service-missing) lives in
 * mini-connection's `flashOverBluetooth`. This function is just the glue
 * between Teachable's state machine and that helper.
 */
async function flashCalliopeViaBle(
  hex: string,
  name: string,
): Promise<void> {
  if (!bleSupported) {
    state.update((s) => ({ ...s, status: 'error', errorMessage: 'Web Bluetooth not supported' }));
    return;
  }
  let device: BluetoothDevice | undefined;
  try {
    if (!bleConn) await getBleConnection();
    device = (bleConn as unknown as { device?: BluetoothDevice } | null)?.device;
  } catch (err) {
    state.update((s) => ({ ...s, status: 'error', errorMessage: (err as Error).message }));
    return;
  }
  if (!device || !device.gatt) {
    state.update((s) => ({
      ...s,
      status: 'error',
      errorMessage: 'No Calliope picked yet — click Connect over BLE first.',
    }));
    return;
  }

  state.update((s) => ({
    ...s,
    status: 'flashing',
    flashProgress: undefined,
    flashPhase: 'check',
    flashPartial: true,
    errorMessage: undefined,
    lastFlashName: name,
  }));
  const cleanHex = stripMakeCodeMetadata(hex);
  appendLog({
    direction: 'info',
    text: `Flashing via BLE "${name}" (${Math.round(cleanHex.length / 1024)} KB)`,
  });

  // Drop our UART subscriptions so notifications during flash don't get mixed
  // up. The lib's reconnect (now suppressed during flash) plus our own
  // reopener kick UART back in once the device boots back into app mode.
  bleRxChar = null;
  bleTxChar = null;

  // The lib's onProgress is cumulative across DFU bringup + actual transfer
  // (e.g. raw 0.05 by the time bytes start flowing). Rebase it so the user
  // sees a clean 0→100% during the transfer phase only. We capture `baseline`
  // as the raw progress value at the moment we promote to 'flashing'.
  let flashBaseline: number | null = null;
  try {
    await flashOverBluetooth({
      device,
      connection: bleConn ?? undefined,
      hex: cleanHex,
      onProgress: (p) => {
        let displayPct = 0;
        state.update((s: CalliopeState) => {
          const promote =
            s.flashPhase === 'prepare' || s.flashPhase === undefined;
          // Lock in the baseline the first time we enter the flashing phase
          // so subsequent ticks scale (p - baseline) / (1 - baseline) → 0..1.
          if (promote && flashBaseline === null) {
            flashBaseline = p;
          }
          if (s.flashPhase === 'check' || s.flashPhase === 'reboot') {
            // Pre-flash: don't update visible progress, but keep state in sync
            // for the eventual phase transition.
            return s;
          }
          const base = flashBaseline ?? p;
          const span = 1 - base;
          const rel = span > 0.001 ? Math.max(0, (p - base) / span) : 0;
          displayPct = Math.min(100, Math.max(0, Math.round(rel * 100)));
          return {
            ...s,
            flashProgress: displayPct,
            flashPhase: promote ? 'flashing' : s.flashPhase,
            flashPartial: true,
          };
        });
        appendLog({
          direction: 'info',
          text: `Flash: ${displayPct}%`,
          kind: 'flash-progress',
        });
      },
      onPhase: (phase: BluetoothFlashPhase) => {
        const labels: Record<BluetoothFlashPhase, string> = {
          refreshing: 'Refreshing BLE services…',
          running: 'Reading device state…',
          'pairing-mode-switch': 'Switching Calliope into flash mode…',
          reconnecting: 'Reconnecting after reset…',
          flashing: 'Flashing program…',
          finalising: 'Finalising flash…',
        };
        appendLog({ direction: 'info', text: labels[phase] });
        // Map library phase names to our UI phase enum and update state.
        // Pre-flash phases (running/refreshing/pairing-mode-switch/reconnecting)
        // show an indeterminate spinner; 'flashing' shows a progress bar; 'finalising' locks at 100%.
        // UI phases: check (initial connection check) → reboot (bring board
        // into DFU/pairing mode) → prepare (post-reconnect, lib is figuring
        // out what to transfer) → flashing (actual byte transfer with %) →
        // finalising. Both `refreshing` and `pairing-mode-switch` belong to
        // the DFU bringup step; only `reconnecting` is the brief "checking
        // what to transfer" pause before flashing kicks in.
        const phaseMap: Record<BluetoothFlashPhase, CalliopeFlashPhase> = {
          running: 'check',
          refreshing: 'reboot',
          'pairing-mode-switch': 'reboot',
          reconnecting: 'prepare',
          flashing: 'flashing',
          finalising: 'finalising',
        };
        const uiPhase = phaseMap[phase];
        const isPreFlash = uiPhase === 'check' || uiPhase === 'reboot' || uiPhase === 'prepare';
        state.update((s: CalliopeState) => ({
          ...s,
          flashPhase: uiPhase,
          // Clear progress during pre-flash phases so the UI shows a spinner.
          // Keep whatever progress value we have during flashing/finalising.
          flashProgress: isPreFlash ? undefined : (uiPhase === 'finalising' ? 100 : s.flashProgress),
        }));
      },
    });
    state.update((s) => ({
      ...s,
      status: 'connected',
      flashProgress: undefined,
      flashPhase: undefined,
      flashPartial: undefined,
      lastFlashAt: Date.now(),
    }));
    appendLog({ direction: 'info', text: `Flash finished: ${name}` });
    // Give the board ~1.6 s to reboot, then reopen UART.
    await new Promise((r) => setTimeout(r, 1600));
    try {
      if (device.gatt && !device.gatt.connected) {
        await device.gatt.connect();
      }
      await setupBleUart();
    } catch (err) {
      appendLog({
        direction: 'error',
        text: `BLE reconnect after flash failed: ${(err as Error).message}`,
      });
    }
  } catch (err) {
    handleBleFlashError(err);
  }
}

function handleBleFlashError(err: unknown): void {
  const e = err as Error;
  let userMsg: string;
  if (err instanceof BluetoothPartialFlashDalMismatchError) {
    userMsg =
      'Runtime auf dem Calliope passt nicht zum Programm — bitte einmal per USB voll flashen.';
  } else if (err instanceof BluetoothPartialFlashServiceMissingError) {
    userMsg =
      'Calliope läuft gerade ohne Partial-Flashing-Service — einmal per USB ein MakeCode-Programm aufspielen.';
  } else if (e?.name === 'SecurityError') {
    userMsg =
      'Bluetooth-Pairing fehlt: Calliope einmal in den OS-Bluetooth-Einstellungen koppeln, oder im Hybrid-Modus arbeiten.';
  } else {
    userMsg = e?.message ?? String(err);
  }
  state.update((s: CalliopeState) => ({
    ...s,
    status: 'error',
    errorMessage: userMsg,
    flashProgress: undefined,
    flashPhase: undefined,
  }));
  appendLog({ direction: 'error', text: `BLE flash failed: ${userMsg}` });
}

/** Send a newline-terminated line to the board over the active transport. */
export async function sendSerialLine(line: string): Promise<void> {
  const out = line.endsWith('\n') ? line : line + '\n';
  try {
    if (activeTransport === 'usb') {
      if (!usbConn || usbConn.status !== ConnectionStatus.CONNECTED) return;
      await usbConn.serialWrite(out);
    } else {
      if (!bleConn || bleConn.status !== ConnectionStatus.CONNECTED) return;
      await bleSerialWrite(out);
    }
    if (line.trim() !== 'H') {
      appendLog({ direction: 'tx', text: line.replace(/\n$/, '') });
    }
  } catch {
    /* ignore — caller may be in a tight loop */
  }
}

/**
 * Subscribe to line-delimited data from the board. Routes USB serialdata
 * through the lib and BLE UART through our own characteristic notification
 * handler — both feed callbacks the same way.
 */
export function onSerialLine(cb: (line: string) => void): () => void {
  let usbBuf = '';
  const usbHandler = (ev: { data: string }) => {
    usbBuf += ev.data;
    let idx: number;
    while ((idx = usbBuf.indexOf('\n')) >= 0) {
      const line = usbBuf.slice(0, idx).replace(/\r$/, '');
      usbBuf = usbBuf.slice(idx + 1);
      if (line) cb(line);
    }
  };
  bleLineSubs.add(cb);
  let disposed = false;
  // Only attach to USB once the connection exists. BLE subscribers go into
  // the bleLineSubs set immediately and are dispatched from setupBleUart().
  const tryAttach = () => {
    if (disposed) return;
    if (usbConn) {
      usbConn.addEventListener('serialdata', usbHandler as unknown as EventListener);
      return;
    }
    setTimeout(tryAttach, 250);
  };
  tryAttach();
  return () => {
    disposed = true;
    bleLineSubs.delete(cb);
    if (usbConn) usbConn.removeEventListener('serialdata', usbHandler as unknown as EventListener);
  };
}
