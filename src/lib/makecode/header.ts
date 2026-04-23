// Calliope mini v3 target. Any project we hand to makecode.calliope.cc in
// controller=2 mode must carry this header or the editor won't bind.

export const CALLIOPE_TARGET = 'calliopemini';
export const CALLIOPE_TARGET_VERSION = '8.1.5';

export function randomHeaderId(): string {
  const s = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  return `${s(8)}-${s(4)}-${s(4)}-${s(4)}-${s(12)}`;
}

export function createCalliopeHeader(name: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    target: CALLIOPE_TARGET,
    targetVersion: CALLIOPE_TARGET_VERSION,
    name,
    meta: {},
    editor: 'blocksprj',
    pubId: '',
    pubCurrent: false,
    _rev: null,
    id: randomHeaderId(),
    recentUse: now,
    modificationTime: now,
    cloudUserId: null,
    cloudCurrent: false,
    cloudVersion: null,
    cloudLastSyncTime: 0,
    isDeleted: false,
    githubCurrent: false,
    saveId: null,
  };
}
