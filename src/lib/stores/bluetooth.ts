import { writable } from 'svelte/store';

export type BluetoothCharInfo = { uuid: string; properties: Record<string, boolean> };
export type BluetoothDeviceInfo = {
  id: string;
  name?: string | null;
  device?: any;
  connected?: boolean;
  services?: string[];
  characteristics?: BluetoothCharInfo[];
};

export type BluetoothLog = { time: number; level: 'info' | 'warn' | 'error' | 'tx' | 'rx'; message: string };

export const devices = writable<BluetoothDeviceInfo[]>([]);
export const connectedDeviceId = writable<string | null>(null);
export const logs = writable<BluetoothLog[]>([]);

export function addDevice(d: BluetoothDeviceInfo) {
  devices.update(list => {
    const existing = list.find(x => x.id === d.id);
    if (existing) {
      Object.assign(existing, d);
    } else {
      list.push(d);
    }
    return list;
  });
}

export function updateDevice(id: string, patch: Partial<BluetoothDeviceInfo>) {
  devices.update(list => list.map(d => d.id === id ? { ...d, ...patch } : d));
}

export function removeDevice(id: string) {
  devices.update(list => list.filter(d => d.id !== id));
}

export function setConnectedDevice(id: string | null) {
  connectedDeviceId.set(id);
  devices.update(list => list.map(d => ({ ...d, connected: d.id === id })));
}

export function pushLog(level: BluetoothLog['level'], message: string) {
  const log = { time: Date.now(), level, message };
  logs.update(l => {
    const out = [...l, log];
    if (out.length > 300) out.shift();
    return out;
  });
}

export function clearLogs() {
  logs.set([]);
}
