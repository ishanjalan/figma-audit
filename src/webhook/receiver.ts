/**
 * Cloudflare Worker — Figma webhook relay.
 *
 * Figma cannot call GitHub Actions directly (no custom auth headers).
 * This Worker sits in between:
 *   1. Figma sends FILE_UPDATE → this Worker's URL
 *   2. Worker validates the passcode Figma echoes back
 *   3. Worker forwards to GitHub repository_dispatch → triggers handover-file.yml
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler deploy src/webhook/receiver.ts --name figma-audit-relay
 *
 * Set Worker secrets (do NOT put in wrangler.toml):
 *   wrangler secret put FIGMA_WEBHOOK_PASSCODE   # any strong random string
 *   wrangler secret put GITHUB_TOKEN             # fine-grained PAT with contents:write
 *   wrangler secret put GITHUB_REPO              # e.g. "yourorg/figma-audit"
 */

export interface Env {
  FIGMA_WEBHOOK_PASSCODE: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;  // "owner/repo"
}

interface FigmaWebhookPayload {
  event_type: string;
  file_key?: string;
  file_name?: string;
  passcode?: string;
  timestamp?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Figma sends a GET to verify the endpoint is reachable on registration.
    if (request.method === 'GET') {
      return new Response('Figma audit relay — OK', { status: 200 });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload: FigmaWebhookPayload;
    try {
      payload = await request.json() as FigmaWebhookPayload;
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    // Figma echoes back the passcode we registered with — validate it.
    if (payload.passcode !== env.FIGMA_WEBHOOK_PASSCODE) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Only act on FILE_UPDATE events. Figma also sends PING on registration.
    if (payload.event_type !== 'FILE_UPDATE') {
      return new Response('Ignored', { status: 200 });
    }

    if (!payload.file_key) {
      return new Response('Missing file_key', { status: 400 });
    }

    // Trigger the handover-file workflow via GitHub repository_dispatch.
    const ghRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'figma-file-update',
          client_payload: {
            file_key: payload.file_key,
            file_name: payload.file_name ?? payload.file_key,
          },
        }),
      },
    );

    if (!ghRes.ok) {
      const body = await ghRes.text();
      console.error(`GitHub dispatch failed ${ghRes.status}: ${body}`);
      return new Response('Upstream error', { status: 502 });
    }

    return new Response('OK', { status: 200 });
  },
};
