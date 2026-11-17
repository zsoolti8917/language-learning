import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema } from './common';
import { API_MODULES, buildPath, ENDPOINT_COUNT, endpointList, endpoints } from './endpoints';
import { ERROR_STATUS } from './enums';
import { examples } from './fixtures';

const exampleTable = examples as Record<
  string,
  {
    ok: {
      request: { params?: unknown; query?: unknown; body?: unknown };
      response: { status: number; body?: unknown };
      stream?: unknown[];
    }[];
    errors?: { request: unknown; response: { status: number; body: unknown } }[];
  }
>;

describe('endpoint table', () => {
  it('has 45 endpoints', () => {
    expect(ENDPOINT_COUNT).toBe(45);
    expect(endpointList).toHaveLength(ENDPOINT_COUNT);
    expect(Object.keys(endpoints)).toHaveLength(ENDPOINT_COUNT);
  });

  it('has unique names and unique method and path pairs', () => {
    const names = new Set(endpointList.map((e) => e.name));
    const routes = new Set(endpointList.map((e) => `${e.method} ${e.path}`));
    expect(names.size).toBe(endpointList.length);
    expect(routes.size).toBe(endpointList.length);
  });

  it('spreads the endpoints over the nine modules as docs/contracts.md does', () => {
    const per = Object.fromEntries(API_MODULES.map((m) => [m, 0]));
    for (const e of endpointList) per[e.module] = (per[e.module] ?? 0) + 1;
    expect(per).toEqual({
      system: 1,
      profile: 6,
      review: 7,
      words: 5,
      placement: 3,
      reader: 8,
      declension: 6,
      tutor: 8,
      reports: 1,
    });
  });

  it('names every path parameter in its params schema, and nothing else', () => {
    for (const e of endpointList) {
      const inPath = [...e.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort();
      const inSchema = e.params ? Object.keys(e.params.shape).sort() : [];
      expect(inSchema, e.name).toEqual(inPath);
    }
  });

  it('gives a response schema exactly to the endpoints that return JSON', () => {
    for (const e of endpointList) {
      if (e.status === 204) expect(e.response, e.name).toBeNull();
      else if (e.stream) expect(e.response, e.name).toBeNull();
      else expect(e.response, e.name).not.toBeNull();
      if (e.method === 'GET' || e.method === 'DELETE') expect(e.body, e.name).toBeNull();
    }
    expect(endpointList.filter((e) => e.stream).map((e) => e.name)).toEqual(['tutor.sendMessage']);
    expect(endpointList.filter((e) => !e.auth).map((e) => e.name)).toEqual(['system.health']);
  });

  it('builds paths', () => {
    expect(buildPath(endpoints['texts.translateSentence'].path, { id: 'abc', n: 2 })).toBe(
      '/texts/abc/sentences/2/translation',
    );
    expect(() => buildPath('/notes/:id')).toThrow(/missing path parameter/);
  });

  it('applies the paging defaults', () => {
    const q = endpoints['notes.list'].query.parse({});
    expect(q.limit).toBe(50);
    expect(endpoints['notes.list'].query.safeParse({ limit: '201' }).success).toBe(false);
    expect(endpoints['texts.list'].query.parse({ archived: 'false' }).archived).toBe(false);
  });
});

describe('examples', () => {
  it('exist for every endpoint and for nothing else', () => {
    const missing = endpointList.filter((e) => !exampleTable[e.name]?.ok.length).map((e) => e.name);
    expect(missing).toEqual([]);
    expect(Object.keys(exampleTable).sort()).toEqual(endpointList.map((e) => e.name).sort());
  });

  for (const e of endpointList) {
    describe(e.name, () => {
      const set = exampleTable[e.name];
      it('parses every success example with its schemas', () => {
        expect(set?.ok.length).toBeGreaterThan(0);
        for (const ex of set?.ok ?? []) {
          const { params, query, body } = ex.request;
          if (e.params) e.params.parse(params);
          else expect(params).toBeUndefined();
          if (e.query) e.query.parse(query ?? {});
          else expect(query).toBeUndefined();
          if (e.body) e.body.parse(body);
          else expect(body).toBeUndefined();

          expect(ex.response.status).toBe(e.status);
          if (e.response) e.response.parse(ex.response.body);
          else expect(ex.response.body).toBeUndefined();

          if (e.stream) {
            expect(ex.stream?.length).toBeGreaterThan(0);
            for (const ev of ex.stream ?? []) e.stream.parse(ev);
          } else {
            expect(ex.stream).toBeUndefined();
          }
        }
      });

      it('parses every error example with the error schema and status', () => {
        for (const ex of set?.errors ?? []) {
          const body = ErrorResponseSchema.parse(ex.response.body);
          expect(ex.response.status).toBe(ERROR_STATUS[body.error.code]);
        }
      });
    });
  }
});
