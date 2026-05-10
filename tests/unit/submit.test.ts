import { describe, it, expect, beforeEach, vi } from 'vitest';
import { submitItem } from '~/background/submit';
import type { QueueItem } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

function makeItem(): QueueItem {
  return {
    id: 'abc',
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: 'UCBJycsmduvYEL83R_U4JriQ',
    apiContent: 'UCBJycsmduvYEL83R_U4JriQ',
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
  };
}

describe('submitItem', () => {
  it('returns ok=true on 201', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'accepted' }), { status: 201 }),
    );
    const result = await submitItem(makeItem());
    expect(result).toEqual({ outcome: 'accepted' });
  });

  it('returns duplicate on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 }),
    );
    const result = await submitItem(makeItem());
    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('POSTs to the correct URL with correct body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{}', { status: 201 }),
    );
    await submitItem(makeItem());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://scrape.exchange/api/v1/request/youtube/channel',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      content: 'UCBJycsmduvYEL83R_U4JriQ',
    });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns retry on 503', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await submitItem(makeItem())).outcome).toBe('retry');
  });

  it('returns retry on network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect((await submitItem(makeItem())).outcome).toBe('retry');
  });

  it('returns retry on 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    expect((await submitItem(makeItem())).outcome).toBe('retry');
  });

  it('returns terminal on 422 (validation)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":"bad"}', { status: 422 }),
    );
    const result = await submitItem(makeItem());
    expect(result.outcome).toBe('terminal');
    expect(result.lastError).toContain('422');
  });

  it('returns terminal on 4xx other than 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));
    expect((await submitItem(makeItem())).outcome).toBe('terminal');
  });
});
