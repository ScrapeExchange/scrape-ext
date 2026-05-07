# YouTube Channel Scraper — Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-browser MV3 extension (Chrome + Firefox) that scans YouTube pages for channel references, submits each unique channel to the Scrape.Exchange request API at most 100/min and 1000/hour, retries failures with exponential backoff, and shows a live submission history in the popup.

**Architecture:** Single TypeScript codebase built with WXT. Three runtime components: a content script that scans YouTube DOM for channel IDs/handles, a background service worker that owns dedup/queue/rate-limiter/retry/prune state and performs HTTP, and a React popup that renders the last 200 history entries. All state lives in `storage.local`. See [docs/superpowers/specs/2026-05-07-youtube-channel-scraper-extension-design.md](../specs/2026-05-07-youtube-channel-scraper-extension-design.md) for the full design.

**Tech Stack:** WXT (extension framework with cross-browser MV3 build), TypeScript 5, React 19 (popup only), Vitest + jsdom (tests), `@webext-core/fake-browser` via WXT's `WxtVitest` (mocks the WebExtension API in tests).

---

## File structure

```
package.json
wxt.config.ts
tsconfig.json
vitest.config.ts
vitest.setup.ts
.gitignore                          (extended)
README.md                           (extended)

entrypoints/
  background.ts                     # WXT entry — wires src/background/router.ts
  content.ts                        # WXT entry — wires src/content/scan.ts
  popup/
    index.html
    main.tsx                        # React mount
    App.tsx                         # popup component

src/
  shared/
    constants.ts                    # API URL, regexes, rate limits, retry schedule
    types.ts                        # QueueItem, HistoryEntry, message types
    sanitize.ts                     # @-strip + apiContent validation
    storage.ts                      # typed storage.local helpers
  content/
    extract.ts                      # URL → identifier extraction (pure)
    pair.ts                         # identifier-preference pairing in DOM
    scan.ts                         # DOM scan orchestrator + SPA navigation hookup
  background/
    dedup.ts                        # dedup map ops
    queue.ts                        # queue ops
    history.ts                      # history ops (cap 200)
    rateLimit.ts                    # sliding window 100/min + 1000/hour
    submit.ts                       # POST to /api/v1/request/youtube/channel
    drain.ts                        # queue drain orchestration
    retry.ts                        # alarm-driven retry with backoff
    prune.ts                        # daily 90-day prune
    router.ts                       # message + alarm dispatch (called from entrypoint)
  popup/
    formatTime.ts                   # Amsterdam local + UTC formatting

tests/
  unit/
    sanitize.test.ts
    extract.test.ts
    pair.test.ts
    storage.test.ts
    dedup.test.ts
    queue.test.ts
    history.test.ts
    rateLimit.test.ts
    submit.test.ts
    drain.test.ts
    retry.test.ts
    prune.test.ts
    formatTime.test.ts
  integration/
    flow.test.ts                    # happy path: candidate → POST → history
    failure.test.ts                 # 503 → retry → fail-after-4
    content-message.test.ts         # content script → background message
```

Each `src/` file has one responsibility; the `background/router.ts` file is the only place that wires modules together. Tests live next to no file (separate `tests/` tree) so the build never sees test code.

---

## Conventions

- **TDD** — every behavioural module follows: write failing test → run-fail → minimal implementation → run-pass → commit.
- **Commits** — one commit per task. Commit messages: short imperative, no `Claude` mention (project rule). Use `git add <specific paths>` (no `git add -A`).
- **Imports** — source uses `import { browser } from 'wxt/browser'`. WXT's testing plugin (`WxtVitest`) auto-mocks this with `@webext-core/fake-browser`, so tests interact with `fakeBrowser` from `wxt/testing`.
- **No worktree, no branch, no PR** without explicit user approval (project rule). All work on `main`.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `wxt.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `.gitignore`

- [ ] **Step 1.1: Create package.json**

```json
{
  "name": "scrape-ext",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@webext-core/fake-browser": "^1.3.1",
    "@wxt-dev/module-react": "^1.1.3",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wxt": "^0.20.0"
  }
}
```

- [ ] **Step 1.2: Create wxt.config.ts**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Scrape.Exchange — YouTube channel scraper',
    description:
      'Scans YouTube pages for channel references and submits each '
      + 'unique channel to the Scrape.Exchange request API.',
    version: '0.1.0',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://scrape.exchange/*',
    ],
  },
});
```

- [ ] **Step 1.3: Create tsconfig.json**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["entrypoints", "src", "tests"],
  "exclude": ["node_modules", ".wxt", ".output"]
}
```

- [ ] **Step 1.4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [WxtVitest()],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 1.5: Create vitest.setup.ts**

```ts
import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

beforeEach(() => {
  fakeBrowser.reset();
});
```

- [ ] **Step 1.6: Append to .gitignore**

Append these lines to `.gitignore` (do not remove existing content):

```
node_modules/
.wxt/
.output/
.web-ext.config.ts
*.log
coverage/
```

- [ ] **Step 1.7: Install dependencies**

Run: `cd /home/steven/src/scrape-ext && npm install`
Expected: dependencies install; postinstall runs `wxt prepare` and creates `.wxt/tsconfig.json`. If `wxt prepare` warns "no entrypoints found", that's expected — we add them later.

- [ ] **Step 1.8: Verify TypeScript compiles**

Run: `npm run compile`
Expected: PASS, no errors.

- [ ] **Step 1.9: Verify Vitest runs (zero tests)**

Run: `npm test`
Expected: "No test files found" — exit 0 or 1 acceptable; we just need vitest to load without crashing.

- [ ] **Step 1.10: Commit**

```bash
git add package.json package-lock.json wxt.config.ts tsconfig.json vitest.config.ts vitest.setup.ts .gitignore
git commit -m "Add WXT + Vitest scaffold for browser extension"
```

---

## Task 2: Shared types and constants

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/constants.ts`

- [ ] **Step 2.1: Create src/shared/types.ts**

```ts
export type Platform = 'youtube';
export type Entity = 'channel';
export type IdentifierKind = 'channel_id' | 'handle';
export type SubmissionStatus =
  | 'queued'
  | 'retrying'
  | 'accepted'
  | 'failed';

export interface QueueItem {
  id: string;
  platform: Platform;
  entity: Entity;
  kind: IdentifierKind;
  rawValue: string;
  apiContent: string;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface HistoryEntry extends QueueItem {
  status: SubmissionStatus;
  lastError?: string;
  acceptedAt?: string;
}

export interface DedupRecord {
  firstSeen: string;
  lastSubmittedAt: string | null;
  status: SubmissionStatus;
  attempts: number;
}

export interface RateWindow {
  perMinute: number[];
  perHour: number[];
}

export interface CandidateMessage {
  type: 'youtube/channel-candidate';
  channel_id?: string;
  handle?: string;
  sourceUrl: string;
}
```

- [ ] **Step 2.2: Create src/shared/constants.ts**

```ts
export const SCHEMA_VERSION = 1;

export const API_BASE = 'https://scrape.exchange';
export const API_REQUEST_PATH = '/api/v1/request';

export const RATE_LIMIT_PER_MINUTE = 100;
export const RATE_LIMIT_PER_HOUR = 1000;

export const RETRY_BACKOFF_MS = [
  60_000,
  300_000,
  1_800_000,
  7_200_000,
] as const;
export const MAX_RETRY_ATTEMPTS = RETRY_BACKOFF_MS.length;

export const HISTORY_CAP = 200;
export const RETENTION_DAYS = 90;

export const PRUNE_ALARM_NAME = 'prune';
export const DRAIN_ALARM_NAME = 'drain';
export const RETRY_ALARM_PREFIX = 'retry:';

export const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
export const HANDLE_RE = /^@[A-Za-z0-9._-]{1,30}$/;
export const API_CONTENT_RE = /^[a-zA-Z0-9:/\\\-_ ]+$/;

export const STORAGE_KEYS = {
  schemaVersion: 'schemaVersion',
  queue: 'queue',
  history: 'history',
  rateWindow: 'rateWindow',
  dedupPrefix: 'dedup:youtube:channel:',
} as const;
```

- [ ] **Step 2.3: Verify compile**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts
git commit -m "Add shared types and constants"
```

---

## Task 3: Sanitize / apiContent validation (TDD)

**Files:**
- Create: `tests/unit/sanitize.test.ts`
- Create: `src/shared/sanitize.ts`

- [ ] **Step 3.1: Write failing test**

`tests/unit/sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toApiContent } from '~/shared/sanitize';

describe('toApiContent', () => {
  it('returns channel_id verbatim when valid', () => {
    expect(toApiContent('channel_id', 'UCBJycsmduvYEL83R_U4JriQ'))
      .toBe('UCBJycsmduvYEL83R_U4JriQ');
  });

  it('strips leading @ from handle', () => {
    expect(toApiContent('handle', '@MrBeast')).toBe('MrBeast');
  });

  it('rejects channel_id that does not match UC pattern', () => {
    expect(toApiContent('channel_id', 'XX123')).toBeNull();
  });

  it('rejects handle without leading @', () => {
    expect(toApiContent('handle', 'MrBeast')).toBeNull();
  });

  it('rejects handle whose stripped form contains characters outside API regex', () => {
    expect(toApiContent('handle', '@hank.green')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(toApiContent('handle', '@')).toBeNull();
    expect(toApiContent('channel_id', '')).toBeNull();
  });

  it('rejects oversized values (>32 chars after strip)', () => {
    const tooLong = '@' + 'a'.repeat(33);
    expect(toApiContent('handle', tooLong)).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npm test -- sanitize`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Write minimal implementation**

`src/shared/sanitize.ts`:

```ts
import {
  API_CONTENT_RE,
  CHANNEL_ID_RE,
  HANDLE_RE,
} from '~/shared/constants';
import type { IdentifierKind } from '~/shared/types';

export function toApiContent(
  kind: IdentifierKind,
  rawValue: string,
): string | null {
  if (kind === 'channel_id') {
    if (!CHANNEL_ID_RE.test(rawValue)) return null;
    return rawValue;
  }

  if (!HANDLE_RE.test(rawValue)) return null;
  const stripped = rawValue.slice(1);
  if (stripped.length === 0 || stripped.length > 32) return null;
  if (!API_CONTENT_RE.test(stripped)) return null;
  return stripped;
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npm test -- sanitize`
Expected: PASS, 7 tests.

- [ ] **Step 3.5: Commit**

```bash
git add src/shared/sanitize.ts tests/unit/sanitize.test.ts
git commit -m "Add sanitize: strip @ from handle and validate API content"
```

---

## Task 4: URL pattern extraction (TDD)

**Files:**
- Create: `tests/unit/extract.test.ts`
- Create: `src/content/extract.ts`

- [ ] **Step 4.1: Write failing test**

`tests/unit/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractFromUrl } from '~/content/extract';

describe('extractFromUrl', () => {
  it('extracts channel_id from /channel/UC… path', () => {
    expect(
      extractFromUrl('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ'),
    ).toEqual({ channel_id: 'UCBJycsmduvYEL83R_U4JriQ' });
  });

  it('extracts handle from /@handle path', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('extracts handle when followed by /videos', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast/videos'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('extracts handle when followed by ?si=…', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast?si=abc'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('returns empty for /c/<name>', () => {
    expect(
      extractFromUrl('https://www.youtube.com/c/Apple'),
    ).toEqual({});
  });

  it('returns empty for /user/<name>', () => {
    expect(
      extractFromUrl('https://www.youtube.com/user/Apple'),
    ).toEqual({});
  });

  it('returns empty for watch pages', () => {
    expect(
      extractFromUrl('https://www.youtube.com/watch?v=abc'),
    ).toEqual({});
  });

  it('rejects malformed channel_id (wrong prefix)', () => {
    expect(
      extractFromUrl('https://www.youtube.com/channel/XCabc'),
    ).toEqual({});
  });

  it('handles relative URLs (resolved against youtube.com)', () => {
    expect(extractFromUrl('/channel/UCBJycsmduvYEL83R_U4JriQ', 'https://www.youtube.com'))
      .toEqual({ channel_id: 'UCBJycsmduvYEL83R_U4JriQ' });
  });

  it('handles m.youtube.com URLs', () => {
    expect(
      extractFromUrl('https://m.youtube.com/@MrBeast'),
    ).toEqual({ handle: '@MrBeast' });
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Write minimal implementation**

`src/content/extract.ts`:

```ts
const CHANNEL_ID_PATH_RE = /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/;
const HANDLE_PATH_RE = /^\/(@[A-Za-z0-9._-]{1,30})(?:\/|$)/;

export interface ExtractResult {
  channel_id?: string;
  handle?: string;
}

export function extractFromUrl(
  href: string,
  base?: string,
): ExtractResult {
  let url: URL;
  try {
    url = new URL(href, base ?? 'https://www.youtube.com');
  } catch {
    return {};
  }

  const channelMatch = url.pathname.match(CHANNEL_ID_PATH_RE);
  if (channelMatch) return { channel_id: channelMatch[1] };

  const handleMatch = url.pathname.match(HANDLE_PATH_RE);
  if (handleMatch) return { handle: handleMatch[1] };

  return {};
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npm test -- extract`
Expected: PASS, 10 tests.

- [ ] **Step 4.5: Commit**

```bash
git add src/content/extract.ts tests/unit/extract.test.ts
git commit -m "Add URL extraction for YouTube channel ids and handles"
```

---

## Task 5: Identifier-preference pairing (TDD)

**Files:**
- Create: `tests/unit/pair.test.ts`
- Create: `src/content/pair.ts`

- [ ] **Step 5.1: Write failing test**

`tests/unit/pair.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pairAnchor } from '~/content/pair';

function makeDom(html: string): Document {
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    'text/html',
  );
  return doc;
}

describe('pairAnchor', () => {
  it('prefers channel_id when sibling anchor in same card has UC link', () => {
    const doc = makeDom(`
      <ytd-channel-renderer>
        <a href="/@MrBeast" class="handle"></a>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
      </ytd-channel-renderer>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns own handle when no sibling channel_id is found', () => {
    const doc = makeDom(`
      <div>
        <a href="/@MrBeast" class="handle"></a>
      </div>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({ handle: '@MrBeast' });
  });

  it('returns own channel_id verbatim', () => {
    const doc = makeDom(`
      <ytd-video-renderer>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
      </ytd-video-renderer>
    `);
    const cidAnchor = doc.querySelector('a.cid') as HTMLAnchorElement;
    expect(pairAnchor(cidAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('walks up to ytd-compact-video-renderer ancestor', () => {
    const doc = makeDom(`
      <ytd-compact-video-renderer>
        <div>
          <a href="/@MrBeast" class="handle"></a>
        </div>
        <div>
          <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
        </div>
      </ytd-compact-video-renderer>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns nothing for an unrelated anchor', () => {
    const doc = makeDom(`<a href="/watch?v=abc"></a>`);
    const a = doc.querySelector('a') as HTMLAnchorElement;
    expect(pairAnchor(a)).toEqual({});
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npm test -- pair`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Write minimal implementation**

`src/content/pair.ts`:

```ts
import { extractFromUrl } from '~/content/extract';
import type { ExtractResult } from '~/content/extract';

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
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `npm test -- pair`
Expected: PASS, 5 tests.

- [ ] **Step 5.5: Commit**

```bash
git add src/content/pair.ts tests/unit/pair.test.ts
git commit -m "Add identifier-preference pairing: prefer channel_id over handle"
```

---

## Task 6: Storage wrapper (TDD)

**Files:**
- Create: `tests/unit/storage.test.ts`
- Create: `src/shared/storage.ts`

- [ ] **Step 6.1: Write failing test**

`tests/unit/storage.test.ts`:

```ts
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
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npm test -- storage`
Expected: FAIL.

- [ ] **Step 6.3: Write minimal implementation**

`src/shared/storage.ts`:

```ts
import { browser } from 'wxt/browser';

export async function getJSON<T>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const result = await browser.storage.local.get(key);
  if (!(key in result)) return defaultValue;
  return result[key] as T;
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
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `npm test -- storage`
Expected: PASS, 4 tests.

- [ ] **Step 6.5: Commit**

```bash
git add src/shared/storage.ts tests/unit/storage.test.ts
git commit -m "Add typed storage.local helpers"
```

---

## Task 7: Dedup module (TDD)

**Files:**
- Create: `tests/unit/dedup.test.ts`
- Create: `src/background/dedup.ts`

- [ ] **Step 7.1: Write failing test**

`tests/unit/dedup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasSeen, recordSeen, recordSubmitted, dedupKey } from '~/background/dedup';
import { getJSON } from '~/shared/storage';
import type { DedupRecord } from '~/shared/types';

describe('dedup', () => {
  it('dedupKey produces stable key', () => {
    expect(dedupKey('UCabc')).toBe('dedup:youtube:channel:UCabc');
    expect(dedupKey('@foo')).toBe('dedup:youtube:channel:@foo');
  });

  it('hasSeen returns false for unknown value', async () => {
    expect(await hasSeen('UCnew')).toBe(false);
  });

  it('recordSeen creates dedup record with status=queued', async () => {
    await recordSeen('UCabc');
    expect(await hasSeen('UCabc')).toBe(true);
    const rec = await getJSON<DedupRecord>(dedupKey('UCabc'), null as never);
    expect(rec.status).toBe('queued');
    expect(rec.attempts).toBe(0);
    expect(rec.lastSubmittedAt).toBeNull();
  });

  it('recordSubmitted updates status to accepted and stamps lastSubmittedAt', async () => {
    await recordSeen('UCabc');
    await recordSubmitted('UCabc', 'accepted');
    const rec = await getJSON<DedupRecord>(dedupKey('UCabc'), null as never);
    expect(rec.status).toBe('accepted');
    expect(rec.lastSubmittedAt).toBeTruthy();
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npm test -- dedup`
Expected: FAIL.

- [ ] **Step 7.3: Write minimal implementation**

`src/background/dedup.ts`:

```ts
import { STORAGE_KEYS } from '~/shared/constants';
import { getJSON, removeKey, setJSON } from '~/shared/storage';
import type { DedupRecord, SubmissionStatus } from '~/shared/types';

export function dedupKey(rawValue: string): string {
  return `${STORAGE_KEYS.dedupPrefix}${rawValue}`;
}

export async function hasSeen(rawValue: string): Promise<boolean> {
  const rec = await getJSON<DedupRecord | null>(dedupKey(rawValue), null);
  return rec !== null;
}

export async function recordSeen(rawValue: string): Promise<void> {
  const now = new Date().toISOString();
  const record: DedupRecord = {
    firstSeen: now,
    lastSubmittedAt: null,
    status: 'queued',
    attempts: 0,
  };
  await setJSON(dedupKey(rawValue), record);
}

export async function recordSubmitted(
  rawValue: string,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const key = dedupKey(rawValue);
  const existing = await getJSON<DedupRecord | null>(key, null);
  if (!existing) return;
  const updated: DedupRecord = {
    ...existing,
    status,
    lastSubmittedAt: new Date().toISOString(),
    attempts: existing.attempts + (status === 'retrying' ? 1 : 0),
  };
  void lastError;
  await setJSON(key, updated);
}

export async function deleteDedup(rawValue: string): Promise<void> {
  await removeKey(dedupKey(rawValue));
}
```

- [ ] **Step 7.4: Run test to verify it passes**

Run: `npm test -- dedup`
Expected: PASS, 4 tests.

- [ ] **Step 7.5: Commit**

```bash
git add src/background/dedup.ts tests/unit/dedup.test.ts
git commit -m "Add dedup map: track per-channel submission state"
```

---

## Task 8: Queue module (TDD)

**Files:**
- Create: `tests/unit/queue.test.ts`
- Create: `src/background/queue.ts`

- [ ] **Step 8.1: Write failing test**

`tests/unit/queue.test.ts`:

```ts
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
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `npm test -- queue`
Expected: FAIL.

- [ ] **Step 8.3: Write minimal implementation**

`src/background/queue.ts`:

```ts
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
```

- [ ] **Step 8.4: Run test to verify it passes**

Run: `npm test -- queue`
Expected: PASS, 5 tests.

- [ ] **Step 8.5: Commit**

```bash
git add src/background/queue.ts tests/unit/queue.test.ts
git commit -m "Add persistent FIFO queue"
```

---

## Task 9: History module (TDD)

**Files:**
- Create: `tests/unit/history.test.ts`
- Create: `src/background/history.ts`

- [ ] **Step 9.1: Write failing test**

`tests/unit/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recordHistory, listHistory, updateHistoryStatus } from '~/background/history';
import { HISTORY_CAP } from '~/shared/constants';
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

describe('history', () => {
  it('starts empty', async () => {
    expect(await listHistory()).toEqual([]);
  });

  it('recordHistory prepends the entry', async () => {
    await recordHistory(item('1'), 'queued');
    await recordHistory(item('2'), 'queued');
    const list = await listHistory();
    expect(list[0]?.id).toBe('2');
    expect(list[1]?.id).toBe('1');
  });

  it('caps history at HISTORY_CAP entries', async () => {
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      await recordHistory(item(String(i)), 'queued');
    }
    const list = await listHistory();
    expect(list.length).toBe(HISTORY_CAP);
    expect(list[0]?.id).toBe(String(HISTORY_CAP + 4));
  });

  it('updateHistoryStatus mutates matching id, leaves others alone', async () => {
    await recordHistory(item('1'), 'queued');
    await recordHistory(item('2'), 'queued');
    await updateHistoryStatus('1', 'accepted');
    const list = await listHistory();
    const e1 = list.find((e) => e.id === '1');
    const e2 = list.find((e) => e.id === '2');
    expect(e1?.status).toBe('accepted');
    expect(e1?.acceptedAt).toBeTruthy();
    expect(e2?.status).toBe('queued');
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `npm test -- history`
Expected: FAIL.

- [ ] **Step 9.3: Write minimal implementation**

`src/background/history.ts`:

```ts
import { HISTORY_CAP, STORAGE_KEYS } from '~/shared/constants';
import { getJSON, setJSON } from '~/shared/storage';
import type {
  HistoryEntry,
  QueueItem,
  SubmissionStatus,
} from '~/shared/types';

async function load(): Promise<HistoryEntry[]> {
  return await getJSON<HistoryEntry[]>(STORAGE_KEYS.history, []);
}

async function save(entries: HistoryEntry[]): Promise<void> {
  await setJSON(STORAGE_KEYS.history, entries);
}

export async function recordHistory(
  item: QueueItem,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const entries = await load();
  const entry: HistoryEntry = { ...item, status, lastError };
  entries.unshift(entry);
  if (entries.length > HISTORY_CAP) entries.length = HISTORY_CAP;
  await save(entries);
}

export async function updateHistoryStatus(
  id: string,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const entries = await load();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const updated: HistoryEntry = {
    ...entries[idx]!,
    status,
    lastError: lastError ?? entries[idx]!.lastError,
    acceptedAt:
      status === 'accepted' ? new Date().toISOString() : entries[idx]!.acceptedAt,
  };
  entries[idx] = updated;
  await save(entries);
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return await load();
}
```

- [ ] **Step 9.4: Run test to verify it passes**

Run: `npm test -- history`
Expected: PASS, 4 tests.

- [ ] **Step 9.5: Commit**

```bash
git add src/background/history.ts tests/unit/history.test.ts
git commit -m "Add submission history with 200-entry cap"
```

---

## Task 10: Rate limiter (TDD)

**Files:**
- Create: `tests/unit/rateLimit.test.ts`
- Create: `src/background/rateLimit.ts`

- [ ] **Step 10.1: Write failing test**

`tests/unit/rateLimit.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { canSubmitNow, recordSubmission, nextAvailableAt } from '~/background/rateLimit';
import { RATE_LIMIT_PER_HOUR, RATE_LIMIT_PER_MINUTE } from '~/shared/constants';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('rateLimit', () => {
  it('canSubmitNow is true on a fresh window', async () => {
    expect(await canSubmitNow()).toBe(true);
  });

  it('canSubmitNow is false after RATE_LIMIT_PER_MINUTE submissions in last 60s', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    expect(await canSubmitNow()).toBe(false);
  });

  it('rolls forward after the per-minute window passes', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    vi.setSystemTime(new Date('2026-05-07T12:01:01Z'));
    expect(await canSubmitNow()).toBe(true);
  });

  it('blocks at the per-hour limit even when per-minute is open', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      await recordSubmission();
      vi.setSystemTime(new Date(Date.now() + 1_000));
    }
    expect(await canSubmitNow()).toBe(false);
  });

  it('nextAvailableAt returns ms-since-epoch when blocked', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    const next = await nextAvailableAt();
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());
  });

  it('nextAvailableAt returns null when not blocked', async () => {
    expect(await nextAvailableAt()).toBeNull();
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `npm test -- rateLimit`
Expected: FAIL.

- [ ] **Step 10.3: Write minimal implementation**

`src/background/rateLimit.ts`:

```ts
import {
  RATE_LIMIT_PER_HOUR,
  RATE_LIMIT_PER_MINUTE,
  STORAGE_KEYS,
} from '~/shared/constants';
import { getJSON, setJSON } from '~/shared/storage';
import type { RateWindow } from '~/shared/types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

async function load(): Promise<RateWindow> {
  return await getJSON<RateWindow>(STORAGE_KEYS.rateWindow, {
    perMinute: [],
    perHour: [],
  });
}

async function save(window: RateWindow): Promise<void> {
  await setJSON(STORAGE_KEYS.rateWindow, window);
}

function prune(window: RateWindow, now: number): RateWindow {
  return {
    perMinute: window.perMinute.filter((ts) => ts > now - MINUTE_MS),
    perHour: window.perHour.filter((ts) => ts > now - HOUR_MS),
  };
}

export async function canSubmitNow(): Promise<boolean> {
  const now = Date.now();
  const w = prune(await load(), now);
  return (
    w.perMinute.length < RATE_LIMIT_PER_MINUTE
    && w.perHour.length < RATE_LIMIT_PER_HOUR
  );
}

export async function recordSubmission(): Promise<void> {
  const now = Date.now();
  const w = prune(await load(), now);
  w.perMinute.push(now);
  w.perHour.push(now);
  await save(w);
}

export async function nextAvailableAt(): Promise<number | null> {
  const now = Date.now();
  const w = prune(await load(), now);

  let earliest: number | null = null;
  if (w.perMinute.length >= RATE_LIMIT_PER_MINUTE) {
    const oldest = w.perMinute[0]!;
    earliest = oldest + MINUTE_MS;
  }
  if (w.perHour.length >= RATE_LIMIT_PER_HOUR) {
    const oldest = w.perHour[0]!;
    const cap = oldest + HOUR_MS;
    earliest = earliest === null ? cap : Math.min(earliest, cap);
  }
  return earliest;
}
```

- [ ] **Step 10.4: Run test to verify it passes**

Run: `npm test -- rateLimit`
Expected: PASS, 6 tests.

- [ ] **Step 10.5: Commit**

```bash
git add src/background/rateLimit.ts tests/unit/rateLimit.test.ts
git commit -m "Add sliding-window rate limiter (100/min, 1000/hour)"
```

---

## Task 11: Submit module (TDD)

**Files:**
- Create: `tests/unit/submit.test.ts`
- Create: `src/background/submit.ts`

- [ ] **Step 11.1: Write failing test**

`tests/unit/submit.test.ts`:

```ts
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
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `npm test -- submit`
Expected: FAIL.

- [ ] **Step 11.3: Write minimal implementation**

`src/background/submit.ts`:

```ts
import { API_BASE, API_REQUEST_PATH } from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

export type SubmitOutcome = 'accepted' | 'retry' | 'terminal';

export interface SubmitResult {
  outcome: SubmitOutcome;
  lastError?: string;
}

export async function submitItem(item: QueueItem): Promise<SubmitResult> {
  const url = `${API_BASE}${API_REQUEST_PATH}/${item.platform}/${item.entity}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: item.apiContent }),
    });
  } catch (err) {
    return { outcome: 'retry', lastError: `network: ${(err as Error).message}` };
  }

  if (response.status === 201) return { outcome: 'accepted' };
  if (response.status >= 500 || response.status === 429) {
    return { outcome: 'retry', lastError: `HTTP ${response.status}` };
  }
  return { outcome: 'terminal', lastError: `HTTP ${response.status}` };
}
```

- [ ] **Step 11.4: Run test to verify it passes**

Run: `npm test -- submit`
Expected: PASS, 7 tests.

- [ ] **Step 11.5: Commit**

```bash
git add src/background/submit.ts tests/unit/submit.test.ts
git commit -m "Add submit: POST to /api/v1/request/youtube/channel with status mapping"
```

---

## Task 12: Retry scheduler (TDD)

**Files:**
- Create: `tests/unit/retry.test.ts`
- Create: `src/background/retry.ts`

- [ ] **Step 12.1: Write failing test**

`tests/unit/retry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { scheduleRetry, isRetryAlarm, alarmIdToItemId } from '~/background/retry';
import { RETRY_BACKOFF_MS, MAX_RETRY_ATTEMPTS, RETRY_ALARM_PREFIX } from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

function item(attempts: number): QueueItem {
  return {
    id: 'qid',
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: 'UCBJycsmduvYEL83R_U4JriQ',
    apiContent: 'UCBJycsmduvYEL83R_U4JriQ',
    enqueuedAt: new Date().toISOString(),
    attempts,
    nextAttemptAt: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('scheduleRetry', () => {
  it('schedules an alarm at now+backoff[attempts] when attempts < MAX', async () => {
    const result = await scheduleRetry(item(0));
    expect(result.scheduled).toBe(true);
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.name).toBe(`${RETRY_ALARM_PREFIX}qid`);
    expect(alarms[0]!.scheduledTime).toBe(Date.now() + RETRY_BACKOFF_MS[0]);
  });

  it('uses backoff[1] for second attempt', async () => {
    await scheduleRetry(item(1));
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms[0]!.scheduledTime).toBe(Date.now() + RETRY_BACKOFF_MS[1]);
  });

  it('returns scheduled=false when attempts >= MAX', async () => {
    const result = await scheduleRetry(item(MAX_RETRY_ATTEMPTS));
    expect(result.scheduled).toBe(false);
    expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
  });
});

describe('isRetryAlarm / alarmIdToItemId', () => {
  it('detects retry alarm prefix', () => {
    expect(isRetryAlarm(`${RETRY_ALARM_PREFIX}xyz`)).toBe(true);
    expect(isRetryAlarm('prune')).toBe(false);
  });

  it('extracts item id from alarm name', () => {
    expect(alarmIdToItemId(`${RETRY_ALARM_PREFIX}xyz`)).toBe('xyz');
  });
});
```

- [ ] **Step 12.2: Run test to verify it fails**

Run: `npm test -- retry`
Expected: FAIL.

- [ ] **Step 12.3: Write minimal implementation**

`src/background/retry.ts`:

```ts
import { browser } from 'wxt/browser';
import {
  MAX_RETRY_ATTEMPTS,
  RETRY_ALARM_PREFIX,
  RETRY_BACKOFF_MS,
} from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

export interface ScheduleResult {
  scheduled: boolean;
  whenMs?: number;
}

export async function scheduleRetry(item: QueueItem): Promise<ScheduleResult> {
  if (item.attempts >= MAX_RETRY_ATTEMPTS) return { scheduled: false };
  const delay = RETRY_BACKOFF_MS[item.attempts]!;
  const when = Date.now() + delay;
  await browser.alarms.create(`${RETRY_ALARM_PREFIX}${item.id}`, { when });
  return { scheduled: true, whenMs: when };
}

export function isRetryAlarm(name: string): boolean {
  return name.startsWith(RETRY_ALARM_PREFIX);
}

export function alarmIdToItemId(name: string): string {
  return name.slice(RETRY_ALARM_PREFIX.length);
}
```

- [ ] **Step 12.4: Run test to verify it passes**

Run: `npm test -- retry`
Expected: PASS, 5 tests.

- [ ] **Step 12.5: Commit**

```bash
git add src/background/retry.ts tests/unit/retry.test.ts
git commit -m "Add retry scheduling via chrome.alarms with exponential backoff"
```

---

## Task 13: Drain orchestrator (TDD)

**Files:**
- Create: `tests/unit/drain.test.ts`
- Create: `src/background/drain.ts`

- [ ] **Step 13.1: Write failing test**

`tests/unit/drain.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { drainOnce } from '~/background/drain';
import { enqueue, size, peekHead } from '~/background/queue';
import { listHistory } from '~/background/history';
import { DRAIN_ALARM_NAME, RATE_LIMIT_PER_MINUTE, RETRY_ALARM_PREFIX } from '~/shared/constants';
import { recordSubmission } from '~/background/rateLimit';
import type { QueueItem } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

function item(id: string, attempts = 0): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id}aaaaaaaaaaaaaaaaaaaaaa`.slice(0, 24),
    apiContent: `UC${id}aaaaaaaaaaaaaaaaaaaaaa`.slice(0, 24),
    enqueuedAt: new Date().toISOString(),
    attempts,
    nextAttemptAt: null,
  };
}

describe('drainOnce', () => {
  it('does nothing when queue empty', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    await drainOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits head of queue, removes it on accept, records history', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    await enqueue(item('a'));
    await drainOnce();
    expect(await size()).toBe(0);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('accepted');
  });

  it('on retry outcome: schedules retry alarm and removes from queue', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await enqueue(item('a', 0));
    await drainOnce();
    expect(await size()).toBe(0);
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a) => a.name === `${RETRY_ALARM_PREFIX}a`)).toBe(true);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('retrying');
  });

  it('on terminal outcome: removes from queue, marks failed in history', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 422 }));
    await enqueue(item('a'));
    await drainOnce();
    expect(await size()).toBe(0);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
  });

  it('when rate-limited: schedules drain alarm at next-available time, leaves queue', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await recordSubmission();
    await enqueue(item('a'));
    await drainOnce();
    expect(await size()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a) => a.name === DRAIN_ALARM_NAME)).toBe(true);
  });

  it('after MAX retry attempts on retry outcome: marks failed, no alarm', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await enqueue(item('a', 4));
    await drainOnce();
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a) => a.name === `${RETRY_ALARM_PREFIX}a`)).toBe(false);
  });
});
```

- [ ] **Step 13.2: Run test to verify it fails**

Run: `npm test -- drain`
Expected: FAIL.

- [ ] **Step 13.3: Write minimal implementation**

`src/background/drain.ts`:

```ts
import { browser } from 'wxt/browser';
import { DRAIN_ALARM_NAME } from '~/shared/constants';
import { recordSubmitted } from '~/background/dedup';
import { updateHistoryStatus } from '~/background/history';
import { popHead, peekHead } from '~/background/queue';
import {
  canSubmitNow,
  nextAvailableAt,
  recordSubmission,
} from '~/background/rateLimit';
import { scheduleRetry } from '~/background/retry';
import { submitItem } from '~/background/submit';

export async function drainOnce(): Promise<void> {
  const head = await peekHead();
  if (!head) return;

  if (!(await canSubmitNow())) {
    const when = await nextAvailableAt();
    if (when !== null) {
      await browser.alarms.create(DRAIN_ALARM_NAME, { when });
    }
    return;
  }

  await popHead();
  const result = await submitItem(head);

  if (result.outcome === 'accepted') {
    await recordSubmission();
    await updateHistoryStatus(head.id, 'accepted');
    await recordSubmitted(head.rawValue, 'accepted');
    return;
  }

  if (result.outcome === 'terminal') {
    await recordSubmission();
    await updateHistoryStatus(head.id, 'failed', result.lastError);
    await recordSubmitted(head.rawValue, 'failed', result.lastError);
    return;
  }

  await recordSubmission();
  const incremented = { ...head, attempts: head.attempts + 1 };
  const sched = await scheduleRetry(incremented);
  if (sched.scheduled) {
    await updateHistoryStatus(head.id, 'retrying', result.lastError);
    await recordSubmitted(head.rawValue, 'retrying', result.lastError);
  } else {
    await updateHistoryStatus(head.id, 'failed', result.lastError);
    await recordSubmitted(head.rawValue, 'failed', result.lastError);
  }
}

export async function drainLoop(): Promise<void> {
  while (await peekHead()) {
    if (!(await canSubmitNow())) {
      const when = await nextAvailableAt();
      if (when !== null) {
        await browser.alarms.create(DRAIN_ALARM_NAME, { when });
      }
      return;
    }
    await drainOnce();
  }
}

export async function enqueueAndDrain(
  enqueueFn: () => Promise<void>,
): Promise<void> {
  await enqueueFn();
  await drainLoop();
}
```

Note: `recordHistory` is intentionally not imported here — drain only updates existing history entries; new entries are created at enqueue time by Task 16's router.

- [ ] **Step 13.4: Run test to verify it passes**

Run: `npm test -- drain`
Expected: PASS, 6 tests.

If a test for "no alarm after MAX attempts" fails, double-check that `popHead` was called before `scheduleRetry` so the head is consumed regardless of outcome.

- [ ] **Step 13.5: Commit**

```bash
git add src/background/drain.ts tests/unit/drain.test.ts
git commit -m "Add drain orchestrator: submit head, retry/terminal/rate-limit branches"
```

---

## Task 14: Prune (TDD)

**Files:**
- Create: `tests/unit/prune.test.ts`
- Create: `src/background/prune.ts`

- [ ] **Step 14.1: Write failing test**

`tests/unit/prune.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runPrune } from '~/background/prune';
import { recordHistory } from '~/background/history';
import { recordSeen, hasSeen } from '~/background/dedup';
import { listHistory } from '~/background/history';
import type { QueueItem } from '~/shared/types';

function makeItem(id: string, enqueuedAt: string): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id.padEnd(22, 'a')}`,
    apiContent: `UC${id.padEnd(22, 'a')}`,
    enqueuedAt,
    attempts: 0,
    nextAttemptAt: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('runPrune', () => {
  it('removes history entries older than 90 days, keeps newer', async () => {
    const old = new Date('2026-02-01T00:00:00Z').toISOString();
    const recent = new Date('2026-05-01T00:00:00Z').toISOString();
    await recordHistory(makeItem('old', old), 'accepted');
    await recordHistory(makeItem('new', recent), 'accepted');
    await runPrune();
    const hist = await listHistory();
    expect(hist.find((h) => h.id === 'old')).toBeUndefined();
    expect(hist.find((h) => h.id === 'new')).toBeDefined();
  });

  it('removes dedup records older than 90 days', async () => {
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    await recordSeen('UCold');
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    await recordSeen('UCnew');
    await runPrune();
    expect(await hasSeen('UCold')).toBe(false);
    expect(await hasSeen('UCnew')).toBe(true);
  });
});
```

- [ ] **Step 14.2: Run test to verify it fails**

Run: `npm test -- prune`
Expected: FAIL.

- [ ] **Step 14.3: Write minimal implementation**

`src/background/prune.ts`:

```ts
import { RETENTION_DAYS, STORAGE_KEYS } from '~/shared/constants';
import { getJSON, listKeysWithPrefix, removeKey, setJSON } from '~/shared/storage';
import type { DedupRecord, HistoryEntry } from '~/shared/types';

const DAY_MS = 86_400_000;

function tooOld(iso: string, now: number): boolean {
  return Date.parse(iso) < now - RETENTION_DAYS * DAY_MS;
}

export async function runPrune(): Promise<void> {
  const now = Date.now();

  const history = await getJSON<HistoryEntry[]>(STORAGE_KEYS.history, []);
  const filteredHistory = history.filter((e) => !tooOld(e.enqueuedAt, now));
  await setJSON(STORAGE_KEYS.history, filteredHistory);

  const dedupKeys = await listKeysWithPrefix(STORAGE_KEYS.dedupPrefix);
  for (const key of dedupKeys) {
    const rec = await getJSON<DedupRecord | null>(key, null);
    if (!rec) continue;
    const last = rec.lastSubmittedAt;
    const tooOldSeen = tooOld(rec.firstSeen, now);
    const tooOldSubmitted = last === null ? true : tooOld(last, now);
    if (tooOldSeen && tooOldSubmitted) {
      await removeKey(key);
    }
  }
}
```

- [ ] **Step 14.4: Run test to verify it passes**

Run: `npm test -- prune`
Expected: PASS, 2 tests.

- [ ] **Step 14.5: Commit**

```bash
git add src/background/prune.ts tests/unit/prune.test.ts
git commit -m "Add 90-day prune for history and dedup map"
```

---

## Task 15: Time formatter (TDD)

**Files:**
- Create: `tests/unit/formatTime.test.ts`
- Create: `src/popup/formatTime.ts`

Project rule: display local Amsterdam time with UTC in parentheses.

- [ ] **Step 15.1: Write failing test**

`tests/unit/formatTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatAmsterdamWithUTC } from '~/popup/formatTime';

describe('formatAmsterdamWithUTC', () => {
  it('formats summer (CEST = UTC+2)', () => {
    expect(formatAmsterdamWithUTC('2026-05-07T12:00:00Z'))
      .toBe('2026-05-07 14:00 (12:00 UTC)');
  });

  it('formats winter (CET = UTC+1)', () => {
    expect(formatAmsterdamWithUTC('2026-12-15T08:30:00Z'))
      .toBe('2026-12-15 09:30 (08:30 UTC)');
  });

  it('returns empty string for invalid input', () => {
    expect(formatAmsterdamWithUTC('not-a-date')).toBe('');
  });
});
```

- [ ] **Step 15.2: Run test to verify it fails**

Run: `npm test -- formatTime`
Expected: FAIL.

- [ ] **Step 15.3: Write minimal implementation**

`src/popup/formatTime.ts`:

```ts
const AMS_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const UTC_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatAmsterdamWithUTC(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const ams = AMS_FMT.format(d).replace(',', '');
  const utc = UTC_FMT.format(d);
  return `${ams} (${utc} UTC)`;
}
```

`sv-SE` (Swedish) is the locale that produces `YYYY-MM-DD HH:MM` with space separator on all engines. The `replace(',', '')` covers older engines that emit a comma between date and time.

- [ ] **Step 15.4: Run test to verify it passes**

Run: `npm test -- formatTime`
Expected: PASS, 3 tests.

- [ ] **Step 15.5: Commit**

```bash
git add src/popup/formatTime.ts tests/unit/formatTime.test.ts
git commit -m "Add formatTime: Amsterdam local time + UTC in parentheses"
```

---

## Task 16: Background entry & router

**Files:**
- Create: `src/background/router.ts`
- Create: `entrypoints/background.ts`

This task wires modules together. No new behaviour beyond what each module already tested. We add an integration smoke test in Task 19.

- [ ] **Step 16.1: Create src/background/router.ts**

```ts
import { browser } from 'wxt/browser';
import {
  CHANNEL_ID_RE,
  DRAIN_ALARM_NAME,
  HANDLE_RE,
  PRUNE_ALARM_NAME,
  STORAGE_KEYS,
  SCHEMA_VERSION,
} from '~/shared/constants';
import { hasSeen, recordSeen } from '~/background/dedup';
import { drainOnce, drainLoop } from '~/background/drain';
import { recordHistory } from '~/background/history';
import { enqueue, findById, unshift, removeById } from '~/background/queue';
import { alarmIdToItemId, isRetryAlarm } from '~/background/retry';
import { runPrune } from '~/background/prune';
import { toApiContent } from '~/shared/sanitize';
import { getJSON, setJSON } from '~/shared/storage';
import type { CandidateMessage, QueueItem } from '~/shared/types';

function uuid(): string {
  return crypto.randomUUID();
}

function pickRawValue(msg: CandidateMessage):
  | { kind: 'channel_id'; rawValue: string }
  | { kind: 'handle'; rawValue: string }
  | null {
  if (msg.channel_id && CHANNEL_ID_RE.test(msg.channel_id)) {
    return { kind: 'channel_id', rawValue: msg.channel_id };
  }
  if (msg.handle && HANDLE_RE.test(msg.handle)) {
    return { kind: 'handle', rawValue: msg.handle };
  }
  return null;
}

async function handleCandidate(msg: CandidateMessage): Promise<void> {
  const picked = pickRawValue(msg);
  if (!picked) return;

  if (await hasSeen(picked.rawValue)) return;

  const apiContent = toApiContent(picked.kind, picked.rawValue);
  if (apiContent === null) return;

  const item: QueueItem = {
    id: uuid(),
    platform: 'youtube',
    entity: 'channel',
    kind: picked.kind,
    rawValue: picked.rawValue,
    apiContent,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
  };

  await recordSeen(picked.rawValue);
  await enqueue(item);
  await recordHistory(item, 'queued');
  await drainLoop();
}

async function handleRetryAlarm(itemId: string): Promise<void> {
  const item = await findById(itemId);
  if (item) {
    return drainLoop();
  }

  const retried: QueueItem | null = await getJSON<QueueItem | null>(
    `pendingRetry:${itemId}`,
    null,
  );
  if (!retried) return;
  await unshift(retried);
  await drainLoop();
}

export async function ensureSchema(): Promise<void> {
  const v = await getJSON<number | null>(STORAGE_KEYS.schemaVersion, null);
  if (v === null) await setJSON(STORAGE_KEYS.schemaVersion, SCHEMA_VERSION);
}

export async function ensurePruneAlarm(): Promise<void> {
  const existing = await browser.alarms.get(PRUNE_ALARM_NAME);
  if (!existing) {
    await browser.alarms.create(PRUNE_ALARM_NAME, { periodInMinutes: 1440 });
  }
}

export function registerHandlers(): void {
  browser.runtime.onMessage.addListener((message, _sender) => {
    const msg = message as Partial<CandidateMessage> | null;
    if (msg && msg.type === 'youtube/channel-candidate') {
      void handleCandidate(msg as CandidateMessage);
    }
    return undefined;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PRUNE_ALARM_NAME) {
      void runPrune();
      return;
    }
    if (alarm.name === DRAIN_ALARM_NAME) {
      void drainOnce();
      return;
    }
    if (isRetryAlarm(alarm.name)) {
      void handleRetryAlarm(alarmIdToItemId(alarm.name));
    }
  });
}

export async function bootstrap(): Promise<void> {
  await ensureSchema();
  await ensurePruneAlarm();
  registerHandlers();
}

export const _internal = { handleCandidate, handleRetryAlarm };
```

The retry alarm path here is tricky: when `drain.ts` schedules a retry, it has already removed the item from the queue. We need a place to stash the in-flight item for the retry alarm to recover. Step 16.2 fixes this in drain.

- [ ] **Step 16.2: Update src/background/drain.ts to stash retry items**

Modify the retry branch in `drainOnce` (the section after `await scheduleRetry(incremented)`) so the item is saved under a `pendingRetry:<id>` key when scheduling succeeds, and removed when it goes terminal.

Replace the existing `drainOnce` body's retry section:

```ts
  await recordSubmission();
  const incremented = { ...head, attempts: head.attempts + 1 };
  const sched = await scheduleRetry(incremented);
  if (sched.scheduled) {
    await updateHistoryStatus(head.id, 'retrying', result.lastError);
    await recordSubmitted(head.rawValue, 'retrying', result.lastError);
  } else {
    await updateHistoryStatus(head.id, 'failed', result.lastError);
    await recordSubmitted(head.rawValue, 'failed', result.lastError);
  }
```

With:

```ts
  await recordSubmission();
  const incremented = { ...head, attempts: head.attempts + 1 };
  const sched = await scheduleRetry(incremented);
  if (sched.scheduled) {
    await setJSON(`pendingRetry:${head.id}`, incremented);
    await updateHistoryStatus(head.id, 'retrying', result.lastError);
    await recordSubmitted(head.rawValue, 'retrying', result.lastError);
  } else {
    await updateHistoryStatus(head.id, 'failed', result.lastError);
    await recordSubmitted(head.rawValue, 'failed', result.lastError);
  }
```

Add this import at the top of `src/background/drain.ts`:

```ts
import { setJSON } from '~/shared/storage';
```

And update `handleRetryAlarm` in `src/background/router.ts` to delete the pending stash after re-enqueue:

```ts
async function handleRetryAlarm(itemId: string): Promise<void> {
  const item = await findById(itemId);
  if (item) {
    return drainLoop();
  }
  const retried = await getJSON<QueueItem | null>(`pendingRetry:${itemId}`, null);
  if (!retried) return;
  await removeKey(`pendingRetry:${itemId}`);
  await unshift(retried);
  await drainLoop();
}
```

Add this import at the top of `src/background/router.ts`:

```ts
import { removeKey } from '~/shared/storage';
```

- [ ] **Step 16.3: Re-run drain tests**

Run: `npm test -- drain`
Expected: PASS, 6 tests (now also writing pendingRetry — verified separately in Task 17).

- [ ] **Step 16.4: Create entrypoints/background.ts**

```ts
import { bootstrap } from '~/background/router';

export default defineBackground(() => {
  void bootstrap();
});
```

`defineBackground` is a WXT global; no import needed.

- [ ] **Step 16.5: Verify TypeScript compiles**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 16.6: Commit**

```bash
git add src/background/router.ts src/background/drain.ts entrypoints/background.ts
git commit -m "Wire background: message router, alarms, retry recovery"
```

---

## Task 17: Integration test — happy path

**Files:**
- Create: `tests/integration/flow.test.ts`

- [ ] **Step 17.1: Write the integration test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { _internal, registerHandlers } from '~/background/router';
import { listHistory } from '~/background/history';
import { hasSeen } from '~/background/dedup';
import { size } from '~/background/queue';
import type { CandidateMessage } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
  registerHandlers();
});

describe('end-to-end happy path', () => {
  it('candidate → POST → accepted → history + dedup', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
    };
    await _internal.handleCandidate(msg);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await size()).toBe(0);
    expect(await hasSeen('UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('accepted');
    expect(hist[0]?.rawValue).toBe('UCBJycsmduvYEL83R_U4JriQ');
  });

  it('same channel from second candidate is deduped, no second POST', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    };
    await _internal.handleCandidate(msg);
    await _internal.handleCandidate(msg);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('handle candidate strips @ before POSTing', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      handle: '@MrBeast',
      sourceUrl: 'https://www.youtube.com/@MrBeast',
    };
    await _internal.handleCandidate(msg);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ content: 'MrBeast' });
  });

  it('rejects malformed channel_id', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'XXbad',
      sourceUrl: 'https://www.youtube.com/',
    };
    await _internal.handleCandidate(msg);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 17.2: Run the test**

Run: `npm test -- integration/flow`
Expected: PASS, 4 tests.

- [ ] **Step 17.3: Commit**

```bash
git add tests/integration/flow.test.ts
git commit -m "Add integration test: candidate to accepted happy path"
```

---

## Task 18: Integration test — failure & retry path

**Files:**
- Create: `tests/integration/failure.test.ts`

- [ ] **Step 18.1: Write the failure-path integration test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { _internal, registerHandlers } from '~/background/router';
import { listHistory } from '~/background/history';
import { RETRY_ALARM_PREFIX } from '~/shared/constants';
import type { CandidateMessage } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  registerHandlers();
});

async function drainAllRetryAlarms(): Promise<number> {
  let fired = 0;
  while (true) {
    const all = await fakeBrowser.alarms.getAll();
    const retry = all.find((a) => a.name.startsWith(RETRY_ALARM_PREFIX));
    if (!retry) return fired;
    const itemId = retry.name.slice(RETRY_ALARM_PREFIX.length);
    await fakeBrowser.alarms.clear(retry.name);
    await _internal.handleRetryAlarm(itemId);
    fired++;
  }
}

describe('failure-path: 503 retries then fails after MAX attempts', () => {
  it('first 503 schedules retry alarm and history shows retrying', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    });
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('retrying');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a) => a.name.startsWith(RETRY_ALARM_PREFIX))).toBe(true);
  });

  it('fails terminally after exhausting retries', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    });
    // Initial submit was attempt 1. Each retry alarm = one more attempt.
    // Drain all retry alarms; once attempts reaches MAX, no further alarm
    // is scheduled and history is marked failed.
    await drainAllRetryAlarms();
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('422 marks failed immediately (terminal)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 422 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      handle: '@MrBeast',
      sourceUrl: 'https://www.youtube.com/',
    });
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a) => a.name.startsWith(RETRY_ALARM_PREFIX))).toBe(false);
  });
});
```

The total attempt count works out as: initial submit (attempt 1) → retry alarm (attempt 2) → retry alarm (attempt 3) → retry alarm (attempt 4) → `scheduleRetry` returns `scheduled: false` → marked failed. So `drainAllRetryAlarms` fires 3 alarms and `fetch` is called 4 times.

- [ ] **Step 18.2: Run the test**

Run: `npm test -- integration/failure`
Expected: PASS, 3 tests.

- [ ] **Step 18.3: Commit**

```bash
git add tests/integration/failure.test.ts
git commit -m "Add integration test: failure path retries with backoff and fails after max"
```

---

## Task 19: Content script entry & DOM scan

**Files:**
- Create: `src/content/scan.ts`
- Create: `entrypoints/content.ts`
- Create: `tests/integration/content-message.test.ts`

- [ ] **Step 19.1: Write the integration test first**

`tests/integration/content-message.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { scanDocument } from '~/content/scan';
import type { CandidateMessage } from '~/shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
});

describe('scanDocument', () => {
  it('emits candidate from current page URL', async () => {
    const sent: unknown[] = [];
    const sendMessage = vi.fn(async (msg) => {
      sent.push(msg);
    });
    await scanDocument({
      currentUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
      sendMessage,
    });
    expect(sent).toContainEqual({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
    } satisfies CandidateMessage);
  });

  it('emits candidate from anchor href', async () => {
    document.body.innerHTML = `
      <a href="/channel/UCBJycsmduvYEL83R_U4JriQ">link</a>
    `;
    const sent: CandidateMessage[] = [];
    await scanDocument({
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m) => { sent.push(m as CandidateMessage); },
    });
    expect(sent.some((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
  });

  it('prefers paired channel_id over handle in same card', async () => {
    document.body.innerHTML = `
      <ytd-channel-renderer>
        <a href="/@MrBeast" class="h"></a>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="c"></a>
      </ytd-channel-renderer>
    `;
    const sent: CandidateMessage[] = [];
    await scanDocument({
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m) => { sent.push(m as CandidateMessage); },
    });
    expect(sent.some((m) => m.handle === '@MrBeast')).toBe(false);
    expect(sent.some((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
  });

  it('emits same anchor only once across two scans (in-tab dedup)', async () => {
    document.body.innerHTML = `
      <a href="/channel/UCBJycsmduvYEL83R_U4JriQ">link</a>
    `;
    const sent: CandidateMessage[] = [];
    const ctx = {
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m: CandidateMessage) => { sent.push(m); },
    };
    await scanDocument(ctx);
    await scanDocument(ctx);
    const cidMessages = sent.filter((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ');
    expect(cidMessages).toHaveLength(1);
  });
});
```

- [ ] **Step 19.2: Run test to verify it fails**

Run: `npm test -- content-message`
Expected: FAIL.

- [ ] **Step 19.3: Write src/content/scan.ts**

```ts
import { extractFromUrl } from '~/content/extract';
import { pairAnchor } from '~/content/pair';
import type { CandidateMessage } from '~/shared/types';

export interface ScanContext {
  currentUrl: string;
  sendMessage: (msg: CandidateMessage) => Promise<void>;
  emitted?: Set<string>;
}

export async function scanDocument(ctx: ScanContext): Promise<void> {
  const seen = ctx.emitted ?? new Set<string>();
  if (!ctx.emitted) ctx.emitted = seen;

  const fromCurrent = extractFromUrl(ctx.currentUrl);
  if (fromCurrent.channel_id || fromCurrent.handle) {
    await emit(ctx, seen, fromCurrent.channel_id, fromCurrent.handle);
  }

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (canonical?.href) {
    const r = extractFromUrl(canonical.href);
    if (r.channel_id || r.handle) {
      await emit(ctx, seen, r.channel_id, r.handle);
    }
  }

  const og = document.querySelector<HTMLMetaElement>(
    'meta[property="og:url"]',
  );
  if (og?.content) {
    const r = extractFromUrl(og.content);
    if (r.channel_id || r.handle) {
      await emit(ctx, seen, r.channel_id, r.handle);
    }
  }

  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/channel/"], a[href*="/@"]',
  );
  for (const a of anchors) {
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
```

- [ ] **Step 19.4: Run the test**

Run: `npm test -- content-message`
Expected: PASS, 4 tests.

- [ ] **Step 19.5: Create entrypoints/content.ts**

```ts
import { browser } from 'wxt/browser';
import { scanDocument } from '~/content/scan';
import type { CandidateMessage } from '~/shared/types';

const SCAN_THROTTLE_MS = 500;
const STUDIO_HOSTS = new Set(['studio.youtube.com']);

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  main(_ctx) {
    if (STUDIO_HOSTS.has(location.hostname)) return;

    const emitted = new Set<string>();
    let timer: number | null = null;

    function schedule(): void {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void scanDocument({
          currentUrl: location.href,
          sendMessage: async (msg: CandidateMessage) => {
            try {
              await browser.runtime.sendMessage(msg);
            } catch {
              /* background not yet warm; will be re-attempted on next scan */
            }
          },
          emitted,
        });
      }, SCAN_THROTTLE_MS);
    }

    schedule();

    window.addEventListener('yt-navigate-finish', schedule);

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(() => schedule());
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  },
});
```

`defineContentScript` is a WXT global; no import needed.

- [ ] **Step 19.6: Verify TypeScript compiles**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 19.7: Commit**

```bash
git add src/content/scan.ts entrypoints/content.ts tests/integration/content-message.test.ts
git commit -m "Add content script: scan YouTube DOM and post candidates to background"
```

---

## Task 20: Popup React UI

**Files:**
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.tsx`
- Create: `entrypoints/popup/App.tsx`

- [ ] **Step 20.1: Create entrypoints/popup/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Scrape.Exchange</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        font-size: 13px;
        width: 360px;
        max-height: 480px;
        overflow-y: auto;
        background: #fafafa;
        color: #111;
      }
      header {
        padding: 8px 12px;
        background: #111;
        color: #fff;
        font-weight: 600;
      }
      ul { list-style: none; margin: 0; padding: 0; }
      li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid #eee;
      }
      .id { font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
      .ts { color: #666; font-size: 11px; white-space: nowrap; }
      .chip {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .chip-accepted { background: #dcfce7; color: #166534; }
      .chip-queued   { background: #e5e7eb; color: #374151; }
      .chip-retrying { background: #fef3c7; color: #92400e; }
      .chip-failed   { background: #fee2e2; color: #991b1b; }
      .empty { padding: 24px 12px; text-align: center; color: #666; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 20.2: Create entrypoints/popup/main.tsx**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
```

- [ ] **Step 20.3: Create entrypoints/popup/App.tsx**

```tsx
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '~/shared/constants';
import { listHistory } from '~/background/history';
import { formatAmsterdamWithUTC } from '~/popup/formatTime';
import type { HistoryEntry } from '~/shared/types';

export function App() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void listHistory().then(setEntries);
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.history]) {
        const next = changes[STORAGE_KEYS.history]!.newValue as HistoryEntry[] | undefined;
        setEntries(next ?? []);
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      browser.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return (
    <>
      <header>Scrape.Exchange — last {entries.length} submissions</header>
      {entries.length === 0 ? (
        <div className="empty">Nothing submitted yet. Visit any YouTube page.</div>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                <span className="id">{e.rawValue}</span>{' '}
                <span className={`chip chip-${e.status}`}>{e.status}</span>
              </span>
              <span className="ts">{formatAmsterdamWithUTC(e.enqueuedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 20.4: Update wxt.config.ts to declare the popup**

Modify `wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Scrape.Exchange — YouTube channel scraper',
    description:
      'Scans YouTube pages for channel references and submits each '
      + 'unique channel to the Scrape.Exchange request API.',
    version: '0.1.0',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://scrape.exchange/*',
    ],
    action: {
      default_title: 'Scrape.Exchange',
      default_popup: 'popup.html',
    },
  },
});
```

- [ ] **Step 20.5: Verify TypeScript compiles**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 20.6: Commit**

```bash
git add entrypoints/popup wxt.config.ts
git commit -m "Add popup UI: history list with status chips and Amsterdam timestamps"
```

---

## Task 21: Build verification & README

**Files:**
- Modify: `README.md`

- [ ] **Step 21.1: Build for Chrome**

Run: `npm run build`
Expected: PASS. Output in `.output/chrome-mv3/`. Check that the directory contains `manifest.json`, `background.js`, `content-scripts/`, and `popup.html`.

- [ ] **Step 21.2: Build for Firefox**

Run: `npm run build:firefox`
Expected: PASS. Output in `.output/firefox-mv3/`.

- [ ] **Step 21.3: Run the full test suite**

Run: `npm test`
Expected: PASS — all unit + integration tests.

- [ ] **Step 21.4: Run TypeScript compile check**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 21.5: Replace README.md with usage instructions**

```markdown
# scrape-ext

Scrape.Exchange browser extension. Scans YouTube pages for channel
references and submits each unique channel to the Scrape.Exchange request
API. Chrome and Firefox, MV3.

## Develop

```
npm install
npm run dev          # Chrome dev build, opens browser with extension loaded
npm run dev:firefox  # Firefox dev build
```

## Build

```
npm run build           # → .output/chrome-mv3/
npm run build:firefox   # → .output/firefox-mv3/
```

Load the unpacked output directory via `chrome://extensions` (Developer mode → Load unpacked) or `about:debugging` (Firefox → This Firefox → Load Temporary Add-on).

## Test

```
npm test
```

## Manual smoke checklist (run in both browsers per release)

- `/@handle` channel page (e.g. https://www.youtube.com/@MrBeast)
- `/channel/UC…` channel page
- Watch page sidebar (paired identifiers)
- Search results page
- Home feed
- SPA navigation between two of the above (no full reload)
- Offline → online resumes drain
- Popup live-updates as submissions land

## Design

See [docs/superpowers/specs/2026-05-07-youtube-channel-scraper-extension-design.md](docs/superpowers/specs/2026-05-07-youtube-channel-scraper-extension-design.md).
```

- [ ] **Step 21.6: Commit**

```bash
git add README.md
git commit -m "Update README with develop/build/test/smoke-test instructions"
```

- [ ] **Step 21.7: Final verification**

Run: `npm test && npm run compile && npm run build && npm run build:firefox`
Expected: all PASS.

---

## Summary

After completing all 21 tasks, the extension will:

- Build for Chrome MV3 and Firefox MV3 from a single TypeScript source.
- Auto-scan every YouTube page (including SPA navigations) for channel IDs and `@handles`.
- Prefer canonical `UC…` channel IDs over handles when both are visible in the same card.
- Strip `@` from handles, validate against the API content regex.
- Dedup against `storage.local` so each channel is submitted at most once per 90 days.
- POST to `https://scrape.exchange/api/v1/request/youtube/channel` at most 100/min and 1000/hour (sliding window, persisted across browser restarts).
- Retry transient failures (5xx, 429, network) with backoff 60s → 5m → 30m → 2h, then mark `failed` after 4 attempts.
- Mark hard failures (4xx other than 429) as `failed` immediately.
- Daily prune entries older than 90 days.
- Show last 200 submissions in the popup with live updates and Amsterdam-local timestamps.
