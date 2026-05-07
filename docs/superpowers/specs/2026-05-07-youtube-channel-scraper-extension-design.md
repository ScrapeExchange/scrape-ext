# YouTube Channel Scraper — Browser Extension (v1) Design

**Date:** 2026-05-07
**Status:** Approved for planning
**Targets:** Chrome (MV3), Firefox (MV3)

## Goal

A cross-browser extension that, while the user browses YouTube, discovers channel
references on every page and submits each unique channel to the Scrape.Exchange
request API. The popup shows a live history of what has been submitted.

YouTube channels only in v1. Other Scrape.Exchange platforms are out of scope.

## API

- **Endpoint:** `POST https://scrape.exchange/api/v1/request/youtube/channel`
- **Body:** `{"content": "<id-or-stripped-handle>"}`
- **Auth:** none (endpoint is unauthenticated today)
- **Content constraints (server-enforced):**
  - 1–32 characters
  - Regex `^[a-zA-Z0-9:/\\\-_ ]+$` — note `@` is NOT allowed; the leading `@`
    of a YouTube handle must be stripped before submission.
- **Responses:**
  - `201 {"status": "accepted"}` — submission recorded.
  - `503` — Redis bucket full or unavailable. Treat as retryable.

## Architecture

Three runtime components, **single TypeScript codebase**, built with WXT for
both Chrome and Firefox.

### Components

1. **Content script** — matches `*://*.youtube.com/*`. Pure read-only DOM scan.
   Sends candidate identifiers to the background. Re-scans on YouTube SPA
   navigation. Excludes `studio.youtube.com` at runtime.
2. **Background service worker** — owner of all canonical state. Maintains the
   dedup map, submission queue, history, rate limiter, retry alarms, and the
   daily prune alarm. Performs the HTTP POST.
3. **Popup (React)** — read-only view of the last 200 history entries.
   Live-updates via `storage.onChanged`.

### Why background-orchestrated

Rate limiting (100/min, 1000/hour) must be consistent across all open YouTube
tabs. Putting the queue and rate limiter in any per-tab content script makes
the limit racy. The service worker is the single source of truth.

### Permissions (manifest)

```
host_permissions: ["*://*.youtube.com/*", "https://scrape.exchange/*"]
permissions:      ["storage", "alarms"]
```

No `tabs`, no `scripting`, no `activeTab`.

## Data model (`storage.local`)

```
schemaVersion                       number
dedup:youtube:channel:<value>       { firstSeen: ISO,
                                      lastSubmittedAt: ISO | null,
                                      status: 'accepted' | 'queued' | 'retrying' | 'failed',
                                      attempts: number }
queue                               QueueItem[]            (FIFO, persisted)
history                             HistoryEntry[]         (cap 200, FIFO)
rateWindow                          { perMinute: number[],  // UNIX ms
                                      perHour:   number[] }
```

`<value>` for handles preserves the leading `@` to prevent collision with a
hypothetical channel literally named the same string without `@`.

### `QueueItem`

```
{
  id: string                    // uuid v4, also used as alarm name
  platform: 'youtube'
  entity:   'channel'
  kind:     'channel_id' | 'handle'
  rawValue: string              // 'UCabc...' or '@foo'
  apiContent: string            // 'UCabc...' or 'foo' (after @ strip)
  enqueuedAt: ISO
  attempts: number              // 0 on first try
  nextAttemptAt: ISO | null
}
```

### `HistoryEntry`

`QueueItem` plus `status` and optional `lastError: string`.

## Identifier preference rule

YouTube routinely surfaces both a `UC…` channel ID and an `@handle` for the
same channel (sidebar cards on watch pages, search results). The content
script applies this rule **before sending** to background:

- If both can be paired (same anchor or same card ancestor), send only the
  `channel_id`.
- If only one is present, send that one.

The "same card" heuristic walks up to the nearest of these elements and
inspects siblings:

- `ytd-channel-renderer`
- `ytd-video-renderer`
- `ytd-compact-video-renderer`

If no such ancestor exists, send what is on hand.

## Content-script extraction

### Patterns

```
/channel/(UC[A-Za-z0-9_-]{22})        → channel_id
/(@[A-Za-z0-9._-]{1,30})(?:/|$|\?)    → handle
```

`/c/<name>` and `/user/<name>` are legacy YouTube paths whose `<name>` is
neither a `UC…` ID nor a true `@handle`. **Skip in v1.**

### Sources scanned

1. `location.pathname` of the current page.
2. `link[rel="canonical"]` and `meta[property="og:url"]` — watch pages expose
   the channel via these.
3. `document.querySelectorAll('a[href*="/channel/"], a[href*="/@"]')` — each
   `href` resolved via `new URL(href, location.origin)` then matched.

### SPA navigation

Listen for both:

- `window.addEventListener('yt-navigate-finish', scan)` — YouTube's own event.
- `MutationObserver` on `document.querySelector('title')` as a fallback.

Re-scans throttled to once per 500ms.

### In-tab dedup

A `Set<string>` of values already forwarded to background from this tab.
Cleared only on full page unload — survives SPA navigation. Prevents
spamming background as the user scrolls or revisits cards.

## Validation in background

Before enqueuing, the background validates:

- `channel_id` matches `^UC[A-Za-z0-9_-]{22}$` (24 chars total).
- `handle` (after stripping `@`) matches `^[A-Za-z0-9._-]{1,30}$`. The
  resulting `apiContent` is asserted ≤ 32 characters.

Invalid candidates are dropped silently (logged to background console only —
not surfaced to the user).

## Submission

### Content sanitization

For `kind: 'handle'`, strip the leading `@` to produce `apiContent`. For
`kind: 'channel_id'`, `apiContent === rawValue`.

The API regex does not accept `@`; submissions of `@foo` would 422. After
strip, both forms cleanly satisfy the regex.

### Rate limiter (sliding window)

Before each POST:

1. Prune timestamps older than 60s from `rateWindow.perMinute`.
2. Prune timestamps older than 3600s from `rateWindow.perHour`.
3. If `perMinute.length >= 100` or `perHour.length >= 1000`, schedule the
   drain to wake at `min(oldest_minute_ts + 60s, oldest_hour_ts + 3600s)`.
4. Otherwise: send the POST. On HTTP 201, push `Date.now()` to both arrays.

### Retry on failure

Failure cases:

- Network error (`fetch` rejection, offline) → retry.
- HTTP 5xx (including 503 bucket-full) → retry.
- HTTP 429 → retry.
- HTTP 4xx (other) → terminal failure, mark `failed` in history immediately.

Backoff schedule (attempts indexed 0..3):

| Attempt | Delay |
|--------:|------:|
| 0 → 1   | 60s   |
| 1 → 2   | 300s  |
| 2 → 3   | 1800s |
| 3 → 4   | 7200s |
| > 3     | drop, mark `failed` |

Retries are scheduled with `chrome.alarms.create(item.id, { when: nextAttemptAt })`.
The alarm handler re-enqueues at the head of the queue.

## 90-day prune

`chrome.alarms.create('prune', { periodInMinutes: 1440 })`.

Walks `dedup:*` and `history`. Removes entries where:

- `firstSeen` (dedup) is older than 90 days, **and**
- `lastSubmittedAt` (dedup) is null or older than 90 days.

Removes `history` entries older than 90 days. After prune, the cap of 200
still applies.

After 90 days, a re-encountered channel will be re-submitted. This matches
the API's own retention semantics (Redis hash with eventual eviction).

## Popup UI

React, mounted by WXT. Read-only.

Renders the history list, reverse-chronological, last 200 entries. Each row:

- Identifier (id or `@handle`)
- Local time + UTC in parentheses (per project convention; Amsterdam local)
- Status chip: `accepted` (green), `queued` (grey), `retrying` (amber), `failed` (red)

Subscribes to `chrome.storage.onChanged` for `history` and re-renders on
change. No controls in v1 (no pause, no clear, no retry button).

## Configuration

Hardcoded `https://scrape.exchange`. No options page in v1. No API key.

## Testing strategy

### Unit (Vitest)

- URL/handle extractor regexes — table-driven (legitimate, malformed,
  adversarial).
- Handle `@`-strip + `apiContent` validation against the API content regex.
- Rate limiter — synthetic timestamps, assert gating at 100/min and
  1000/hour boundaries.
- Retry scheduler — mock `chrome.alarms`, assert backoff series and the
  "drop after 4" terminal state.
- 90-day prune — seeded mixed-age entries, assert correct removal.
- Dedup — same channel via multiple paths enqueues exactly once.
- Identifier-preference pairing — fixture HTML, assert handle suppressed
  when paired with `UC…`.

### Integration (`@webext-core/fake-browser` or WXT's test utilities)

- Content-script → background message flow against fixture HTML.
- Full submission cycle with `fetch` mocked: enqueue → drain → history
  updated → dedup map updated.
- Failure path: 503 → alarm scheduled → fires → retry → eventual `failed`
  after 4 attempts.

### Manual smoke checklist (run in both browsers per release)

- `/@handle` channel page
- `/channel/UC…` channel page
- Watch page sidebar (paired identifiers)
- Search results page
- Home feed
- SPA navigation between two of the above
- Offline → online resumes drain
- Popup live-updates as submissions land

No Puppeteer/Playwright e2e harness in v1.

## Out of scope (v1)

- Platforms other than YouTube.
- Entity types other than `channel` (no videos, posts, comments).
- Legacy `/c/<name>` and `/user/<name>` URLs.
- Options page / API key configuration.
- Manual retry, pause toggle, clear history.
- `studio.youtube.com` (excluded at runtime).
- Export of history.
