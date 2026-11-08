import schema from '../schema/resume-source.v1.json' with { type: 'json' };
export type PdfBlock = { blockId: string; page: number; bbox: number[]; fontSize: number; bold: boolean; readingOrder: number; text: string };
export type ResumeSourceV1 = { version: 'resume-source-v1'; fileId: string; extractionVersion: 'pdf-layout-v1'; uploadedAt: string; expiresAt: string; pageCount: number; blocks: PdfBlock[] };
type Schema = { $ref?: string; $defs?: Record<string, Schema>; type?: string; const?: unknown; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number };
/** The checked-in Pydantic schema is also the TS boundary's structural authority. */
export function validateSchema(value: unknown, rawSchema: unknown): void {
  const root = rawSchema as Schema;
  const check = (v: unknown, s: Schema): void => {
    if (s.$ref) return check(v, root.$defs![s.$ref.split('/').pop()!]);
    const fail = () => { throw new Error('Invalid private resume contract'); };
    if ('const' in s && v !== s.const || s.enum && !s.enum.includes(v)) fail();
    if (s.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
      const obj = v as Record<string, unknown>;
      if (s.required?.some(k => !(k in obj)) || s.additionalProperties === false && Object.keys(obj).some(k => !(k in (s.properties ?? {})))) fail();
      for (const [k, child] of Object.entries(s.properties ?? {})) if (k in obj) check(obj[k], child);
    } else if (s.type === 'array') {
      if (!Array.isArray(v) || v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? Infinity)) return fail();
      for (const item of v) check(item, s.items!);
    } else if (s.type === 'string') {
      if (typeof v !== 'string' || [...v].length < (s.minLength ?? 0) || [...v].length > (s.maxLength ?? Infinity) || s.pattern && !new RegExp(s.pattern).test(v)) fail();
    } else if (s.type === 'number' || s.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v) || s.type === 'integer' && !Number.isInteger(v) || v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) fail();
    } else if (s.type === 'boolean' && typeof v !== 'boolean') fail();
  };
  check(value, root);
}
export function validateResumeSource(raw: unknown): ResumeSourceV1 {
  validateSchema(raw, schema);
  const source = raw as ResumeSourceV1;
  const dates = [source.uploadedAt, source.expiresAt].map(t => new Date(t));
  if (dates.some((d,i) => !Number.isFinite(d.getTime()) || d.toISOString().replace('.000Z', 'Z') !== [source.uploadedAt, source.expiresAt][i]) || dates[1].getTime() - dates[0].getTime() !== 30 * 86400000) throw new Error('Invalid retention dates');
  const ids = new Set<string>(), orders = new Map<number, number>();
  for (const b of source.blocks) {
    if (ids.has(b.blockId) || b.page > source.pageCount || b.readingOrder <= (orders.get(b.page) ?? -1) || b.bbox.some(n => n < 0 || n > 100000) || b.bbox[2] < b.bbox[0] || b.bbox[3] < b.bbox[1]) throw new Error('Invalid PDF layout');
    ids.add(b.blockId); orders.set(b.page, b.readingOrder);
  }
  return structuredClone(source);
}
