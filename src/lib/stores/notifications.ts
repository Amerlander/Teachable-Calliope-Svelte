import { writable } from 'svelte/store';

export type Notification = { id: string; message: string; type?: 'info' | 'success' | 'error' | 'warning'; duration?: number };

export const notifications = writable<Notification[]>([]);

export function showNotification(message: string, options?: { type?: 'info' | 'success' | 'error' | 'warning'; duration?: number }) {
  const id = Math.random().toString(36).slice(2);
  const n: Notification = { id, message, type: options?.type || 'info', duration: options?.duration || 4000 };
  notifications.update(arr => [...arr, n]);
  if (n.duration && n.duration > 0) {
    setTimeout(() => {
      notifications.update(arr => arr.filter(x => x.id !== id));
    }, n.duration);
  }
  return id;
}

export function hideNotification(id: string) {
  notifications.update(arr => arr.filter(x => x.id !== id));
}

export function clearNotifications() {
  notifications.set([]);
}
