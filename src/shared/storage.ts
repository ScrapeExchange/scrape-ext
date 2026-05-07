import { browser } from 'wxt/browser';

export async function getJSON<T>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const result = await browser.storage.local.get(key);
  const value = result[key];
  return value === undefined ? defaultValue : (value as T);
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function removeKey(key: string): Promise<void> {
  await browser.storage.local.remove(key);
}

export async function listKeysWithPrefix(
  prefix: string,
): Promise<string[]> {
  const all = await browser.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(prefix));
}
