import type { AuditResult } from '../index.ts';

const R = '\x1b[0m';   // reset
const B = '\x1b[1m';   // bold
const D = '\x1b[2m';   // dim
const RED = '\x1b[31m';
const YLW = '\x1b[33m';
const GRN = '\x1b[32m';
const CYN = '\x1b[36m';

function coloured(n: number): string {
  if (n === 0) return `${GRN}0${R}`;
  if (n < 10) return `${YLW}${n}${R}`;
  return `${RED}${n}${R}`;
}

function totalIssues(r: AuditResult): number {
  return r.names.length + r.structure.length + r.responsive.length;
}

export function reportConsole(results: AuditResult[]): void {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  console.log(`\n${B}Figma Audit${R}  ${D}${date}${R}\n`);

  if (results.length === 0) {
    console.log(`${GRN}No files to audit.${R}\n`);
    return;
  }

  // Sort worst-first.
  const sorted = [...results].sort((a, b) => totalIssues(b) - totalIssues(a));

  for (const r of sorted) {
    const total = totalIssues(r);
    const dot = total === 0 ? `${GRN}●${R}` : `${RED}●${R}`;
    console.log(`${dot} ${B}${r.fileName}${R}  ${D}figma.com/file/${r.fileKey}${R}`);
    if (total > 0) {
      console.log(`    ${CYN}names${R}      ${coloured(r.names.length)}`);
      console.log(`    ${CYN}structure${R}  ${coloured(r.structure.length)}`);
      console.log(`    ${CYN}responsive${R} ${coloured(r.responsive.length)}`);
    }
    console.log();
  }

  const totalAll = results.reduce((s, r) => s + totalIssues(r), 0);
  const clean = results.filter((r) => totalIssues(r) === 0).length;

  console.log(
    `${B}Summary${R}  ${results.length} files  ·  ${GRN}${clean} clean${R}  ·  ${RED}${totalAll} issues${R}\n`,
  );
}
