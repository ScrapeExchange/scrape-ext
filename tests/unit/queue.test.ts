// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  enqueue,
  peekHead,
  popHead,
  unshift,
  size,
  removeById,
  findById,
} from '~/background/queue';
import type { QueueItem } from '~/shared/types';

function item(id: string): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id.padEnd(22, 'a')}`,
    apiContent: `UC${id.padEnd(22, 'a')}`,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
  };
}

describe('queue', () => {
  it('starts empty', async () => {
    expect(await size()).toBe(0);
    expect(await peekHead()).toBeNull();
  });

  it('enqueue appends to tail', async () => {
    await enqueue(item('1'));
    await enqueue(item('2'));
    expect(await size()).toBe(2);
    expect((await peekHead())?.id).toBe('1');
  });

  it('popHead removes and returns first item', async () => {
    await enqueue(item('1'));
    await enqueue(item('2'));
    expect((await popHead())?.id).toBe('1');
    expect((await peekHead())?.id).toBe('2');
  });

  it('unshift prepends', async () => {
    await enqueue(item('1'));
    await unshift(item('0'));
    expect((await peekHead())?.id).toBe('0');
  });

  it('removeById removes the matching item', async () => {
    await enqueue(item('1'));
    await enqueue(item('2'));
    await enqueue(item('3'));
    await removeById('2');
    expect(await size()).toBe(2);
    expect(await findById('2')).toBeNull();
    expect((await findById('3'))?.id).toBe('3');
  });
});
