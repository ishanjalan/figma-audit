<script lang="ts">
  import { onMount } from 'svelte';
  import { getProjectFiles, getFile, postComment, pingGChat, verifyToken, type ProjectFile } from './lib/figma.ts';
  import { auditDocument, formatComment, type AuditCounts } from './lib/audit.ts';
  import { groupByFrame, buildPinComments } from '../../src/pin-comments.ts';

  // ── State ─────────────────────────────────────────────────────────────────
  let token = $state('');
  let scope = $state<'project' | 'file'>('project');
  let projectId = $state('');
  let fileInput = $state(''); // accepts URL or raw key
  let gchatWebhook = $state('');
  let tokenStatus = $state<'unknown' | 'verifying' | 'valid' | 'invalid'>('unknown');
  let tokenKind = $state<'pat' | 'plan'>('pat');
  let tokenEmail = $state('');
  let tokenError = $state('');
  let postComments = $state(true);
  let phase = $state<'setup' | 'running' | 'done'>('setup');

  type FileStatus = 'queued' | 'fetching' | 'auditing' | 'clean' | 'commented' | 'skipped' | 'error';
  interface Row {
    key: string;
    name: string;
    status: FileStatus;
    counts?: AuditCounts;
    error?: string;
  }
  let rows = $state<Row[]>([]);
  let log = $state<string[]>([]);

  // ── Local storage for token + last project ID ─────────────────────────────
  onMount(() => {
    const saved = localStorage.getItem('figma-token');
    if (saved) {
      token = saved;
      void verify();
    }
    const lastProject = localStorage.getItem('figma-last-project');
    if (lastProject) projectId = lastProject;
    const lastFile = localStorage.getItem('figma-last-file');
    if (lastFile) fileInput = lastFile;
    const lastScope = localStorage.getItem('figma-last-scope');
    if (lastScope === 'file' || lastScope === 'project') scope = lastScope;
    const savedWebhook = localStorage.getItem('gchat-webhook');
    if (savedWebhook) gchatWebhook = savedWebhook;
  });

  // Extract a file key from a Figma URL or return the raw input.
  // Accepts: figma.com/file/KEY/..., figma.com/design/KEY/..., or just KEY.
  function parseFileKey(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    if (match) return match[1];
    // Raw key — Figma keys are alphanumeric, typically 22 chars.
    if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
    return null;
  }

  async function verify() {
    if (!token.trim()) return;
    tokenStatus = 'verifying';
    const result = await verifyToken(token.trim());
    tokenKind = result.kind;
    if (result.ok) {
      tokenStatus = 'valid';
      tokenEmail = result.email ?? '';
      localStorage.setItem('figma-token', token.trim());
    } else {
      tokenStatus = 'invalid';
      tokenError = result.error ?? 'Unknown error';
    }
  }

  function clearToken() {
    token = '';
    tokenStatus = 'unknown';
    tokenEmail = '';
    localStorage.removeItem('figma-token');
  }

  // ── Run scan ──────────────────────────────────────────────────────────────
  async function run() {
    if (tokenStatus !== 'valid') return;

    localStorage.setItem('figma-last-scope', scope);
    if (gchatWebhook.trim()) localStorage.setItem('gchat-webhook', gchatWebhook.trim());
    else localStorage.removeItem('gchat-webhook');

    phase = 'running';
    rows = [];
    log = [];

    let files: ProjectFile[];

    if (scope === 'project') {
      const id = projectId.trim();
      if (!id) { phase = 'setup'; return; }
      localStorage.setItem('figma-last-project', id);

      try {
        log = [...log, `Loading project ${id}…`];
        files = await getProjectFiles(token.trim(), id);
        log = [...log, `Found ${files.length} file${files.length !== 1 ? 's' : ''}.`];
      } catch (err) {
        log = [...log, `❌ Failed to load project: ${err instanceof Error ? err.message : String(err)}`];
        phase = 'done';
        return;
      }
    } else {
      const key = parseFileKey(fileInput);
      if (!key) {
        log = [...log, '❌ Couldn\'t parse a file key from the input. Paste a Figma file URL or its key.'];
        phase = 'done';
        return;
      }
      localStorage.setItem('figma-last-file', fileInput.trim());
      log = [...log, `Auditing single file ${key}…`];
      // Placeholder — name resolves from the getFile response in the loop below.
      files = [{ key, name: `(${key})`, last_modified: new Date().toISOString() }];
    }

    rows = files.map((f) => ({ key: f.key, name: f.name, status: 'queued' }));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        rows[i] = { ...row, status: 'fetching' };
        const file = await getFile(token.trim(), row.key);

        rows[i] = { ...row, status: 'auditing', name: file.name };
        const result = auditDocument(file.document);
        const counts = result.counts;

        if (counts.total === 0) {
          rows[i] = { ...rows[i], status: 'clean', counts };
        } else if (postComments) {
          // 1. File-level summary comment (un-anchored).
          await postComment(token.trim(), row.key, formatComment(counts));

          // 2. Per-screen pin comments — top 10 most-affected top-level frames.
          const pins = buildPinComments(
            groupByFrame(result.nameIssues, result.structureIssues, 10),
          );
          for (const pin of pins) {
            try {
              await postComment(token.trim(), row.key, pin.message, pin.clientMeta);
            } catch {
              // Pin may fail if node was deleted; keep going with the rest.
            }
          }

          // Fire-and-forget GChat ping (CORS-opaque, so we can't confirm).
          if (gchatWebhook.trim()) {
            try {
              await pingGChat(gchatWebhook.trim(), file.name, row.key, counts);
            } catch {
              // no-cors response is unreadable; only network errors land here
            }
          }
          rows[i] = { ...rows[i], status: 'commented', counts };
        } else {
          rows[i] = { ...rows[i], status: 'skipped', counts };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rows[i] = { ...row, status: 'error', error: msg };
      }
    }

    phase = 'done';
  }

  function reset() {
    phase = 'setup';
    rows = [];
    log = [];
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stats = $derived.by(() => {
    const total = rows.length;
    const clean = rows.filter((r) => r.status === 'clean').length;
    const commented = rows.filter((r) => r.status === 'commented').length;
    const skipped = rows.filter((r) => r.status === 'skipped').length;
    const errored = rows.filter((r) => r.status === 'error').length;
    const done = clean + commented + skipped + errored;
    return { total, clean, commented, skipped, errored, done };
  });

  function statusIcon(status: FileStatus): string {
    switch (status) {
      case 'queued':    return '·';
      case 'fetching':  return '↓';
      case 'auditing':  return '⟳';
      case 'clean':     return '✓';
      case 'commented': return '💬';
      case 'skipped':   return '–';
      case 'error':     return '⚠';
    }
  }

  function statusColor(status: FileStatus): string {
    switch (status) {
      case 'clean':     return 'var(--success)';
      case 'commented': return 'var(--accent)';
      case 'error':     return 'var(--danger)';
      case 'skipped':   return 'var(--text-muted)';
      default:          return 'var(--text-muted)';
    }
  }
</script>

<main>
  <header>
    <h1>Figma Handover Watch</h1>
    <p class="subtitle">Audit every file in a Figma project. Post results as comments on the files that need fixes.</p>
  </header>

  {#if phase === 'setup'}
    <section class="card">
      <label for="token">Figma personal access token</label>
      {#if tokenStatus === 'valid'}
        <div class="token-valid">
          <span class="dot success"></span>
          {#if tokenKind === 'plan'}
            Plan access token authenticated (org-wide access)
          {:else}
            Authenticated as <strong>{tokenEmail}</strong>
          {/if}
          <button class="secondary small" onclick={clearToken}>Change</button>
        </div>
      {:else}
        <input
          id="token"
          type="password"
          bind:value={token}
          placeholder="figd_... or figp_..."
          onblur={verify}
        />
        <p class="hint">
          Accepts personal access tokens (<code>figd_</code>) and plan access tokens (<code>figp_</code>).
          Create at <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noopener">figma.com/developers</a>
          — scopes: <code>file_content:read</code>, <code>file_comments:write</code>. Stored only in this browser.
        </p>
        {#if tokenStatus === 'verifying'}<p class="hint">Verifying…</p>{/if}
        {#if tokenStatus === 'invalid'}<p class="hint error">Couldn't verify: {tokenError}</p>{/if}
      {/if}
    </section>

    <section class="card">
      <div class="scope-tabs">
        <button
          type="button"
          class="tab"
          class:active={scope === 'project'}
          onclick={() => (scope = 'project')}
          disabled={tokenStatus !== 'valid'}
        >Whole project</button>
        <button
          type="button"
          class="tab"
          class:active={scope === 'file'}
          onclick={() => (scope = 'file')}
          disabled={tokenStatus !== 'valid'}
        >Single file</button>
      </div>

      {#if scope === 'project'}
        <label for="project">Project ID</label>
        <input
          id="project"
          type="text"
          bind:value={projectId}
          placeholder="e.g. 12345678"
          disabled={tokenStatus !== 'valid'}
        />
        <p class="hint">
          Open the project in Figma. The ID is in the URL:
          <code>figma.com/files/project/<strong>12345678</strong>/...</code>
        </p>
      {:else}
        <label for="file">Figma file URL or key</label>
        <input
          id="file"
          type="text"
          bind:value={fileInput}
          placeholder="https://www.figma.com/design/ABC123/... or just ABC123"
          disabled={tokenStatus !== 'valid'}
        />
        <p class="hint">
          Paste the full Figma URL or just the file key. Audits one file only.
        </p>
      {/if}

      <label class="checkbox">
        <input type="checkbox" bind:checked={postComments} disabled={tokenStatus !== 'valid'} />
        Post comments on files with issues (uncheck to dry-run)
      </label>
    </section>

    <section class="card">
      <label for="gchat">Google Chat webhook (optional)</label>
      <input
        id="gchat"
        type="text"
        bind:value={gchatWebhook}
        placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=..."
        disabled={tokenStatus !== 'valid'}
      />
      <p class="hint">
        If set, each commented file also pings this Chat space with a link back to the file.
        Figma's own notifications only reach file watchers — this ensures the designer actually sees it.
        Create an incoming webhook in your Chat space → Apps &amp; integrations → Webhooks.
      </p>
    </section>

    <button
      onclick={run}
      disabled={tokenStatus !== 'valid' || (scope === 'project' ? !projectId.trim() : !fileInput.trim())}
    >
      {postComments ? 'Scan & comment' : 'Scan (dry run)'}
    </button>
  {/if}

  {#if phase === 'running' || phase === 'done'}
    <section class="card">
      <div class="stats">
        <div><strong>{stats.done}</strong> / {stats.total} files</div>
        <div class="stat-clean">{stats.clean} clean</div>
        <div class="stat-commented">{stats.commented} commented</div>
        {#if stats.skipped > 0}<div>{stats.skipped} dry-run</div>{/if}
        {#if stats.errored > 0}<div class="stat-error">{stats.errored} errors</div>{/if}
      </div>
      <progress value={stats.done} max={stats.total}></progress>
    </section>

    <section class="card no-pad">
      <table>
        <tbody>
          {#each rows as row (row.key)}
            <tr>
              <td class="icon" style="color: {statusColor(row.status)}">{statusIcon(row.status)}</td>
              <td class="name">{row.name}</td>
              <td class="meta">
                {#if row.status === 'clean'}clean
                {:else if row.status === 'commented' && row.counts}{row.counts.total} issues · commented
                {:else if row.status === 'skipped' && row.counts}{row.counts.total} issues · dry-run
                {:else if row.status === 'error'}<span class="error" title={row.error}>error</span>
                {:else}{row.status}{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    {#if log.length > 0}
      <section class="card log">
        {#each log as line}<div>{line}</div>{/each}
      </section>
    {/if}

    {#if phase === 'done'}
      <button class="secondary" onclick={reset}>Scan another project</button>
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }

  header {
    margin-bottom: 32px;
  }
  header h1 {
    font-size: 24px;
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .subtitle {
    color: var(--text-muted);
    margin: 0;
    font-size: 14px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    margin-bottom: 16px;
  }
  .card.no-pad { padding: 0; overflow: hidden; }
  .card.log {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.6;
    background: #fafafa;
  }

  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }
  .hint.error { color: var(--danger); }
  .hint code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .hint a { color: var(--accent); }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    margin-bottom: 0;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  .checkbox input { margin: 0; }

  .scope-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    padding: 4px;
    background: var(--bg);
    border-radius: var(--radius);
    width: fit-content;
  }
  .tab {
    background: transparent;
    color: var(--text-muted);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
  }
  .tab:hover:not(:disabled):not(.active) {
    background: rgba(0, 0, 0, 0.04);
    color: var(--text);
  }
  .tab.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .tab:disabled { opacity: 0.5; }

  .token-valid {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.success { background: var(--success); }
  .small { padding: 4px 10px; font-size: 12px; margin-left: auto; }

  button:not(.secondary):not(.small) {
    display: block;
    width: 100%;
    padding: 14px 20px;
    font-size: 15px;
  }

  .stats {
    display: flex;
    gap: 16px;
    font-size: 13px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .stats div { color: var(--text-muted); }
  .stat-clean { color: var(--success) !important; }
  .stat-commented { color: var(--accent) !important; }
  .stat-error { color: var(--danger) !important; }
  progress {
    width: 100%;
    height: 6px;
    appearance: none;
    border: none;
  }
  progress::-webkit-progress-bar { background: var(--border); border-radius: 3px; }
  progress::-webkit-progress-value { background: var(--accent); border-radius: 3px; transition: width 200ms; }

  table { width: 100%; border-collapse: collapse; }
  tr { border-bottom: 1px solid var(--border); }
  tr:last-child { border-bottom: none; }
  td { padding: 10px 16px; font-size: 13px; }
  td.icon { width: 28px; text-align: center; font-size: 14px; }
  td.name { color: var(--text); }
  td.meta { color: var(--text-muted); text-align: right; white-space: nowrap; }
  td .error { color: var(--danger); cursor: help; }
</style>
