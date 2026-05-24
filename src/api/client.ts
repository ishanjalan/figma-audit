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

// ── File content ──────────────────────────────────────────────────────────────

export interface FileContent {
  key: string;
  name: string;
  lastModified: string;
  document: FigmaNode;
}

export async function getFile(token: string, key: string): Promise<FileContent> {
  // depth=6 gives us enough tree coverage without fetching the entire file.
  const raw = await apiFetch(`${BASE}/files/${key}?depth=6`, token);
  const parsed = FileResponseSchema.parse(raw);
  return {
    key,
    name: parsed.name,
    lastModified: parsed.lastModified,
    document: parsed.document,
  };
}
