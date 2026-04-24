import { writable, type Readable } from 'svelte/store';
import {
  createWebUSBConnection,
  ConnectionStatus,
  type MicrobitWebUSBConnection,
  type BoardVersion,
} from '@microbit/microbit-connection';

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

const initial: CalliopeState =
  typeof navigator !== 'undefined' && 'usb' in navigator
    ? { status: 'disconnected' }
    : { status: 'unknown' };

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

let conn: MicrobitWebUSBConnection | null = null;
let initPromise: Promise<MicrobitWebUSBConnection> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let rxBuffer = '';
const HEARTBEAT_MS = 1000;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!conn || conn.status !== ConnectionStatus.CONNECTED) return;
    void conn.serialWrite('H\n').catch(() => {});
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

async function getConnection(): Promise<MicrobitWebUSBConnection> {
  if (conn) return conn;
  if (initPromise) return initPromise;
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    state.update((s) => ({ ...s, status: 'unsupported' }));
    throw new Error('WebUSB not supported in this browser');
  }
  initPromise = (async () => {
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
      state.update((s) => {
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
      if (mapped === 'connected') {
        startHeartbeat();
        appendLog({ direction: 'info', text: 'Connected' });
      } else {
        stopHeartbeat();
        if (mapped === 'disconnected') appendLog({ direction: 'info', text: 'Disconnected' });
      }
    });
    c.addEventListener('backgrounderror', (ev) => {
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
    conn = c;
    return c;
  })();
  return initPromise;
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
    const c = await getConnection();
    await connectWithRetry(c);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // User-cancelled device chooser shouldn't surface as "error".
    if (/no-device-selected|cancell/i.test(message)) {
      state.update((s) => ({ ...s, status: 'disconnected', errorMessage: undefined }));
      return;
    }
    state.update((s) => ({ ...s, status: 'error', errorMessage: message }));
  }
}

export async function disconnectCalliope(): Promise<void> {
  if (!conn) return;
  try {
    await conn.disconnect();
  } catch {
    /* ignore */
  }
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
    const c = await getConnection();
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
  let c: MicrobitWebUSBConnection;
  try {
    c = await getConnection();
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

/** Send a newline-terminated line to the board over serial. No-op when disconnected. */
export async function sendSerialLine(line: string): Promise<void> {
  if (!conn || conn.status !== ConnectionStatus.CONNECTED) return;
  try {
    await conn.serialWrite(line.endsWith('\n') ? line : line + '\n');
    // Skip heartbeats from the user-facing log to avoid drowning it out.
    if (line.trim() !== 'H') {
      appendLog({ direction: 'tx', text: line.replace(/\n$/, '') });
    }
  } catch {
    /* ignore — caller may be in a tight loop */
  }
}

/** Subscribe to incoming serial data from the board. Returns an unsubscribe fn. */
export function onSerialLine(cb: (line: string) => void): () => void {
  let buffer = '';
  const handler = (ev: { data: string }) => {
    buffer += ev.data;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line) cb(line);
    }
  };
  let disposed = false;
  void getConnection().then((c) => {
    if (disposed) return;
    c.addEventListener('serialdata', handler as unknown as EventListener);
  });
  return () => {
    disposed = true;
    if (conn) conn.removeEventListener('serialdata', handler as unknown as EventListener);
  };
}
