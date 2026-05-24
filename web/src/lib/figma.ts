// Browser-side Figma REST API client.
// Same shape as ../../src/api/client.ts, but rate-limit-friendly for browser UX.

import type { FigmaNode } from '../../../src/api/types.ts';

const BASE = 'https://api.figma.com/v1';

// Slightly more conservative than CLI (~50 req/min) to leave headroom.
const MIN_REQUEST_GAP_MS = 1200;
let lastRequestAt = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);
  lastRequestAt = Date.now();

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'X-Figma-Token': token,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 10) * 1000;
    await sleep(retryAfter);
    return apiFetch(token, path, init);
  }

  return res;
}

export interface ProjectFile {
  key: string;
  name: string;
  last_modified: string;
  thumbnail_url?: string | null;
}

export async function getProjectFiles(token: string, projectId: string): Promise<ProjectFile[]> {
  const res = await apiFetch(token, `/projects/${projectId}/files`);
  if (!res.ok) {
    throw new Error(`Failed to list project (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.files;
}

export interface FileContent {
  key: string;
  name: string;
  lastModified: string;
  document: FigmaNode;
}

export async function getFile(token: string, key: string): Promise<FileContent> {
  // No depth limit — depth=N returns boundary containers with `children`
  // omitted, which would be miscounted as empty containers. Fetch the
  // full tree so the audit matches the in-Figma sandbox view.
  const res = await apiFetch(token, `/files/${key}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch file (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return {
    key,
    name: data.name,
    lastModified: data.lastModified,
    document: data.document,
  };
}

export async function postComment(token: string, key: string, message: string): Promise<void> {
  const res = await apiFetch(token, `/files/${key}/comments`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to post comment (${res.status}): ${await res.text()}`);
  }
}

export function figmaFileUrl(key: string): string {
  return `https://www.figma.com/design/${key}`;
}

/**
 * Per-file Google Chat ping with a link back to the file.
 * Note: Chat webhooks don't send CORS headers, so we fire as `no-cors` and
 * can't read the response. Treat as fire-and-forget.
 */
export async function pingGChat(
  webhookUrl: string,
  fileName: string,
  fileKey: string,
  counts: {
    names: number;
    structure: number;
    structureBreakdown?: { hidden: number; emptyContainer: number; deepNesting: number };
    responsive: number;
  },
): Promise<void> {
  const total = counts.names + counts.structure + counts.responsive;
  const b = counts.structureBreakdown;
  const structureDetail = b
    ? `${counts.structure} (${b.hidden} hidden · ${b.emptyContainer} empty · ${b.deepNesting} deep)`
    : `${counts.structure}`;
  const summaryLines = [
    `📛 Names: ${counts.names} → Handover › Names tab`,
    `🧹 Structure: ${structureDetail} → Handover › Clean tab`,
    `📐 Responsive: ${counts.responsive} → Handover › Fluid tab`,
  ];
  const summary = summaryLines.join('\n');
  const body = {
    cardsV2: [
      {
        cardId: `handover-${fileKey}`,
        card: {
          header: {
            title: `🔍 Pre-handover: ${fileName}`,
            subtitle: `${total} issue${total !== 1 ? 's' : ''} to fix before dev handover`,
          },
          sections: [
            {
              widgets: [
                { textParagraph: { text: summary.replace(/\n/g, '<br>') } },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Open in Figma',
                        onClick: { openLink: { url: figmaFileUrl(fileKey) } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
  await fetch(webhookUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Quick token validation. PATs (figd_) use /v1/me; plan tokens (figp_) use
// /v1/activity_logs (the smallest endpoint plan tokens accept).
export async function verifyToken(
  token: string,
): Promise<{ ok: boolean; kind: 'pat' | 'plan'; email?: string; error?: string }> {
  const isPlan = token.trim().startsWith('figp_');
  const kind: 'pat' | 'plan' = isPlan ? 'plan' : 'pat';

  try {
    if (isPlan) {
      // /v1/me is excluded for plan tokens. Use activity_logs as a smoke test.
      const res = await fetch(`${BASE}/activity_logs?limit=1`, {
        headers: { 'X-Figma-Token': token },
      });
      if (!res.ok) return { ok: false, kind, error: `${res.status} ${res.statusText}` };
      return { ok: true, kind };
    } else {
      const res = await fetch(`${BASE}/me`, { headers: { 'X-Figma-Token': token } });
      if (!res.ok) return { ok: false, kind, error: `${res.status} ${res.statusText}` };
      const data = await res.json();
      return { ok: true, kind, email: data.email };
    }
  } catch (err) {
    return { ok: false, kind, error: err instanceof Error ? err.message : String(err) };
  }
}
