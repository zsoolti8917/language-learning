import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENDPOINT_COUNT } from './endpoints';
import { buildOpenApi, renderOpenApi } from './openapi';

type Obj = Record<string, unknown>;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Structural checks of the OpenAPI 3.1 rules this document relies on. Returns the problems. */
function validate(doc: Obj): string[] {
  const problems: string[] = [];
  const fail = (m: string) => problems.push(m);
  if (doc.openapi !== '3.1.0') fail('openapi must be 3.1.0');
  const info = doc.info as Obj | undefined;
  if (typeof info?.title !== 'string' || typeof info.version !== 'string')
    fail('info needs title and version');
  const schemas = ((doc.components as Obj)?.schemas ?? {}) as Obj;
  const schemes = ((doc.components as Obj)?.securitySchemes ?? {}) as Obj;

  // Every $ref resolves inside the document.
  const visit = (v: unknown, at: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) visit(x, `${at}[${i}]`);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === '$ref') {
          const m = /^#\/components\/schemas\/(.+)$/.exec(String(x));
          if (!m?.[1] || !(m[1] in schemas)) fail(`${at}: unresolved $ref ${String(x)}`);
        } else if (k === '$schema' || k === '$id') {
          fail(`${at}: ${k} must not appear in a component`);
        } else visit(x, `${at}.${k}`);
      }
    }
  };
  visit(doc, '#');

  for (const req of (doc.security ?? []) as Obj[])
    for (const name of Object.keys(req)) if (!(name in schemes)) fail(`unknown security ${name}`);

  const opIds = new Set<string>();
  for (const [path, item] of Object.entries((doc.paths ?? {}) as Obj)) {
    if (!path.startsWith('/')) fail(`${path}: must start with /`);
    const templ = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const [method, op] of Object.entries(item as Obj)) {
      if (!METHODS.includes(method)) fail(`${path}: unknown method ${method}`);
      const o = op as Obj;
      const id = String(o.operationId);
      if (opIds.has(id)) fail(`duplicate operationId ${id}`);
      opIds.add(id);
      const params = (o.parameters ?? []) as Obj[];
      const pathParams = params.filter((p) => p.in === 'path');
      for (const p of params) {
        if (
          typeof p.name !== 'string' ||
          !['path', 'query', 'header', 'cookie'].includes(String(p.in))
        )
          fail(`${id}: bad parameter`);
        if (!p.schema) fail(`${id}: parameter ${String(p.name)} needs a schema`);
      }
      for (const p of pathParams) if (p.required !== true) fail(`${id}: path params are required`);
      expect(pathParams.map((p) => p.name).sort(), id).toEqual([...templ].sort());
      const responses = o.responses as Obj | undefined;
      if (!responses || Object.keys(responses).length === 0) fail(`${id}: no responses`);
      for (const [code, r] of Object.entries(responses ?? {})) {
        if (!/^(?:[1-5](?:\d\d|XX)|default)$/.test(code)) fail(`${id}: bad status ${code}`);
        if (typeof (r as Obj).description !== 'string') fail(`${id} ${code}: needs a description`);
      }
      if (o.requestBody && !(o.requestBody as Obj).content) fail(`${id}: body without content`);
    }
  }
  return problems;
}

describe('openapi', () => {
  const doc = buildOpenApi();

  it('is a valid OpenAPI 3.1 document', () => {
    expect(validate(doc)).toEqual([]);
  });

  it('has one operation per endpoint', () => {
    let n = 0;
    for (const item of Object.values(doc.paths as Obj)) n += Object.keys(item as Obj).length;
    expect(n).toBe(ENDPOINT_COUNT);
  });

  it('round trips through JSON', () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('streams only the tutor message endpoint', () => {
    const op = ((doc.paths as Obj)['/tutor/conversations/{id}/messages'] as Obj).post as Obj;
    const ok = (op.responses as Obj)['200'] as Obj;
    expect(Object.keys(ok.content as Obj)).toEqual(['text/event-stream']);
  });

  it('matches the committed docs/openapi.json (run `pnpm openapi` after a change)', () => {
    const file = readFileSync(new URL('../../../docs/openapi.json', import.meta.url), 'utf8');
    expect(file).toBe(renderOpenApi());
  });

  it('catches a broken reference', () => {
    const broken = structuredClone(doc) as Obj;
    ((broken.components as Obj).schemas as Obj).Note = { $ref: '#/components/schemas/Nope' };
    expect(validate(broken).some((p) => p.includes('unresolved'))).toBe(true);
  });
});
