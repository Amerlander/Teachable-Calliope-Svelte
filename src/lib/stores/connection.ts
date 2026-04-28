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

export interface CalliopeState {
  status: CalliopeStatus;
  boardVersion?: BoardVersion;
  /** Calliope-family version — V1/V2 (DAL) or V3 (CODAL). */
  calliopeVersion?: CalliopeVersion;
  /** 0–100 when flashing is active. Undefined when not flashing or indeterminate. */
  flashProgress?: number;
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
};

const state = writable<CalliopeState>(initial);
export const calliopeState: Readable<CalliopeState> = { subscribe: state.subscribe };

// Ring buffer of TX/RX messages for the "communication log" panel.
export interface CalliopeLogEntry {
  time: number;
  direction: 'tx' | 'rx' | 'info' | 'error';
  text: string;
}
const LOG_MAX = 200;
const logStore = writable<CalliopeLogEntry[]>([]);
export const calliopeLog: Readable<CalliopeLogEntry[]> = { subscribe: logStore.subscribe };
function appendLog(entry: Omit<CalliopeLogEntry, 'time'>) {
  logStore.update((arr) => {
    const next = arr.length >= LOG_MAX ? arr.slice(arr.length - LOG_MAX + 1) : arr.slice();
    next.push({ time: Date.now(), ...entry });
    return next;
  });
}
export function clearCalliopeLog() {
  logStore.set([]);
}

// Nordic UART Service UUIDs — exposed by MakeCode programs that include the
// `bluetooth` package and call `bluetooth.startUartService()`.
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // browser → board
const NUS_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // board → browser (notify)

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
      } else {
        stopHeartbeat();
        if (mapped === 'disconnected') appendLog({ direction: 'info', text: 'Disconnected' });
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
        if (mapped === 'disconnected') appendLog({ direction: 'info', text: 'Disconnected (BLE)' });
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
  appendLog({
    direction: 'info',
    text: `${picked.fromCache ? 'Resuming' : 'Selected'}: ${meta.name ?? meta.id ?? 'BLE device'}`,
  });
  await c.connect();
  await setupBleUart();
}

export async function connectCalliope(forceChooser = false): Promise<void> {
  try {
    if (activeTransport === 'ble') {
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

/**
 * Forget every Calliope this origin has ever been granted Web Bluetooth access
 * to. Calls `BluetoothDevice.forget()` (Chrome 87+) which revokes the origin's
 * permission, so a subsequent `requestDevice` shows the regular chooser
 * instead of silently picking a stale entry. Useful when a Calliope keeps
 * timing out on connect because Chrome's bond got desynced from the device.
 */
export async function forgetCalliopeBleDevices(): Promise<number> {
  const bt = (navigator as unknown as {
    bluetooth: {
      getDevices?: () => Promise<BluetoothDevice[]>;
    };
  }).bluetooth;
  if (!bt?.getDevices) return 0;
  let count = 0;
  try {
    const known = await bt.getDevices();
    for (const d of known) {
      const dev = d as unknown as { forget?: () => Promise<void>; name?: string; id?: string };
      if (typeof dev.forget !== 'function') continue;
      try {
        await dev.forget();
        appendLog({
          direction: 'info',
          text: `Forgot device: ${dev.name ?? dev.id ?? 'BLE device'}`,
        });
        count++;
      } catch (err) {
        appendLog({
          direction: 'error',
          text: `Could not forget device: ${(err as Error).message}`,
        });
      }
    }
  } catch (err) {
    appendLog({ direction: 'error', text: `getDevices failed: ${(err as Error).message}` });
  }
  // Drop our own cached lib state so the next connect re-runs through the
  // chooser cleanly.
  bleConn = null;
  bleInitPromise = null;
  bleRxChar = null;
  bleTxChar = null;
  return count;
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
        state.update((s) => ({
          ...s,
          flashProgress: pct === undefined ? undefined : Math.round(pct * 100),
          flashPartial: partial,
        }));
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
    flashProgress: 1, // visible immediately so the bar is "alive"
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

  try {
    await flashOverBluetooth({
      device,
      connection: bleConn ?? undefined,
      hex: cleanHex,
      onProgress: (p) => {
        state.update((s: CalliopeState) => ({
          ...s,
          flashProgress: Math.max(1, Math.round(p * 100)),
          flashPartial: true,
        }));
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
      },
    });
    state.update((s) => ({
      ...s,
      status: 'connected',
      flashProgress: undefined,
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
