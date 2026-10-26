import 'server-only';
import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';

export type RepairResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Issue = z.core.$ZodIssue;

/** Extra shape-fixing passes after the first parse (drop stray keys, null missing fields, numeric strings). */
const MAX_FIX_PASSES = 2;

/** Pulls the JSON object out of model text: drops `<think>` blocks, code fences and surrounding prose. */
export function extractJsonText(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = /```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/.exec(t);
  if (fenced?.[1]?.includes('{')) t = fenced[1].trim();
  const start = t.indexOf('{');
  if (start === -1) return t;
  const end = t.lastIndexOf('}');
  return end > start ? t.slice(start, end + 1) : t.slice(start);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node = root;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === 'number') node = node[key];
    else if (isRecord(node) && typeof key === 'string') node = node[key];
    else return undefined;
  }
  return node;
}

/** Applies the safe fixes zod issues point at; returns true when anything changed. */
function fixShape(root: unknown, issues: readonly Issue[]): boolean {
  let changed = false;
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      const target = getAt(root, issue.path);
      if (!isRecord(target)) continue;
      for (const key of issue.keys) {
        if (key in target) {
          delete target[key];
          changed = true;
        }
      }
    } else if (issue.code === 'invalid_type' && issue.path.length > 0) {
      const parent = getAt(root, issue.path.slice(0, -1));
      const key = issue.path[issue.path.length - 1];
      if (!isRecord(parent) || typeof key !== 'string') continue;
      const value = parent[key];
      if (!(key in parent)) {
        // A missing key becomes null; the next parse tells whether that field is nullable.
        parent[key] = null;
        changed = true;
      } else if (issue.expected === 'number' && typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) {
        // "2000" instead of 2000 is a common slip of models without constrained decoding.
        parent[key] = Number(value);
        changed = true;
      }
    }
  }
  return changed;
}

function describeIssues(issues: readonly Issue[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ')
    .slice(0, 240);
}

function parseWithFixes<S extends z.ZodType>(value: unknown, schema: S): RepairResult<z.output<S>> {
  for (let pass = 0; ; pass++) {
    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, data: parsed.data };
    if (pass >= MAX_FIX_PASSES || !fixShape(value, parsed.error.issues)) return { ok: false, error: describeIssues(parsed.error.issues) };
  }
}

/**
 * Local repair for output the SDK could not parse (NoObjectGeneratedError): strip fences and prose,
 * `jsonrepair`, then `schema.safeParse`, dropping stray keys and nulling missing fields when that is
 * all that stands between the output and the schema. Also unwraps a single-key envelope
 * (`{"plan": {...}}`).
 */
export function repairJson<S extends z.ZodType>(text: string | undefined, schema: S): RepairResult<z.output<S>> {
  if (!text?.trim()) return { ok: false, error: 'empty output' };
  let value: unknown;
  try {
    value = JSON.parse(jsonrepair(extractJsonText(text)));
  } catch {
    return { ok: false, error: 'output is not repairable JSON' };
  }
  const envelope = isRecord(value) && Object.keys(value).length === 1 ? Object.values(value)[0] : undefined;
  const inner = isRecord(envelope) ? structuredClone(envelope) : undefined;
  const direct = parseWithFixes(value, schema);
  if (direct.ok || !inner) return direct;
  const unwrapped = parseWithFixes(inner, schema);
  return unwrapped.ok ? unwrapped : direct;
}
