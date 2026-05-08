// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  getJSON,
  setJSON,
  removeKey,
  listKeysWithPrefix,
} from '~/shared/storage';

describe('storage helpers', () => {
  it('getJSON returns default when key absent', async () => {
    expect(await getJSON('missing', { a: 1 })).toEqual({ a: 1 });
  });

  it('setJSON then getJSON round-trips', async () => {
    await setJSON('k', { x: 'y' });
    expect(await getJSON('k', null)).toEqual({ x: 'y' });
  });

  it('removeKey deletes the key', async () => {
    await setJSON('k', 1);
    await removeKey('k');
    expect(await getJSON('k', null)).toBeNull();
  });

  it('listKeysWithPrefix returns matching keys only', async () => {
    await setJSON('dedup:youtube:channel:UCabc', { a: 1 });
    await setJSON('dedup:youtube:channel:UCdef', { a: 2 });
    await setJSON('queue', []);
    const keys = await listKeysWithPrefix('dedup:youtube:channel:');
    expect(keys.sort()).toEqual([
      'dedup:youtube:channel:UCabc',
      'dedup:youtube:channel:UCdef',
    ]);
  });
});
