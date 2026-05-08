import { extractFromUrl } from './extract';
import type { ExtractResult } from './extract';

const CARD_TAGS = new Set([
  'YTD-CHANNEL-RENDERER',
  'YTD-VIDEO-RENDERER',
  'YTD-COMPACT-VIDEO-RENDERER',
]);

function findCardAncestor(node: Element): Element | null {
  let cur: Element | null = node.parentElement;
  while (cur) {
    if (CARD_TAGS.has(cur.tagName)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function findChannelIdInCard(card: Element): string | null {
  const anchors = card.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/channel/"]',
  );
  for (const a of anchors) {
    const r = extractFromUrl(a.getAttribute('href') ?? '');
    if (r.channel_id) return r.channel_id;
  }
  return null;
}

export function pairAnchor(anchor: HTMLAnchorElement): ExtractResult {
  const own = extractFromUrl(anchor.getAttribute('href') ?? '');
  if (own.channel_id) return { channel_id: own.channel_id };
  if (!own.handle) return {};

  const card = findCardAncestor(anchor);
  if (card) {
    const cid = findChannelIdInCard(card);
    if (cid) return { channel_id: cid };
  }
  return { handle: own.handle };
}
