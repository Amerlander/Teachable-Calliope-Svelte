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

export interface CalliopeState {
  status: CalliopeStatus;
  boardVersion?: BoardVersion;
  /** 0–100 when flashing is active. Undefined when not flashing or indeterminate. */
  flashProgress?: number;
  flashPartial?: boolean;
  errorMessage?: string;
  lastFlashName?: string;
  lastFlashAt?: number;
}

const initial: CalliopeState =
  typeof navigator !== 'undefined' && 'usb' in navigator
    ? { status: 'disconnected' }
    : { status: 'unknown' };

const state = writable<CalliopeState>(initial);
export const calliopeState: Readable<CalliopeState> = { subscribe: state.subscribe };

let conn: MicrobitWebUSBConnection | null = null;
let initPromise: Promise<MicrobitWebUSBConnection> | null = null;

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
    const c = createWebUSBConnection();
    await c.initialize();
    c.addEventListener('status', (ev) => {
      const mapped = mapStatus(ev.status);
      state.update((s) => {
        // Don't clobber the 'flashing' status when the underlying connection
        // just says CONNECTED during flash progress events.
        if (s.status === 'flashing' && mapped === 'connected') return s;
        return {
          ...s,
          status: mapped,
          boardVersion: c.getBoardVersion(),
          errorMessage:
            mapped === 'error' || mapped === 'connected' ? undefined : s.errorMessage,
        };
      });
    });
    c.addEventListener('backgrounderror', (ev) => {
      state.update((s) => ({
        ...s,
        status: 'error',
        errorMessage: ev.errorMessage,
        flashProgress: undefined,
      }));
    });
    state.update((s) => ({
      ...s,
      status: mapStatus(c.status),
      boardVersion: c.getBoardVersion(),
    }));
    conn = c;
    return c;
  })();
  return initPromise;
}

export async function connectCalliope(): Promise<void> {
  try {
    const c = await getConnection();
    await c.connect();
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
      await c.connect();
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
  // eslint-disable-next-line no-console
  console.log('[calliope] flashing', {
    name,
    rawLen: hex.length,
    cleanLen: cleanHex.length,
    stripped: hex.length - cleanHex.length,
    eofFound: cleanHex.endsWith(':00000001FF') || cleanHex.endsWith(':00000001FF\n') || cleanHex.endsWith(':00000001FF\r\n'),
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
  } catch (err) {
    state.update((s) => ({
      ...s,
      status: 'error',
      errorMessage: (err as Error).message,
      flashProgress: undefined,
    }));
  }
}

/** Send a newline-terminated line to the board over serial. No-op when disconnected. */
export async function sendSerialLine(line: string): Promise<void> {
  if (!conn || conn.status !== ConnectionStatus.CONNECTED) return;
  try {
    await conn.serialWrite(line.endsWith('\n') ? line : line + '\n');
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
