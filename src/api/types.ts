import { z } from 'zod';

// ── Figma node (recursive) ────────────────────────────────────────────────────
// We define the TypeScript type first, then the Zod schema separately using
// z.lazy() to handle the recursive children field without circular type errors.

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  fills?: Array<{ type: string; visible?: boolean; opacity?: number }>;
  strokes?: Array<{ type: string; visible?: boolean }>;
  strokeWeight?: number;
  effects?: Array<{ type: string; visible?: boolean }>;
  layoutMode?: string;  // 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | future values
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutPositioning?: string;  // 'AUTO' | 'ABSOLUTE'
  constraints?: { horizontal: string; vertical: string };
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;

  // Visual identity — used to detect chrome-less passthrough/wrapper/redundant frames.
  blendMode?: string;
  clipsContent?: boolean;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  rotation?: number;
  cornerRadius?: number;

  // Group / mask status.
  isMask?: boolean;

  // Skip-signals — when present, the node is intentional and must not be flagged.
  // Mirrors the Handover plugin's scanner guards so audit & plugin stay aligned.
  reactions?: unknown[];                                // prototype interactions
  exportSettings?: unknown[];                           // configured for export
  annotations?: unknown[];                              // design spec markers
  componentPropertyReferences?: Record<string, string>; // ".visible" → bound to component bool

  // Instance tracking — populated on INSTANCE type nodes.
  // When the master component is deleted, componentId is absent/null,
  // making this a detached (orphaned) instance.
  componentId?: string | null;
}

const FigmaFillSchema = z.object({
  type: z.string(),
  visible: z.boolean().optional(),
  opacity: z.number().optional(),
});

const FigmaEffectSchema = z.object({
  type: z.string(),
  visible: z.boolean().optional(),
});

export const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: z.number().optional(),
    children: z.array(FigmaNodeSchema).optional(),
    fills: z.array(FigmaFillSchema).optional(),
    strokes: z.array(z.object({ type: z.string(), visible: z.boolean().optional() })).optional(),
    strokeWeight: z.number().optional(),
    effects: z.array(FigmaEffectSchema).optional(),
    layoutMode: z.string().optional(),  // permissive; Figma keeps adding values (GRID etc.)
    layoutSizingHorizontal: z.string().optional(),
    layoutSizingVertical: z.string().optional(),
    layoutPositioning: z.string().optional(),
    constraints: z
      .object({ horizontal: z.string(), vertical: z.string() })
      .optional(),
    absoluteBoundingBox: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .nullish(),
    blendMode: z.string().optional(),
    clipsContent: z.boolean().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    rotation: z.number().optional(),
    cornerRadius: z.number().optional(),
    isMask: z.boolean().optional(),
    reactions: z.array(z.unknown()).optional(),
    exportSettings: z.array(z.unknown()).optional(),
    annotations: z.array(z.unknown()).optional(),
    componentPropertyReferences: z.record(z.string()).optional(),
    componentId: z.string().nullish(),
  })
);

// ── API response schemas ──────────────────────────────────────────────────────

export const FileResponseSchema = z.object({
  name: z.string(),
  lastModified: z.string(),
  document: FigmaNodeSchema,
});

export const ProjectFilesSchema = z.object({
  files: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      last_modified: z.string(),
      thumbnail_url: z.string().nullish(),
    })
  ),
});

export const TeamProjectsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

export const OrgTeamsSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

export type ProjectFile = z.infer<typeof ProjectFilesSchema>['files'][number];
