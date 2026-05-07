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
import { setJSON } from '~/shared/storage';

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
    await setJSON(`pendingRetry:${head.id}`, incremented);
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
