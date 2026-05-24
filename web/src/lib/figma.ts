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
  const res = await apiFetch(token, `/files/${key}?depth=6`);
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

// Quick token validation: fetch /v1/me (PATs only; plan tokens won't work in browser).
export async function verifyToken(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE}/me`, { headers: { 'X-Figma-Token': token } });
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    const data = await res.json();
    return { ok: true, email: data.email };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
