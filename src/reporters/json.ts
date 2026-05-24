import { writeFileSync } from 'node:fs';
import type { AuditResult } from '../index.ts';

export function reportJson(results: AuditResult[], outputPath?: string): void {
  const date = new Date().toISOString().split('T')[0];
  const path = outputPath ?? `audit-${date}.json`;

  const payload = {
    generatedAt: new Date().toISOString(),
    fileCount: results.length,
    totalIssues: results.reduce(
      (s, r) => s + r.names.length + r.structure.length + r.responsive.length,
      0,
    ),
    results,
  };

  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`JSON report → ${path}`);
}
