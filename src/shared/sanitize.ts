import {
  API_CONTENT_RE,
  CHANNEL_ID_RE,
  HANDLE_RE,
} from './constants';
import type { IdentifierKind } from './types';

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
