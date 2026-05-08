import { extractFromUrl } from './extract';
import { pairAnchor } from './pair';
import type { CandidateMessage } from '../shared/types';

export interface ScanContext {
  currentUrl: string;
  sendMessage: (msg: CandidateMessage) => Promise<void>;
  emitted?: Set<string>;
  processedAnchors?: WeakSet<HTMLAnchorElement>;
}

export async function scanDocument(ctx: ScanContext): Promise<void> {
  const seen = ctx.emitted ?? new Set<string>();
  if (!ctx.emitted) ctx.emitted = seen;
  const processed = ctx.processedAnchors ?? new WeakSet<HTMLAnchorElement>();
  if (!ctx.processedAnchors) ctx.processedAnchors = processed;

  const fromCurrent = extractFromUrl(ctx.currentUrl);

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  const fromCanonical = canonical?.href
    ? extractFromUrl(canonical.href)
    : {};

  const og = document.querySelector<HTMLMetaElement>(
    'meta[property="og:url"]',
  );
  const fromOg = og?.content ? extractFromUrl(og.content) : {};

  // The visited page is one channel — prefer canonical/og channel_id over
  // the URL's handle, otherwise the same channel produces two candidates
  // (a `@handle` and a `UCxxx`) that look distinct to the dedup map.
  const pageChannelId =
    fromCanonical.channel_id ?? fromOg.channel_id ?? fromCurrent.channel_id;
  const pageHandle = pageChannelId
    ? undefined
    : (fromCurrent.handle ?? fromCanonical.handle ?? fromOg.handle);
  if (pageChannelId || pageHandle) {
    await emit(ctx, seen, pageChannelId, pageHandle);
  }

  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/channel/"], a[href*="/@"]',
  );
  for (const a of anchors) {
    if (processed.has(a)) continue;
    processed.add(a);
    const paired = pairAnchor(a);
    if (paired.channel_id || paired.handle) {
      await emit(ctx, seen, paired.channel_id, paired.handle);
    }
  }
}

async function emit(
  ctx: ScanContext,
  seen: Set<string>,
  channel_id?: string,
  handle?: string,
): Promise<void> {
  const key = channel_id ? `c:${channel_id}` : handle ? `h:${handle}` : '';
  if (!key) return;
  if (seen.has(key)) return;
  seen.add(key);
  await ctx.sendMessage({
    type: 'youtube/channel-candidate',
    ...(channel_id ? { channel_id } : {}),
    ...(handle ? { handle } : {}),
    sourceUrl: ctx.currentUrl,
  });
}
