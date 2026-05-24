// Google Chat incoming webhook reporter.
// Card format: https://developers.google.com/workspace/chat/api/reference/rest/v1/cards
import type { AuditResult } from '../index.ts';

function total(r: AuditResult): number {
  return r.names.length + r.structure.length;
}

function figmaUrl(key: string): string {
  return `https://www.figma.com/file/${key}`;
}

export async function reportGChat(results: AuditResult[], webhookUrl: string): Promise<void> {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const totalFiles = results.length;
  const totalIssues = results.reduce((s, r) => s + total(r), 0);
  const cleanFiles = results.filter((r) => total(r) === 0).length;

  // Top 5 worst files, issues descending.
  const worst = [...results]
    .filter((r) => total(r) > 0)
    .sort((a, b) => total(b) - total(a))
    .slice(0, 5);

  const worstRows =
    worst.length === 0
      ? '✅  All files are clean!'
      : worst
          .map(
            (r) =>
              `<a href="${figmaUrl(r.fileKey)}">${r.fileName}</a>` +
              ` — ${total(r)} issues` +
              ` (${r.names.length} names · ${r.structure.length} structure)`,
          )
          .join('\n');

  // Google Chat card v1 format.
  const body = {
    cards: [
      {
        header: {
          title: '🎨 Figma Audit',
          subtitle: date,
          imageUrl: 'https://static.figma.com/app/icon/1/favicon.ico',
          imageStyle: 'IMAGE',
        },
        sections: [
          {
            widgets: [
              {
                columns: {
                  columnItems: [
                    {
                      horizontalSizeStyle: 'FILL_AVAILABLE_SPACE',
                      widgets: [{ keyValue: { topLabel: 'Files audited', content: String(totalFiles) } }],
                    },
                    {
                      horizontalSizeStyle: 'FILL_AVAILABLE_SPACE',
                      widgets: [{ keyValue: { topLabel: 'Total issues', content: String(totalIssues) } }],
                    },
                    {
                      horizontalSizeStyle: 'FILL_AVAILABLE_SPACE',
                      widgets: [{ keyValue: { topLabel: 'Clean', content: `${cleanFiles} / ${totalFiles}` } }],
                    },
                  ],
                },
              },
            ],
          },
          {
            header: 'Files needing attention',
            widgets: [
              {
                textParagraph: { text: worstRows },
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Google Chat webhook ${res.status}: ${await res.text()}`);
  }

  console.log('Google Chat notification sent.');
}
