import { writable, type Readable } from 'svelte/store';
import {
  createWebUSBConnection,
  createWebBluetoothConnection,
  ConnectionStatus,
  type MicrobitWebUSBConnection,
  type MicrobitWebBluetoothConnection,
  type BoardVersion,
} from '@microbit/microbit-connection';

/**
 * Active transport. USB is the canonical path — it's the only one that can
 * flash the board and it doesn't require the on-board Bluetooth service to be
 * running. BLE is for wireless streaming of classifications after flashing.
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

const initial: CalliopeState = {
  status: usbSupported || bleSupported ? 'disconnected' : 'unknown',
  transport: usbSupported ? 'usb' : 'ble',
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

let usbConn: MicrobitWebUSBConnection | null = null;
let bleConn: MicrobitWebBluetoothConnection | null = null;
let usbInitPromise: Promise<MicrobitWebUSBConnection> | null = null;
let bleInitPromise: Promise<MicrobitWebBluetoothConnection> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let rxBuffer = '';
let bleRxBuffer = '';
let activeTransport: CalliopeTransport = initial.transport;
const HEARTBEAT_MS = 1000;

function activeConn():
  | MicrobitWebUSBConnection
  | MicrobitWebBluetoothConnection
  | null {
  return activeTransport === 'usb' ? usbConn : bleConn;
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const c = activeConn();
    if (!c || c.status !== ConnectionStatus.CONNECTED) return;
    void c.serialWrite('H\n').catch(() => {});
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
 * Create (or return the cached) BLE connection. Separate from USB because BLE
 * uses a completely different service (Bluetooth UART) and cannot flash — it
 * is a wireless streaming path only.
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
      } else {
        stopHeartbeat();
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
    c.addEventListener('uartdata', ((ev: unknown) => {
      // BLE UART delivers bytes — decode as UTF-8 and line-buffer like USB.
      const value = (ev as { value?: Uint8Array })?.value;
      if (!value) return;
      bleRxBuffer += new TextDecoder().decode(value);
      let idx: number;
      while ((idx = bleRxBuffer.indexOf('\n')) >= 0) {
        const line = bleRxBuffer.slice(0, idx).replace(/\r$/, '');
        bleRxBuffer = bleRxBuffer.slice(idx + 1);
        if (line) appendLog({ direction: 'rx', text: line });
      }
    }) as EventListener);
    bleConn = c;
    return c;
  })();
  return bleInitPromise;
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

export async function connectCalliope(): Promise<void> {
  try {
    if (activeTransport === 'ble') {
      const c = await getBleConnection();
      await c.connect();
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
  try {
    await c.disconnect();
  } catch {
    /* ignore */
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

export async function flashCalliope(
  hex: string,
  name: string = 'project',
): Promise<void> {
  // Flashing always goes through WebUSB (DAPLink). BLE cannot reflash the
  // board, so switch back to USB and keep it as the active transport once
  // flashing completes — that's typically what the user wants anyway.
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
    text: `Flashing "${name}" (${Math.round(cleanHex.length / 1024)} KB)`,
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

/** Send a newline-terminated line to the board over the active transport. */
export async function sendSerialLine(line: string): Promise<void> {
  const c = activeConn();
  if (!c || c.status !== ConnectionStatus.CONNECTED) return;
  try {
    await c.serialWrite(line.endsWith('\n') ? line : line + '\n');
    if (line.trim() !== 'H') {
      appendLog({ direction: 'tx', text: line.replace(/\n$/, '') });
    }
  } catch {
    /* ignore — caller may be in a tight loop */
  }
}

/**
 * Subscribe to line-delimited data from the active transport. Wires up to both
 * USB (`serialdata`, string) and BLE (`uartdata`, Uint8Array) so the subscriber
 * keeps working after a `setCalliopeTransport` switch.
 */
export function onSerialLine(cb: (line: string) => void): () => void {
  let usbBuf = '';
  let bleBuf = '';
  const usbHandler = (ev: { data: string }) => {
    usbBuf += ev.data;
    let idx: number;
    while ((idx = usbBuf.indexOf('\n')) >= 0) {
      const line = usbBuf.slice(0, idx).replace(/\r$/, '');
      usbBuf = usbBuf.slice(idx + 1);
      if (line) cb(line);
    }
  };
  const bleHandler = (ev: { value?: Uint8Array }) => {
    if (!ev.value) return;
    bleBuf += new TextDecoder().decode(ev.value);
    let idx: number;
    while ((idx = bleBuf.indexOf('\n')) >= 0) {
      const line = bleBuf.slice(0, idx).replace(/\r$/, '');
      bleBuf = bleBuf.slice(idx + 1);
      if (line) cb(line);
    }
  };
  let disposed = false;
  if (usbSupported) {
    void getUsbConnection().then((c) => {
      if (disposed) return;
      c.addEventListener('serialdata', usbHandler as unknown as EventListener);
    }).catch(() => { /* ignore */ });
  }
  if (bleSupported) {
    void getBleConnection().then((c) => {
      if (disposed) return;
      c.addEventListener('uartdata', bleHandler as unknown as EventListener);
    }).catch(() => { /* ignore */ });
  }
  return () => {
    disposed = true;
    if (usbConn) usbConn.removeEventListener('serialdata', usbHandler as unknown as EventListener);
    if (bleConn) bleConn.removeEventListener('uartdata', bleHandler as unknown as EventListener);
  };
}
