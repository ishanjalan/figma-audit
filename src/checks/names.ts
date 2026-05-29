// Detects two categories of layer naming issues that the Handover plugin surfaces:
//
//   1. generic-name  — Figma's auto-generated default name (e.g. "Frame 12") where
//                      a meaningful name CAN be inferred from content or context.
//   2. non-standard-case — Human-given name on a FRAME or GROUP that isn't PascalCase
//                           (e.g. "hero CTA", "redDeal", "CONTAINER"). The plugin
//                           auto-proposes a PascalCase rename for these.
//
// Skip logic mirrors the Handover plugin so the REST audit and the in-Figma
// plugin stay aligned.
import type { FigmaNode } from '../api/types.ts';

const GENERIC_NAME_RE =
  /^(Frame|Group|Rectangle|Ellipse|Vector|Polygon|Star|Line|Image|Component|Instance|Section)\s+\d+$/i;

// Tokens that should stay fully uppercase in a PascalCase identifier.
// Mirrors KNOWN_ACRONYMS in Handover plugin's names.ts.
const KNOWN_ACRONYMS = new Set([
  'CTA', 'FAQ', 'URL', 'API', 'UI', 'UX', 'ID', 'SEO', 'SLA', 'KPI',
  'B2B', 'B2C', 'QR', 'OTP', 'PIN', 'PDF', 'CSV', 'XML', 'JSON',
]);

export type NameIssueReason = 'generic-name' | 'non-standard-case';

export interface NameIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  reason: NameIssueReason;
  path: string;
  topLevelFrameId: string;
  topLevelFrameName: string;
}

function hasIntentionalMarkers(node: FigmaNode): boolean {
  if (node.reactions && node.reactions.length > 0) return true;
  if (node.exportSettings && node.exportSettings.length > 0) return true;
  if (node.annotations && node.annotations.length > 0) return true;
  return false;
}

// ── PascalCase helpers (mirrors Handover plugin names.ts) ─────────────────────

// Each path segment (before a slash) must start with an uppercase letter,
// followed by at least one lowercase character or digit (so all-caps like
// CONTAINER is rejected but acronym-prefixed like CTAButton is accepted only
// after the isPascalCase call is on the full string which the plugin handles
// differently — here we use a strict per-segment check).
function isPascalCase(name: string): boolean {
  if (!name) return false;
  // Slash paths: every segment must be PascalCase.
  return name.split('/').every((segment) => /^[A-Z]([a-z0-9][A-Za-z0-9]*)?$/.test(segment));
}

// Returns true when a name should be flagged as non-standard.
// Mirrors isNonStandardCase in Handover plugin's names.ts.
function isNonStandardCase(name: string): boolean {
  const trimmed = name.trim();
  // Too short or no letters — not worth flagging.
  if (trimmed.length <= 1) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  return !isPascalCase(trimmed);
}

// Detects whether a top-level frame has an outgoing Smart Animate prototype
// transition. Names inside such frames must not be auto-renamed because Figma
// matches layers by name across transition frames.
function hasSmartAnimateReaction(node: FigmaNode): boolean {
  if (!Array.isArray(node.reactions)) return false;
  return node.reactions.some((r: unknown) => {
    const reaction = r as { action?: { type?: string; transition?: { type?: string } | null } };
    return reaction.action?.type === 'NODE' && reaction.action?.transition?.type === 'SMART_ANIMATE';
  });
}

// ── Rename-inference (port of Handover plugin's inferName) ───────────────────
// Returns true iff the plugin would be able to propose a meaningful name.

function findFirstText(node: FigmaNode, depth: number): string | null {
  if (depth > 3) return null;
  if (node.type === 'TEXT') {
    // We don't have the actual characters in the REST tree by default, but
    // a TEXT node existing under this subtree is enough for the plugin to
    // propose a name. Treat presence as success.
    return 'text';
  }
  for (const child of node.children ?? []) {
    const t = findFirstText(child, depth + 1);
    if (t) return t;
  }
  return null;
}

function canInferName(node: FigmaNode, isTopLevel: boolean): boolean {
  // Priority 1: text descendant within 3 levels.
  if (findFirstText(node, 0)) return true;

  // Priority 2: semantic frame/component context.
  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    if (isTopLevel) return true;                        // → Screen
    if (node.layoutMode && node.layoutMode !== 'NONE') return true; // → Row/Stack/Card
    // Note: we can't reliably detect "fills parent" (Background) from the
    // REST tree without parent dimensions in scope. Skip — rare case.
    return false;
  }

  if (node.type === 'SECTION') return true;             // → Section
  if (node.type === 'LINE') return true;                // → Divider

  // VECTOR / STAR / POLYGON — the plugin classifies by geometry (Divider/Icon/
  // Shape). The audit doesn't have width/height in scope here, so be liberal
  // and assume the plugin can propose something.
  if (node.type === 'VECTOR' || node.type === 'STAR' || node.type === 'POLYGON') {
    return true;
  }

  // GROUP, RECTANGLE, ELLIPSE, IMAGE without text/layout context — the plugin
  // returns null. Leave alone.
  return false;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

interface ScanCtx {
  ancestors: string[];
  topLevelFrameId: string;
  topLevelFrameName: string;
  isTopLevel: boolean;
  // True when this subtree sits inside a top-level frame with an outgoing
  // Smart Animate transition. The plugin skips auto-renaming in that case
  // to avoid breaking prototype animations; we skip the non-standard-case
  // flag for the same reason.
  inSmartAnimateFrame: boolean;
}

// Node types the plugin treats as "never rename" — component definition,
// instance copy, text. Non-standard-case check only applies to FRAME/GROUP.
const RENAMEBLE_FOR_PASCAL = new Set(['FRAME', 'GROUP']);

// Suppress non-standard-case check for exports containing KNOWN_ACRONYMS:
// if the full name is a known acronym (e.g. "CTA"), toPascal leaves it
// unchanged and the plugin would not propose a rename.
function isKnownAcronymOnly(name: string): boolean {
  return KNOWN_ACRONYMS.has(name.trim().toUpperCase());
}

function scanNode(node: FigmaNode, ctx: ScanCtx, issues: NameIssue[]): void {
  if (node.locked) return;
  if (hasIntentionalMarkers(node)) return;

  const path = ctx.ancestors.join(' › ');

  // ── Generic-name check ───────────────────────────────────────────────────
  if (GENERIC_NAME_RE.test(node.name.trim()) && canInferName(node, ctx.isTopLevel)) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      reason: 'generic-name',
      path,
      topLevelFrameId: ctx.topLevelFrameId,
      topLevelFrameName: ctx.topLevelFrameName,
    });
  }

  // ── Non-standard-case check ──────────────────────────────────────────────
  // Only for FRAME/GROUP with a human-given name (not matching GENERIC_NAME_RE),
  // not inside a Smart Animate frame, not a known acronym used as the sole name.
  else if (
    RENAMEBLE_FOR_PASCAL.has(node.type) &&
    !ctx.inSmartAnimateFrame &&
    !isKnownAcronymOnly(node.name) &&
    isNonStandardCase(node.name.trim())
  ) {
    issues.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      reason: 'non-standard-case',
      path,
      topLevelFrameId: ctx.topLevelFrameId,
      topLevelFrameName: ctx.topLevelFrameName,
    });
  }

  // Mirror plugin behaviour: don't recurse into instance or boolean-op internals.
  if (node.type === 'INSTANCE' || node.type === 'BOOLEAN_OPERATION') return;

  for (const child of node.children ?? []) {
    scanNode(
      child,
      {
        ...ctx,
        ancestors: [...ctx.ancestors, node.name],
        isTopLevel: false,
      },
      issues,
    );
  }
}

export function checkNames(document: FigmaNode): NameIssue[] {
  const issues: NameIssue[] = [];
  for (const page of document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type === 'SECTION') {
        // Sections are screen-grouping containers — skip the section itself and
        // treat each child frame as a top-level screen for pinning purposes.
        for (const child of node.children ?? []) {
          scanNode(
            child,
            {
              ancestors: [page.name, node.name],
              topLevelFrameId: child.id,
              topLevelFrameName: child.name,
              isTopLevel: true,
              inSmartAnimateFrame: hasSmartAnimateReaction(child),
            },
            issues,
          );
        }
      } else {
        scanNode(
          node,
          {
            ancestors: [page.name],
            topLevelFrameId: node.id,
            topLevelFrameName: node.name,
            isTopLevel: true,
            inSmartAnimateFrame: hasSmartAnimateReaction(node),
          },
          issues,
        );
      }
    }
  }
  return issues;
}
