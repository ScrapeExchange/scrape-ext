import { browser } from 'wxt/browser';
import {
  CHANNEL_ID_RE,
  DRAIN_ALARM_NAME,
  HANDLE_RE,
  PRUNE_ALARM_NAME,
  STORAGE_KEYS,
  SCHEMA_VERSION,
} from '../shared/constants';
import { hasSeen, recordSeen } from './dedup';
import { drainOnce, drainLoop } from './drain';
import { recordHistory } from './history';
import { enqueue, findById, unshift } from './queue';
import { alarmIdToItemId, isRetryAlarm } from './retry';
import { runPrune } from './prune';
import { toApiContent } from '../shared/sanitize';
import { getJSON, removeKey, setJSON } from '../shared/storage';
import type { CandidateMessage, QueueItem } from '../shared/types';

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
  const retried = await getJSON<QueueItem | null>(`pendingRetry:${itemId}`, null);
  if (!retried) return;
  await removeKey(`pendingRetry:${itemId}`);
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
