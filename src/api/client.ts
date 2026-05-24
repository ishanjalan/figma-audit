import {
  FileResponseSchema,
  OrgTeamsSchema,
  ProjectFilesSchema,
  TeamProjectsSchema,
} from './types.ts';
import type { FigmaNode, ProjectFile } from './types.ts';

const BASE = 'https://api.figma.com/v1';

// Stay safely under the 60 req/min rate limit.
const MIN_REQUEST_GAP_MS = 1100;
let lastRequestAt = 0;

async function apiFetch(url: string, token: string): Promise<unknown> {
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });

  if (res.status === 429) {
    // Back off and retry once on rate-limit.
    const retryAfter = Number(res.headers.get('Retry-After') ?? 10) * 1000;
    await sleep(retryAfter);
    return apiFetch(url, token);
  }

  if (!res.ok) {
    throw new Error(`Figma API ${res.status} — ${url}\n${await res.text()}`);
  }

  return res.json();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export async function getOrgTeams(token: string, orgId: string) {
  const raw = await apiFetch(`${BASE}/organizations/${orgId}/teams`, token);
  return OrgTeamsSchema.parse(raw).teams;
}

export async function getTeamProjects(token: string, teamId: string) {
  const raw = await apiFetch(`${BASE}/teams/${teamId}/projects`, token);
  return TeamProjectsSchema.parse(raw).projects;
}

export async function getProjectFiles(token: string, projectId: string): Promise<ProjectFile[]> {
  const raw = await apiFetch(`${BASE}/projects/${projectId}/files`, token);
  return ProjectFilesSchema.parse(raw).files;
}

// ── File versions ─────────────────────────────────────────────────────────────

export interface FileEditor {
  handle: string;   // display name, e.g. "Ishan Jalan"
  imgUrl: string;
}

/**
 * Returns the display name of the person who most recently saved the file.
 * Uses GET /v1/files/:key/versions — returns null if the call fails or the
 * version list is empty (plan tokens may not have version access).
 */
export async function getLastEditor(token: string, key: string): Promise<FileEditor | null> {
  try {
    const raw = await apiFetch(`${BASE}/files/${key}/versions`, token) as {
      versions?: Array<{ user?: { handle?: string; img_url?: string } }>;
    };
    const user = raw?.versions?.[0]?.user;
    if (!user?.handle) return null;
    return { handle: user.handle, imgUrl: user.img_url ?? '' };
  } catch {
    return null; // non-fatal — GChat ping continues without editor info
  }
}

// ── File content ──────────────────────────────────────────────────────────────

export interface FileContent {
  key: string;
  name: string;
  lastModified: string;
  document: FigmaNode;
}

export async function getFile(token: string, key: string): Promise<FileContent> {
  // No depth limit — at depth=N, containers at the boundary come back with
  // their children array omitted, which our empty-container check then
  // wrongly flags. Fetch the full tree so the audit matches what the
  // Handover plugin sees in the Figma sandbox.
  const raw = await apiFetch(`${BASE}/files/${key}`, token);
  const parsed = FileResponseSchema.parse(raw);
  return {
    key,
    name: parsed.name,
    lastModified: parsed.lastModified,
    document: parsed.document,
  };
}
