import { parseArgs } from 'node:util';
import { getOrgTeams, getTeamProjects, getProjectFiles, getFile } from './api/client.ts';
import { checkNames } from './checks/names.ts';
import { checkStructure } from './checks/structure.ts';
import { checkResponsive } from './checks/responsive.ts';
import { reportConsole } from './reporters/console.ts';
import { reportJson } from './reporters/json.ts';
import { reportGChat } from './reporters/gchat.ts';
import type { NameIssue } from './checks/names.ts';
import type { StructureIssue } from './checks/structure.ts';
import type { ResponsiveIssue } from './checks/responsive.ts';

export interface AuditResult {
  fileKey: string;
  fileName: string;
  lastModified: string;
  names: NameIssue[];
  structure: StructureIssue[];
  responsive: ResponsiveIssue[];
}

// ── Exclusion rules ───────────────────────────────────────────────────────────

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function shouldExclude(name: string, lastModified: string): { excluded: boolean; reason?: string } {
  if (/\[archive\]/i.test(name)) return { excluded: true, reason: '[archive]' };
  if (/\[no-audit\]/i.test(name)) return { excluded: true, reason: '[no-audit]' };
  if (Date.now() - new Date(lastModified).getTime() > NINETY_DAYS_MS) {
    return { excluded: true, reason: 'inactive >90d' };
  }
  return { excluded: false };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      token:       { type: 'string' },
      org:         { type: 'string' },
      team:        { type: 'string' },
      projects:    { type: 'string' },
      output:      { type: 'string', default: 'console' },
      'json-path': { type: 'string' },
    },
  });

  const token        = values.token    ?? process.env.FIGMA_TOKEN;
  const orgId        = values.org      ?? process.env.FIGMA_ORG_ID;
  const teamFilter   = values.team     ?? process.env.FIGMA_TEAM_ID;
  const teamIds      = process.env.FIGMA_TEAM_IDS;   // comma-separated, from discover
  const fileKeys     = process.env.FIGMA_FILE_KEYS;  // comma-separated, from discover
  const projectsArg  = values.projects ?? process.env.FIGMA_PROJECT_IDS;
  const outputs      = (values.output ?? 'console').split(',').map((s) => s.trim());
  const gchatUrl     = process.env.GCHAT_WEBHOOK_URL;

  if (!token) {
    console.error('Error: FIGMA_TOKEN required (--token or env var)');
    process.exit(1);
  }
  if (!orgId && !teamFilter && !teamIds && !fileKeys && !projectsArg) {
    console.error(
      'Error: one of FIGMA_ORG_ID, FIGMA_TEAM_IDS, FIGMA_FILE_KEYS, FIGMA_TEAM_ID, or FIGMA_PROJECT_IDS required\n' +
      '  Run "npm run discover" to auto-populate FIGMA_TEAM_IDS and FIGMA_FILE_KEYS from activity logs.',
    );
    process.exit(1);
  }

  // ── Collect files ───────────────────────────────────────────────────────────

  type RawFile = { key: string; name: string; last_modified: string };
  const allFiles: RawFile[] = [];

  if (projectsArg) {
    // Direct project IDs — most reliable, bypasses team/org discovery entirely.
    const projectIds = projectsArg.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`Scanning ${projectIds.length} project${projectIds.length !== 1 ? 's' : ''}…`);
    for (const projectId of projectIds) {
      const files = await getProjectFiles(token, projectId);
      allFiles.push(...files);
    }
  } else {
    // Team-based discovery.
    const resolvedTeamIds: string[] = [];

    if (teamIds) {
      // Pre-discovered list from "npm run discover".
      resolvedTeamIds.push(...teamIds.split(',').map((s) => s.trim()).filter(Boolean));
      console.log(`Using ${resolvedTeamIds.length} pre-discovered teams…`);
    } else if (teamFilter) {
      resolvedTeamIds.push(teamFilter);
      console.log(`Scoping to team ${teamFilter}…`);
    } else {
      const teams = await getOrgTeams(token!, orgId!);
      resolvedTeamIds.push(...teams.map((t) => t.id));
      console.log(`Found ${teams.length} team${teams.length !== 1 ? 's' : ''} in org`);
    }

    for (const teamId of resolvedTeamIds) {
      try {
        const projects = await getTeamProjects(token!, teamId);
        for (const project of projects) {
          const files = await getProjectFiles(token!, project.id);
          allFiles.push(...files);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403')) {
          console.log(`  Skipping team ${teamId} — outside plan boundary`);
        } else {
          throw err;
        }
      }
    }
  }

  // Activity-log-derived file keys (safety net — catches files team-walk misses).
  // Each key is given a placeholder last_modified so it survives exclusion logic;
  // the real value is fetched per-file in the audit loop below.
  if (fileKeys) {
    const keys = fileKeys.split(',').map((s) => s.trim()).filter(Boolean);
    const teamWalkKeys = new Set(allFiles.map((f) => f.key));
    let added = 0;
    for (const key of keys) {
      if (teamWalkKeys.has(key)) continue;
      allFiles.push({ key, name: `(${key})`, last_modified: new Date().toISOString() });
      added++;
    }
    console.log(`Adding ${added} file${added !== 1 ? 's' : ''} from activity-log discovery`);
  }

  // Deduplicate (a file can appear in multiple teams if shared).
  const seen = new Set<string>();
  const uniqueFiles = allFiles.filter((f) => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });

  // Apply exclusions.
  const toAudit: RawFile[] = [];
  let excludedCount = 0;
  for (const f of uniqueFiles) {
    const { excluded } = shouldExclude(f.name, f.last_modified);
    if (excluded) {
      excludedCount++;
    } else {
      toAudit.push(f);
    }
  }

  console.log(
    `Auditing ${toAudit.length} file${toAudit.length !== 1 ? 's' : ''}` +
    (excludedCount > 0 ? ` (${excludedCount} excluded)` : '') +
    '\n',
  );

  // ── Audit ───────────────────────────────────────────────────────────────────

  const results: AuditResult[] = [];

  let skipped403 = 0;
  for (const entry of toAudit) {
    process.stdout.write(`  ${entry.name} … `);
    try {
      const file = await getFile(token, entry.key);
      const names      = checkNames(file.document);
      const structure  = checkStructure(file.document);
      const responsive = checkResponsive(file.document);
      results.push({
        fileKey: entry.key,
        fileName: file.name,
        lastModified: file.lastModified,
        names,
        structure,
        responsive,
      });
      const total = names.length + structure.length + responsive.length;
      // If we had a placeholder name (from activity-log discovery), surface the real one.
      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        process.stdout.write(`${file.name} · `);
      }
      process.stdout.write(total === 0 ? '✓\n' : `${total} issues\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('403') || msg.includes('404')) {
        skipped403++;
        process.stdout.write('outside plan / not found — skipped\n');
      } else {
        process.stdout.write(`error — ${msg.slice(0, 120)}\n`);
      }
    }
  }
  if (skipped403 > 0) {
    console.log(`\n  ${skipped403} file${skipped403 !== 1 ? 's' : ''} skipped (outside plan boundary or deleted)`);
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  if (outputs.includes('console')) reportConsole(results);
  if (outputs.includes('json'))    reportJson(results, values['json-path']);

  if (outputs.includes('gchat')) {
    if (!gchatUrl) {
      console.error('GCHAT_WEBHOOK_URL env var required for --output gchat');
    } else {
      await reportGChat(results, gchatUrl);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
