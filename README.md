# Figma Audit

Org-wide design quality pipeline for Figma Enterprise. Catches handover issues before developers hit them — auto-generated layer names, dead structure (hidden layers, empty containers, detached instances), and non-responsive frames.

Two modes:

| Mode | Trigger | Audience |
|------|---------|----------|
| **Weekly audit** | Monday 09:00 UTC cron | Design leads / DesignOps — org-wide snapshot |
| **Handover watch** | Hourly cron | Designers + leads — fires when a "Ready for Dev" file changes |

The companion **[Handover plugin](../Handover)** lets designers self-fix inside Figma. This pipeline catches what slips through and notifies the right people.

---

## What it checks

| Check | What it flags | Plugin tab |
|-------|--------------|------------|
| **Names** | Layers with Figma's auto-generated names (`Frame 1`, `Group 23`, …) where a semantic rename can be inferred | Names |
| **Structure › hidden** | Invisible layers not bound to a component boolean prop | Clean |
| **Structure › empty-container** | Frames/groups with no children and no visible fill/stroke/effect | Clean |
| **Structure › detached-instance** | INSTANCE nodes whose master component was deleted | Clean |
| **Responsive** | FRAME/COMPONENT nodes with no horizontal stretch constraint or auto-layout fill sizing | Fluid |

### Opt-out

Append `[no-audit]` to any Figma file name to skip it in both modes. Append `[archive]` to skip it in the weekly audit (files inactive >90 days are also auto-skipped).

---

## Prerequisites

- **Figma Enterprise plan** with a plan access token (`figp_…`). PATs (`figd_…`) work for single files but can't read org-wide projects.
- Node 20+
- A GitHub repo with Actions enabled

---

## Local setup

```bash
git clone <this-repo>
cd figma-audit
npm install
```

Create `.env` (gitignored — never commit this):

```env
FIGMA_TOKEN=figp_your_plan_token_here
FIGMA_ORG_ID=your_org_id
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...   # optional
FIGMA_HANDOVER_PROJECT_IDS=12345678,87654321   # for handover-watch only
```

### Discover teams and files

```bash
npm run discover
```

Paginates the last 90 days of activity logs to find every team and file your token can reach. Writes `FIGMA_TEAM_IDS` and `FIGMA_FILE_KEYS` into `.env`. Run this once before the first weekly audit (CI does it automatically).

### Run a manual audit

```bash
npm run audit
# or with explicit output formats:
npm run audit -- --output console,gchat,json --json-path results.json
```

### Run the handover watcher once

```bash
npm run handover-watch
```

---

## GitHub Actions setup

### Required secrets

Go to **Settings → Secrets → Actions** and add:

| Secret | Description |
|--------|-------------|
| `FIGMA_TOKEN` | Plan access token (`figp_…`) |
| `FIGMA_ORG_ID` | Your org ID (from `figma.com/files/team/:orgId/…`) |
| `GCHAT_WEBHOOK_URL` | Google Chat incoming webhook URL (optional) |
| `FIGMA_HANDOVER_PROJECT_IDS` | Comma-separated project IDs of your "Ready for Dev" projects |

### Workflows

| File | Schedule | What it does |
|------|----------|-------------|
| `.github/workflows/audit.yml` | Mondays 09:00 UTC | Discovers teams, audits all files, posts GChat weekly summary |
| `.github/workflows/handover-watch.yml` | Every hour at :15 | Checks handover projects for changes, posts in-Figma comments + per-screen pins |
| `.github/workflows/handover-file.yml` | On `repository_dispatch` (webhook) | Audits a single file immediately when Figma fires a FILE_UPDATE event |
| `.github/workflows/pages.yml` | On push to `main` | Builds and deploys the web UI to GitHub Pages |

You can also trigger any workflow manually from the **Actions** tab.

---

## Webhook setup (real-time, via Pipedream)

The hourly cron is enough for most teams. If you want audits to fire the moment a designer saves a file, set up the Pipedream relay — it takes about 10 minutes and requires no deployment.

### Step 1 — Create a Pipedream account
Go to [pipedream.com](https://pipedream.com) and sign up. The free tier handles this comfortably.

### Step 2 — Create a new workflow
1. Click **New Workflow**
2. Choose **HTTP / Webhook** as the trigger
3. Select **HTTP API** → copy the endpoint URL (looks like `https://eo1abc123.m.pipedream.net`)
4. Set **Response** to **Return a fixed response** → Status `200`, Body `OK`
   *(Figma needs a quick 200 — the code step runs after the response is sent)*

### Step 3 — Add the code step
1. Click **+** to add a step → choose **Run Node.js code**
2. Open `src/webhook/pipedream-workflow.js` in this repo and paste the entire contents

### Step 4 — Set environment variables in Pipedream
Go to your Pipedream project → **Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `FIGMA_WEBHOOK_PASSCODE` | Any strong random string — generate with `openssl rand -hex 32` |
| `GITHUB_TOKEN` | A GitHub fine-grained PAT with **Actions: Read & Write** on this repo |
| `GITHUB_REPO` | `yourorg/figma-audit` |

### Step 5 — Save and deploy the workflow
Click **Deploy** in Pipedream. The workflow is now live.

### Step 6 — Add to your local `.env`
```env
FIGMA_HANDOVER_TEAM_IDS=18xxxx,19xxxx     # teams whose files you want to watch
FIGMA_WEBHOOK_ENDPOINT=https://eo1abc123.m.pipedream.net
FIGMA_WEBHOOK_PASSCODE=<same string from step 4>
```

### Step 7 — Register with Figma
```bash
npm run webhook:register
```

This calls the Figma API to point FILE_UPDATE events at your Pipedream URL. Run once per team ID. To verify it worked:
```bash
npm run webhook:list
```

### How it flows after setup
```
Designer saves Figma file
  → Figma POST → Pipedream (validates passcode, ~instant)
    → GitHub repository_dispatch { file_key }
      → handover-file.yml runs for just that file
        → in-Figma comment + GChat ping (within ~60s of save)
```

The hourly cron (`handover-watch.yml`) continues running as a safety net — it catches any files that slipped through (e.g. if Pipedream was down).

---

## How the weekly cron works

```
Monday 09:00 UTC
       │
       ▼
  1. npm run discover
       │  Paginates /v1/activity_logs (last 90 days, 1 000 items/page)
       │  Collects: team IDs from log context, file keys from log entities
       │  Writes FIGMA_TEAM_IDS + FIGMA_FILE_KEYS into .env
       │
       ▼
  2. npm run audit --output console,gchat,json
       │
       ├── For each team ID:
       │     → GET /v1/teams/:id/projects → GET /v1/projects/:id/files
       │
       ├── Merge with FIGMA_FILE_KEYS (files found in logs but not in team walk)
       │
       ├── Deduplicate + exclude:
       │     • [archive] in name
       │     • [no-audit] in name
       │     • last_modified > 90 days ago
       │
       ├── For each remaining file:
       │     → GET /v1/files/:key  (full tree, no depth limit)
       │     → checkNames()  + checkStructure()  + checkResponsive()
       │
       ├── console reporter  → stdout (visible in Actions log)
       ├── json reporter     → audit-<run-id>.json (uploaded as GH artifact, 90d retention)
       └── gchat reporter    → weekly card: top 5 worst files + org totals
```

---

## How the handover watch works

```
Every hour at :15
       │
       ▼
  Load .handover-watch-state.json  (committed to repo for durability)
       │  Contains: lastCommented, pinnedComments, summaryComments per file key
       │
       ▼
  For each project in FIGMA_HANDOVER_PROJECT_IDS:
    GET /v1/projects/:id/files
       │
       ▼
    For each file:
      • [no-audit] in name → skip
      • lastModified unchanged since last comment → skip
       │
       ▼
      GET /v1/files/:key  →  run all 3 checks
       │
       ├── Resolve stale pins:
       │     Frames that had pins but are now clean
       │     → DELETE /v1/files/:key/comments/:commentId
       │
       ├── If total issues == 0:
       │     Delete old summary comment too → mark file clean in state
       │
       ├── Replace summary comment:
       │     DELETE old summary (if any) → POST new summary (un-anchored)
       │
       ├── Post new pins:
       │     Top 10 frames by issue count (skip frames already pinned)
       │     → POST /v1/files/:key/comments with client_meta.node_id = frameId
       │
       └── Ping Google Chat (if GCHAT_WEBHOOK_URL set)
       │
       ▼
  Save .handover-watch-state.json → git commit "chore: update handover watch state [skip ci]"
```

State is committed back to the repo rather than relying on GH Actions cache (which expires after 7 days). The commit message has `[skip ci]` to prevent re-triggering other workflows.

---

## Web UI

The web UI at `https://<your-org>.github.io/figma-audit/` lets designers and design leads run a one-off audit on a single project or file without needing API credentials set up locally. It accepts a Figma PAT (Personal Access Token) which stays in localStorage and is never sent to any backend — all Figma API calls are made directly from the browser.

To rebuild and redeploy: push any change to `src/checks/**`, `src/api/types.ts`, or `web/src/**` on `main`.

---

## Snapshot tests

```bash
npm test
```

Fixtures in `src/checks/__tests__/fixtures/` contain trimmed Figma document trees. Tests verify that each check returns the expected issue counts and kinds without hitting the real API.

---

## Project structure

```
src/
  api/
    client.ts          # Figma REST API client (rate-limited, retries)
    types.ts           # FigmaNode TypeScript type + Zod schema
  checks/
    names.ts           # Generic-name detection (ports plugin inferName logic)
    structure.ts       # Hidden layers, empty containers, detached instances
    responsive.ts      # Non-responsive frames
    __tests__/         # Vitest snapshot tests
  pin-comments.ts      # Group issues by frame, format pin payloads
  reporters/
    console.ts
    json.ts
    gchat.ts
  discover.ts          # Activity-log team/file discovery
  handover-watch.ts    # Hourly watcher (posts + resolves Figma comments)
  index.ts             # Weekly audit CLI
web/
  src/
    App.svelte         # One-page web UI (Svelte 5)
    lib/
      figma.ts         # Browser-side Figma client
      audit.ts         # Wraps checks for browser use
.github/
  workflows/
    audit.yml          # Weekly cron
    handover-watch.yml # Hourly watcher (commits state)
    pages.yml          # GitHub Pages deployment
```
