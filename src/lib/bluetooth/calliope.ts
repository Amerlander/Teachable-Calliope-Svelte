// Simple Bluetooth helper for Calliope mini UART-like behaviour
import { addDevice as btAddDevice, updateDevice as btUpdateDevice, setConnectedDevice as btSetConnectedDevice, pushLog as btPushLog } from '$lib/stores/bluetooth';
export type GattOperation = { op: 'write' | 'notify' | 'read'; service: string; characteristic: string; data?: Uint8Array };

let device: any = null;
let server: any = null;
let txChar: any = null;
let rxChar: any = null;
let queue: Array<GattOperation> = [];
let isProcessing = false;

export async function connect(deviceRef?: any) {
  try {
    if (!deviceRef) {
      device = await (navigator as any).bluetooth.requestDevice({ filters: [{ namePrefix: 'Calliope' }], optionalServices: ['00001523-1212-efde-1523-785feabcd123'] });
    } else {
      device = deviceRef;
    }
    server = await device.gatt.connect();
    // try to get UART-like service and characteristics - calliope / micro:bit uses NUS or custom service
    const services = await server.getPrimaryServices();
    for (const s of services) {
      // look for NUS or UART-like service
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          // heuristics: name includes 'tx'/'rx' or uuid contains 'tx' or 'rx'
          const uuid = c.uuid || '';
          if (!txChar && /(tx|txd|txb)/i.test(uuid)) txChar = c;
          if (!rxChar && /(rx|rxd|rxb)/i.test(uuid)) rxChar = c;
        }
      } catch (err) { /* ignore */ }
    }
    if (!txChar || !rxChar) {
      // fallback: choose first characteristic for send and notify
      const s = services[0];
      const chars = await s.getCharacteristics();
      txChar = chars[0];
      rxChar = chars[1] || chars[0];
    }
    try { await rxChar.startNotifications(); } catch (e) { }
    device.ongattserverdisconnected = onDisconnected;
    try {
      btAddDevice({ id: device.id, name: device.name, device, connected: true });
      btSetConnectedDevice(device.id);
      btPushLog('info', `Connected to Bluetooth device: ${device.name || device.id}`);
      // Also fetch services & characteristics
      try { await discoverServicesAndCharacteristics(); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Bluetooth connect failed', err);
    try { btPushLog('error', `Bluetooth connect failed: ${(err as any)?.message || err}`); } catch (e) {}
    throw err;
  }
}

export function onDisconnected(evt?: any) {
  console.log('Device disconnected', evt);
  device = null;
  server = null;
  txChar = null;
  rxChar = null;
  // call listeners
  try { disconnectListeners.forEach(cb => cb(evt)); } catch (e) {}
}

export function disconnect() {
  if (device && device.gatt && device.gatt.connected) {
    device.gatt.disconnect();
  }
  device = null;
  server = null;
  txChar = null;
  rxChar = null;
  try { btSetConnectedDevice(null); } catch (e) {}
}

export async function discoverDevice() {
  try {
    const d = await (navigator as any).bluetooth.requestDevice({ filters: [{ namePrefix: 'Calliope' }], optionalServices: ['00001523-1212-efde-1523-785feabcd123'] });
    try { btAddDevice({ id: d.id, name: d.name, device: d, connected: !!(d.gatt && d.gatt.connected) }); } catch (e) {}
    return d;
  } catch (err) {
    try { btPushLog('error', `Bluetooth discover failed: ${(err as any)?.message || err}`); } catch (e) {}
    throw err;
  }
}

export async function discoverServicesAndCharacteristics(dev?: any) {
  const d = dev || device;
  if (!d || !d.gatt) return;
  try {
    const srv = d.gatt;
    const primaryServices = await srv.getPrimaryServices();
    const services: string[] = [];
    const characteristics: any[] = [];
    for (const s of primaryServices) {
      try {
        services.push(s.uuid);
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          const props: any = {};
          if (c.properties) {
            for (const key in c.properties) {
              props[key] = (c.properties as any)[key];
            }
          }
          characteristics.push({ uuid: c.uuid, properties: props });
        }
      } catch (err) { /* ignore */ }
    }
    try { btUpdateDevice(d.id, { services, characteristics }); } catch (e) { /* ignore */ }
    return { services, characteristics };
  } catch (err) {
    console.warn('discoverServicesAndCharacteristics failed', err);
    throw err;
  }
}

export async function sendUART(text: string) {
  if (!txChar) throw new Error('TX characteristic not available');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text + '\n');
  // split into chunks if necessary - MTU limited
  const CHUNK = 128;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK);
    await txChar.writeValue(chunk);
  }
  try { btPushLog('tx', text); } catch (e) {}
}

export function queueGattOperation(operation: GattOperation) {
  queue.push(operation);
  if (!isProcessing) processQueue();
}

async function processQueue() {
  isProcessing = true;
  while (queue.length > 0) {
    const op = queue.shift()!;
    try {
      if (!server || !server.connected) break;
      const serv = await server.getPrimaryService(op.service);
      const char = await serv.getCharacteristic(op.characteristic);
      if (op.op === 'write') await char.writeValue(op.data!);
      else if (op.op === 'read') await char.readValue();
    } catch (err) {
      console.warn('Gatt operation failed', err);
    }
  }
  isProcessing = false;
}

export function setTxCallback(callback: (value: string) => void) {
  if (!rxChar) return;
  rxChar.addEventListener('characteristicvaluechanged', (ev: any) => {
    try {
      const value = new TextDecoder().decode(ev.target.value.buffer);
      try { btPushLog('rx', value); } catch (e) {}
      callback(value);
    } catch (err) { /* ignore */ }
  });
}

export function isConnected() {
  return !!(device && device.gatt && device.gatt.connected);
}

export function getDeviceName() {
  return device?.name || null;
}

let disconnectListeners: Array<(ev?: any) => void> = [];
export function onDisconnectedAddListener(cb: (ev?: any) => void) { disconnectListeners.push(cb); }
