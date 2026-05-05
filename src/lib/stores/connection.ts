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
 * Physical channel carrying serial / flashing. USB and BLE are tracked
 * independently in `CalliopeState` — both can be open simultaneously.
 */
export type CalliopeTransport = 'usb' | 'ble';

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
  // ---- Per-transport state. USB and BLE are tracked independently so the
  // UI can show capabilities for each channel side-by-side. ----
  usbStatus: CalliopeStatus;
  usbDeviceName?: string;
  usbErrorMessage?: string;

  bleStatus: CalliopeStatus;
  bleDeviceName?: string;
  bleErrorMessage?: string;
  /** True when the browser remembers a previously-permitted BLE device for
   *  this origin. Lets the next Connect resume silently. */
  bleHasPaired: boolean;
  /** Partial-flashing service exposed by the running hex (BLE flash possible). */
  bleCanFlash: boolean;
  /** UART service exposed (BLE serial communication possible). When
   *  `bleStatus === 'connected'` but this is false, the most likely cause is a
   *  missing OS-level pairing — we surface a "Wie pairen?" hint. */
  bleCanCommunicate: boolean;

  /** Whether the browser supports each transport. */
  usbSupported: boolean;
  bleSupported: boolean;

  // ---- Flash state (single op at a time across both transports). ----
  flashTransport?: CalliopeTransport;
  flashProgress?: number;
  flashPhase?: CalliopeFlashPhase;
  flashPartial?: boolean;
  lastFlashName?: string;
  lastFlashAt?: number;

  boardVersion?: BoardVersion;
  calliopeVersion?: CalliopeVersion;
  connectedAt?: number;

  /**
   * Roll-up status — `flashing` if a flash is in flight, else `connected`
   * if either transport is connected, else `connecting` / `error` /
   * `disconnected` based on whichever is most active. Useful for badges and
   * gating that doesn't care which channel.
   */
  status: CalliopeStatus;
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

/** Roll-up `status` from per-transport status fields. */
function recomputeOverall(s: CalliopeState): CalliopeState {
  let status: CalliopeStatus;
  if (s.flashTransport) status = 'flashing';
  else if (s.usbStatus === 'connected' || s.bleStatus === 'connected') status = 'connected';
  else if (s.usbStatus === 'connecting' || s.bleStatus === 'connecting') status = 'connecting';
  else if (s.usbStatus === 'error' || s.bleStatus === 'error') status = 'error';
  else if (!s.usbSupported && !s.bleSupported) status = 'unsupported';
  else status = 'disconnected';
  return { ...s, status };
}

const initial: CalliopeState = recomputeOverall({
  usbStatus: usbSupported ? 'disconnected' : 'unsupported',
  bleStatus: bleSupported ? 'disconnected' : 'unsupported',
  bleHasPaired: false,
  bleCanFlash: false,
  bleCanCommunicate: false,
  usbSupported,
  bleSupported,
  status: 'disconnected',
});

const state = writable<CalliopeState>(initial);
export const calliopeState: Readable<CalliopeState> = { subscribe: state.subscribe };

/** Wrapper around `state.update` that always re-derives overall fields. */
function updateState(fn: (s: CalliopeState) => CalliopeState): void {
  state.update((s) => recomputeOverall(fn(s)));
}

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
const HEARTBEAT_MS = 1000;

const bleLineSubs = new Set<(line: string) => void>();

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
    // Send over whichever transport is currently connected (USB preferred).
    if (usbConn?.status === ConnectionStatus.CONNECTED) {
      void usbConn.serialWrite('H\n').catch(() => {});
    } else if (bleConn?.status === ConnectionStatus.CONNECTED) {
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
      updateState((s) => {
        // Don't let an in-flight USB flash get clobbered by transient
        // disconnect events from the device's reset cycle.
        if (s.flashTransport === 'usb' && mapped !== 'connected') return s;
        return {
          ...s,
          usbStatus: mapped,
          usbDeviceName: mapped === 'connected'
            ? (pn ?? s.usbDeviceName ?? 'Calliope mini (USB)')
            : s.usbDeviceName,
          usbErrorMessage: mapped === 'connected' ? undefined : s.usbErrorMessage,
          boardVersion: bv,
          calliopeVersion: cv ?? s.calliopeVersion,
          connectedAt: mapped === 'connected' ? Date.now() : s.connectedAt,
        };
      });
      if (mapped === 'connected') {
        startHeartbeat();
        appendLog({ direction: 'info', text: 'Connected (USB)' });
      } else {
        // Only stop heartbeat if no other transport is connected.
        let bleConnected = false;
        state.update((s) => { bleConnected = s.bleStatus === 'connected'; return s; });
        if (!bleConnected) stopHeartbeat();
        if (mapped === 'disconnected') {
          appendLog({ direction: 'info', text: 'Disconnected (USB)' });
        }
      }
    });
    c.addEventListener('backgrounderror', (ev) => {
      updateState((s) => ({
        ...s,
        usbStatus: 'error',
        usbErrorMessage: ev.errorMessage,
        flashProgress: s.flashTransport === 'usb' ? undefined : s.flashProgress,
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
      updateState((s) => ({
        ...s,
        usbStatus: mapStatus(c.status),
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
      const mapped = mapStatus(ev.status);
      updateState((s) => {
        if (s.flashTransport === 'ble' && mapped !== 'connected') return s;
        return {
          ...s,
          bleStatus: mapped,
          bleErrorMessage: mapped === 'connected' ? undefined : s.bleErrorMessage,
          bleCanCommunicate: mapped === 'connected' ? s.bleCanCommunicate : false,
          bleCanFlash: mapped === 'connected' ? s.bleCanFlash : false,
          connectedAt: mapped === 'connected' ? Date.now() : s.connectedAt,
        };
      });
      if (mapped === 'connected') {
        startHeartbeat();
        appendLog({ direction: 'info', text: 'Connected (BLE)' });
        let isFlashing = false;
        state.update((s) => { isFlashing = s.flashTransport === 'ble'; return s; });
        if (!isFlashing) void setupBleUart();
      } else {
        let usbConnected = false;
        state.update((s) => { usbConnected = s.usbStatus === 'connected'; return s; });
        if (!usbConnected) stopHeartbeat();
        bleRxChar = null;
        bleTxChar = null;
        bleRxBuffer = '';
        if (mapped === 'disconnected') {
          appendLog({ direction: 'info', text: 'Disconnected (BLE)' });
        }
      }
    });
    c.addEventListener('backgrounderror', (ev) => {
      updateState((s) => ({
        ...s,
        bleStatus: 'error',
        bleErrorMessage: ev.errorMessage,
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
    // unbonded peers". Surface this to the UI via bleCanCommunicate=false;
    // the popover renders a "Wie pairen?" hint based on that.
    updateState((s) => ({ ...s, bleCanCommunicate: false, bleCanFlash: false }));
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
    // Probe the partial-flashing service — if present, we can flash via BLE.
    let canFlash = false;
    try {
      await gatt.getPrimaryService('e97dd91d-251d-470a-a062-fa1922dfa9a8');
      canFlash = true;
    } catch { /* not present */ }
    updateState((s) => ({ ...s, bleCanCommunicate: true, bleCanFlash: canFlash }));
  } catch (e) {
    bleRxChar = null;
    bleTxChar = null;
    appendLog({ direction: 'error', text: `BLE UART setup failed: ${(e as Error).message}` });
    updateState((s) => ({ ...s, bleCanCommunicate: false }));
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
    const t = new Promise<void>((res) => setTimeout(res, 2000));
    try { await Promise.race([bleConn.disconnect(), t]); } catch { /* ignore */ }
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
  updateState((s) => ({ ...s, bleDeviceName: label, bleHasPaired: true }));
  await c.connect();
  await setupBleUart();
  updateState((s) => ({ ...s, connectedAt: Date.now() }));
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
    updateState((s) => ({
      ...s,
      bleHasPaired: known.length > 0,
      bleDeviceName: s.bleDeviceName ?? first?.name ?? first?.id,
    }));
  } catch {
    /* permissions backend unavailable — leave state alone */
  }
}

/**
 * Forget all browser-remembered BLE devices for this origin and clear our
 * cached connection wrappers. Used by `disconnectAndForget('ble')` — keeping
 * it as a private helper here.
 */
async function forgetAllBleDevices(): Promise<void> {
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
  bleConn = null;
  bleInitPromise = null;
  bleRxChar = null;
  bleTxChar = null;
}

/**
 * Connect to a Calliope on the chosen transport. Always tries the silent
 * resume path first (USB: getDevices, BLE: getDevices). If a chooser would
 * be needed, we first wipe all per-transport device info so the popover
 * doesn't lie about a stale "paired" state while the picker is open.
 */
export async function connectCalliope(
  transport: CalliopeTransport = 'usb',
  forceChooser = false,
): Promise<void> {
  try {
    if (transport === 'ble') {
      if (!bleSupported) return;
      updateState((s) => ({
        ...s,
        bleStatus: 'connecting',
        bleErrorMessage: undefined,
      }));

      let needPicker = forceChooser;
      if (!needPicker) {
        // Probe getDevices() first; only fall through to the picker if there's
        // no remembered device.
        const bt = (navigator as unknown as {
          bluetooth: { getDevices?: () => Promise<BluetoothDevice[]> };
        }).bluetooth;
        try {
          const known = await bt.getDevices?.();
          if (!known || known.length === 0) needPicker = true;
        } catch {
          needPicker = true;
        }
      }

      if (needPicker) {
        // Wipe stale connection info before showing the picker so the user
        // sees a clean slate.
        await forgetAllBleDevices();
        updateState((s) => ({
          ...s,
          bleStatus: 'connecting',
          bleDeviceName: undefined,
          bleHasPaired: false,
          bleCanFlash: false,
          bleCanCommunicate: false,
          bleErrorMessage: undefined,
        }));
      }

      await resetBleConnectionState();
      const c = await getBleConnection();
      const picked = await pickBleDevice(needPicker);
      if (!picked) {
        updateState((s) => ({ ...s, bleStatus: 'disconnected', bleErrorMessage: undefined }));
        return;
      }
      try {
        await attachBleDeviceAndConnect(c, picked);
      } catch (err) {
        if (picked.fromCache) {
          appendLog({ direction: 'info', text: `Cached device didn't respond — opening chooser…` });
          const forgetable = picked.device as unknown as { forget?: () => Promise<void> };
          if (typeof forgetable.forget === 'function') {
            try { await forgetable.forget(); } catch { /* ignore */ }
          }
          await forgetAllBleDevices();
          updateState((s) => ({
            ...s,
            bleStatus: 'connecting',
            bleDeviceName: undefined,
            bleHasPaired: false,
            bleCanFlash: false,
            bleCanCommunicate: false,
          }));
          const re = await pickBleDevice(true);
          if (!re) {
            updateState((s) => ({ ...s, bleStatus: 'disconnected', bleErrorMessage: undefined }));
            return;
          }
          await attachBleDeviceAndConnect(await getBleConnection(), re);
        } else {
          throw err;
        }
      }
    } else {
      if (!usbSupported) return;
      updateState((s) => ({ ...s, usbStatus: 'connecting', usbErrorMessage: undefined }));
      const c = await getUsbConnection();
      await connectWithRetry(c);
    }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (/no-device-selected|cancell/i.test(message)) {
      updateState((s) => transport === 'ble'
        ? { ...s, bleStatus: 'disconnected', bleErrorMessage: undefined }
        : { ...s, usbStatus: 'disconnected', usbErrorMessage: undefined });
      return;
    }
    updateState((s) => transport === 'ble'
      ? { ...s, bleStatus: 'error', bleErrorMessage: message }
      : { ...s, usbStatus: 'error', usbErrorMessage: message });
  }
}

/**
 * Disconnect the given transport AND forget any browser-remembered device on
 * it. The next connect on that transport will always show a fresh picker.
 * This is the merged "Trennen" + "Anderen Calliope verbinden" action.
 */
export async function disconnectAndForget(transport: CalliopeTransport): Promise<void> {
  if (transport === 'usb') {
    if (usbConn) {
      const t = new Promise<void>((res) => setTimeout(res, 2000));
      try { await Promise.race([usbConn.disconnect(), t]); } catch { /* ignore */ }
    }
    usbConn = null;
    usbInitPromise = null;
    updateState((s) => ({
      ...s,
      usbStatus: usbSupported ? 'disconnected' : 'unsupported',
      usbDeviceName: undefined,
      usbErrorMessage: undefined,
    }));
    return;
  }
  // BLE: disconnect, then forget all known devices and clear all device info.
  if (bleConn) {
    const t = new Promise<void>((res) => setTimeout(res, 2000));
    try { await Promise.race([bleConn.disconnect(), t]); } catch { /* ignore */ }
  }
  await forgetAllBleDevices();
  updateState((s) => ({
    ...s,
    bleStatus: bleSupported ? 'disconnected' : 'unsupported',
    bleDeviceName: undefined,
    bleErrorMessage: undefined,
    bleHasPaired: false,
    bleCanFlash: false,
    bleCanCommunicate: false,
  }));
  appendLog({ direction: 'info', text: 'BLE device disconnected and forgotten.' });
}


/**
 * Visible signal that the UI should pop up the OS-pairing explainer. Shown
 * on demand when the user clicks the "Wie pairen?" link in the BLE row.
 */
const blePairingInfoVisible = writable(false);
export const calliopeBlePairingInfo: Readable<boolean> = {
  subscribe: blePairingInfoVisible.subscribe,
};
export function dismissBlePairingInfo(): void {
  blePairingInfoVisible.set(false);
}
export function showBlePairingInfo(): void {
  blePairingInfoVisible.set(true);
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

/**
 * Top-level flash dispatcher. Auto-routes:
 *  1. USB connected → flash via USB (most reliable, full-flash capable).
 *  2. BLE connected with partial-flashing service → flash via BLE.
 *  3. Otherwise → ask the user to plug in USB (hybrid prompt).
 */
export async function flashCalliope(
  hex: string,
  name: string = 'project',
): Promise<void> {
  let busy = false;
  let snap: CalliopeState | null = null;
  state.update((s) => { busy = s.status === 'flashing'; snap = s; return s; });
  if (busy) {
    appendLog({
      direction: 'info',
      text: `Flash bereits aktiv — zusätzlicher Versuch ignoriert (${name}).`,
    });
    return;
  }
  const s = snap as CalliopeState | null;
  // Prefer BLE when it's OS-paired and exposes the partial-flashing service.
  // USB flash wipes the Calliope's bonding whitelist, so we'd otherwise
  // silently lose the OS pairing on every flash. BLE flash keeps it intact.
  if (s && s.bleStatus === 'connected' && s.bleCanFlash) return flashCalliopeViaBle(hex, name);
  if (s && s.usbStatus === 'connected') {
    // BLE is connected but unusable for flash → warn that the user will
    // need to re-pair / reconnect after the USB flash.
    if (s.bleStatus === 'connected') {
      appendLog({
        direction: 'info',
        text: 'USB-Flash überschreibt das BLE-Pairing. Nach dem Flashen bitte erneut über BLE verbinden.',
      });
    }
    return flashCalliopeViaUsb(hex, name);
  }
  if (s && s.bleStatus === 'connected' && !s.bleCanFlash) {
    // BLE is connected but not flash-capable, and no USB. Surface the
    // explainer so the user can either pair at OS level or plug in USB.
    blePairingInfoVisible.set(true);
    updateState((st) => ({
      ...st,
      bleErrorMessage:
        'Zum Flashen über Bluetooth muss der Calliope einmal im Betriebssystem gekoppelt werden — oder schließe ihn per USB an.',
    }));
    return;
  }
  if (usbSupported) return flashCalliopeHybrid(hex, name);
  return flashCalliopeViaUsb(hex, name);
}

async function flashCalliopeViaUsb(
  hex: string,
  name: string,
): Promise<void> {
  if (!usbSupported) {
    updateState((s) => ({ ...s, usbStatus: 'error', usbErrorMessage: 'WebUSB not supported — flashing requires USB' }));
    return;
  }
  let c: MicrobitWebUSBConnection;
  try {
    c = await getUsbConnection();
  } catch (err) {
    updateState((s) => ({ ...s, usbStatus: 'error', usbErrorMessage: (err as Error).message }));
    return;
  }
  if (c.status !== ConnectionStatus.CONNECTED) {
    try {
      await connectWithRetry(c);
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (/no-device-selected|cancell/i.test(message)) {
        updateState((s) => ({ ...s, usbStatus: 'disconnected' }));
        return;
      }
      updateState((s) => ({ ...s, usbStatus: 'error', usbErrorMessage: message }));
      return;
    }
  }

  updateState((s) => ({
    ...s,
    flashTransport: 'usb',
    flashProgress: 0,
    flashPartial: undefined,
    usbErrorMessage: undefined,
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
        updateState((s) => ({
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
    updateState((s) => ({
      ...s,
      flashTransport: undefined,
      flashProgress: undefined,
      flashPartial: undefined,
      lastFlashAt: Date.now(),
    }));
    appendLog({ direction: 'info', text: `Flash finished: ${name}` });
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
    updateState((s) => ({
      ...s,
      flashTransport: undefined,
      usbStatus: 'error',
      usbErrorMessage: (err as Error).message,
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
    updateState((s) => ({ ...s, usbStatus: 'error', usbErrorMessage: 'Hybrid mode needs WebUSB' }));
    return;
  }
  appendLog({ direction: 'info', text: `Hybrid flash: prompting for USB cable` });
  try {
    await awaitUsbPlugConfirm(name);
  } catch {
    appendLog({ direction: 'info', text: 'Hybrid flash cancelled by user' });
    return;
  }
  await flashCalliopeViaUsb(hex, name);
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
    updateState((s) => ({ ...s, bleStatus: 'error', bleErrorMessage: (err as Error).message }));
    return;
  }
  if (!device || !device.gatt) {
    updateState((s) => ({
      ...s,
      bleStatus: 'error',
      bleErrorMessage: 'No Calliope picked yet — click Connect over BLE first.',
    }));
    return;
  }

  updateState((s) => ({
    ...s,
    flashTransport: 'ble',
    flashProgress: undefined,
    flashPhase: 'check',
    flashPartial: true,
    bleErrorMessage: undefined,
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
        updateState((s: CalliopeState) => {
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
        updateState((s: CalliopeState) => ({
          ...s,
          flashPhase: uiPhase,
          flashProgress: isPreFlash ? undefined : (uiPhase === 'finalising' ? 100 : s.flashProgress),
        }));
      },
    });
    updateState((s) => ({
      ...s,
      flashTransport: undefined,
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
  updateState((s: CalliopeState) => ({
    ...s,
    flashTransport: undefined,
    bleStatus: 'error',
    bleErrorMessage: userMsg,
    flashProgress: undefined,
    flashPhase: undefined,
  }));
  appendLog({ direction: 'error', text: `BLE flash failed: ${userMsg}` });
}

/**
 * Send a newline-terminated line to the board. Picks whichever transport is
 * currently connected — USB is preferred when both are available.
 */
export async function sendSerialLine(line: string): Promise<void> {
  const out = line.endsWith('\n') ? line : line + '\n';
  try {
    if (usbConn?.status === ConnectionStatus.CONNECTED) {
      await usbConn.serialWrite(out);
    } else if (bleConn?.status === ConnectionStatus.CONNECTED) {
      await bleSerialWrite(out);
    } else {
      return;
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
