<script lang="ts">
  import { onMount } from 'svelte';
  import { getProjectFiles, getFile, postComment, verifyToken, type ProjectFile } from './lib/figma.ts';
  import { auditDocument, formatComment, type AuditCounts } from './lib/audit.ts';

  // ── State ─────────────────────────────────────────────────────────────────
  let token = $state('');
  let projectId = $state('');
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
  });

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
    const id = projectId.trim();
    if (!id || tokenStatus !== 'valid') return;

    localStorage.setItem('figma-last-project', id);

    phase = 'running';
    rows = [];
    log = [];

    let files: ProjectFile[];
    try {
      log = [...log, `Loading project ${id}…`];
      files = await getProjectFiles(token.trim(), id);
      log = [...log, `Found ${files.length} file${files.length !== 1 ? 's' : ''}.`];
    } catch (err) {
      log = [...log, `❌ Failed to load project: ${err instanceof Error ? err.message : String(err)}`];
      phase = 'done';
      return;
    }

    rows = files.map((f) => ({ key: f.key, name: f.name, status: 'queued' }));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        rows[i] = { ...row, status: 'fetching' };
        const file = await getFile(token.trim(), row.key);

        rows[i] = { ...row, status: 'auditing', name: file.name };
        const counts = auditDocument(file.document);

        if (counts.total === 0) {
          rows[i] = { ...rows[i], status: 'clean', counts };
        } else if (postComments) {
          await postComment(token.trim(), row.key, formatComment(counts));
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

      <label class="checkbox">
        <input type="checkbox" bind:checked={postComments} disabled={tokenStatus !== 'valid'} />
        Post comments on files with issues (uncheck to dry-run)
      </label>
    </section>

    <button onclick={run} disabled={tokenStatus !== 'valid' || !projectId.trim()}>
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
