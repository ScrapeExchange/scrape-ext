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
