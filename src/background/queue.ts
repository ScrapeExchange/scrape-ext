import { STORAGE_KEYS } from '~/shared/constants';
import { getJSON, setJSON } from '~/shared/storage';
import type { QueueItem } from '~/shared/types';

async function load(): Promise<QueueItem[]> {
  return await getJSON<QueueItem[]>(STORAGE_KEYS.queue, []);
}

async function save(items: QueueItem[]): Promise<void> {
  await setJSON(STORAGE_KEYS.queue, items);
}

export async function enqueue(item: QueueItem): Promise<void> {
  const q = await load();
  q.push(item);
  await save(q);
}

export async function unshift(item: QueueItem): Promise<void> {
  const q = await load();
  q.unshift(item);
  await save(q);
}

export async function peekHead(): Promise<QueueItem | null> {
  const q = await load();
  return q[0] ?? null;
}

export async function popHead(): Promise<QueueItem | null> {
  const q = await load();
  const head = q.shift();
  await save(q);
  return head ?? null;
}

export async function size(): Promise<number> {
  return (await load()).length;
}

export async function findById(id: string): Promise<QueueItem | null> {
  const q = await load();
  return q.find((i) => i.id === id) ?? null;
}

export async function removeById(id: string): Promise<void> {
  const q = await load();
  await save(q.filter((i) => i.id !== id));
}
