// Mock server handlers of the reader (picked up by src/mocks/handlers.ts). They keep a small
// in-memory store so a flow works end to end against the mock: import a text, see it
// processing (it is ready on the second poll), read it, save a word and see the status after
// a reload. Seeded with the contract examples, and answering a contract example request
// with the example's response, so the shell's mock tests still hold.
// In the browser the store lives in localStorage, so a reload keeps it; tests reset it.
import {
  type EndpointName,
  examples,
  type LemmaStatus,
  type LibraryItem,
  type TextDetail,
  type TextSummary,
} from '@app/contracts';
import { type HttpHandler, HttpResponse, http } from 'msw';
import type { ApiInput, ApiResult } from '../../lib/api/client';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';
import { mockAnalyze } from './mockAnalyzer';

// src/mocks/handlers.ts loads this file while it is itself being loaded (its eager glob), so
// its `mockEndpoint` cannot be used here at load time. This is the same idea, kept small.
type Body<N extends EndpointName> = ApiInput<N> extends { body: infer B } ? B : undefined;
type Info<N extends EndpointName> = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Body<N>;
};

function patternOf(name: EndpointName): string {
  const base = env.apiBase.replace(/\/$/, '');
  const path = `${base}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(base) ? path : `*${path}`;
}

function mockEndpoint<N extends EndpointName>(
  name: N,
  reply: (info: Info<N>) => ApiResult<N> | Response,
): HttpHandler {
  const meta = ENDPOINT_META[name];
  const method = meta.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  return http[method](patternOf(name), async ({ request, params }) => {
    const text = await request.clone().text();
    const value = reply({
      params: params as Record<string, string>,
      query: new URL(request.url).searchParams,
      body: (text ? JSON.parse(text) : undefined) as Body<N>,
    });
    if (value instanceof Response) return value;
    return HttpResponse.json(value as never, { status: meta.status });
  });
}

const EXAMPLE_TEXT = examples['texts.get'].ok[0].response.body as TextDetail;
const EXAMPLE_LIBRARY = (examples['library.list'].ok[0].response.body as { items: LibraryItem[] })
  .items;
/** The id `POST /library/:id/add` answers with in the contract example. */
const LIBRARY_COPY_ID = (examples['library.add'].ok[0].response.body as { id: string }).id;

/** A text whose body contains this marker fails its analysis (to try the failure state). */
export const MOCK_FAIL_MARKER = '#fail';
/** The poll on which a new text is ready; the polls before answer `processing`. */
export const MOCK_PROCESSING_POLLS = 2;

interface MockText {
  detail: Omit<TextDetail, 'lemmaStatus'>;
  polls: number;
}

interface MockStore {
  texts: Record<string, MockText>;
  lemmaStatus: Record<string, LemmaStatus>;
}

const STORAGE_KEY = 'mock.reader';
const persist = import.meta.env.MODE !== 'test' && typeof localStorage !== 'undefined';

function seed(): MockStore {
  const { lemmaStatus, ...detail } = EXAMPLE_TEXT;
  return {
    texts: { [detail.id]: { detail, polls: MOCK_PROCESSING_POLLS } },
    lemmaStatus: { ...lemmaStatus },
  };
}

function load(): MockStore {
  if (!persist) return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockStore;
  } catch {
    // Broken or blocked storage: start over.
  }
  return seed();
}

let store = load();

function save() {
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: the mock just forgets.
  }
}

/** Starts the mock store over (tests call it in `beforeEach`). */
export function resetReaderMock(): void {
  store = seed();
  save();
}

/** The mock store, for assertions in tests. */
export function readerMockStore(): Readonly<MockStore> {
  return store;
}

const nowIso = () => new Date().toISOString();

function summaryOf(detail: MockText['detail']): TextSummary {
  const { body: _b, analysis: _a, error: _e, phrases: _p, ...summary } = detail;
  return summary;
}

function lemmaStatusOf(detail: MockText['detail']): Record<string, LemmaStatus> {
  const out: Record<string, LemmaStatus> = {};
  for (const id of Object.keys(detail.analysis?.lemmas ?? {})) {
    const s = store.lemmaStatus[id];
    if (s) out[id] = s;
  }
  return out;
}

function coverageOf(detail: MockText['detail']): number | null {
  const a = detail.analysis;
  if (!a) return null;
  let words = 0;
  let known = 0;
  for (const s of a.sentences) {
    for (const t of s.tokens) {
      if (t.t !== 'word' || t.l === undefined) continue;
      words++;
      const st = store.lemmaStatus[String(t.l)];
      if (st === 'known' || st === 'ignored') known++;
    }
  }
  return words === 0 ? null : Math.round((known / words) * 100) / 100;
}

/** Moves a processing text on by one poll; after two it is ready (or failed). */
function advance(text: MockText) {
  if (text.detail.status !== 'processing') return;
  text.polls += 1;
  if (text.polls < MOCK_PROCESSING_POLLS) return;
  if (text.detail.body.includes(MOCK_FAIL_MARKER)) {
    text.detail = { ...text.detail, status: 'failed', error: 'The analysis failed.' };
    return;
  }
  const analysis = mockAnalyze(text.detail.body);
  const tokenCount = analysis.sentences.reduce((n, s) => n + s.tokens.length, 0);
  text.detail = {
    ...text.detail,
    status: 'ready',
    analysis,
    tokenCount,
    uniqueLemmaCount: Object.keys(analysis.lemmas).length,
    updatedAt: nowIso(),
  };
  text.detail.coverage = coverageOf(text.detail);
}

function newText(id: string, title: string, body: string, source: TextSummary['source']) {
  const now = nowIso();
  const text: MockText = {
    polls: 0,
    detail: {
      id,
      title,
      source,
      sourceRef: null,
      status: 'processing',
      tokenCount: null,
      uniqueLemmaCount: null,
      coverage: null,
      progress: {},
      archived: false,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
      body,
      analysis: null,
      error: null,
      phrases: [],
    },
  };
  store.texts[id] = text;
  return text;
}

/** The stored text, or the example text under this id (any deep link renders in mock mode). */
function textOrExample(id: string): MockText['detail'] {
  const text = store.texts[id];
  if (text) return text.detail;
  const { lemmaStatus: _ls, ...example } = EXAMPLE_TEXT;
  return { ...example, id };
}

function detailFor(id: string): TextDetail {
  const text = store.texts[id];
  if (text) {
    advance(text);
    save();
  }
  const detail = textOrExample(id);
  return { ...detail, coverage: coverageOf(detail), lemmaStatus: lemmaStatusOf(detail) };
}

export const handlers: HttpHandler[] = [
  mockEndpoint('texts.list', ({ query }) => {
    const archived = query.get('archived') === 'true';
    const items = Object.values(store.texts)
      .map((t) => ({ ...summaryOf(t.detail), coverage: coverageOf(t.detail) }))
      .filter((t) => t.archived === archived)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items, nextCursor: null };
  }),
  mockEndpoint('texts.create', ({ body }) => {
    // Repeating a write with the same id is harmless: the text stays as it is.
    if (!store.texts[body.id]) {
      const title = body.title?.trim() || body.body.trim().split(/\s+/).slice(0, 4).join(' ');
      newText(body.id, title, body.body, 'paste');
      save();
    }
    return { id: body.id, status: 'processing' as const };
  }),
  mockEndpoint('texts.get', ({ params }) => detailFor(params.id as string)),
  mockEndpoint('texts.update', ({ params, body }) => {
    const id = params.id as string;
    const detail = {
      ...textOrExample(id),
      ...(body.title ? { title: body.title } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    };
    if (body.progress) detail.progress = { ...detail.progress, ...body.progress };
    const text = store.texts[id];
    if (text) {
      text.detail = detail;
      save();
    }
    return { ...summaryOf(detail), coverage: coverageOf(detail) };
  }),
  mockEndpoint('texts.delete', ({ params }) => {
    delete store.texts[params.id as string];
    save();
    return new HttpResponse(null, { status: 204 });
  }),
  mockEndpoint('texts.translateSentence', ({ params }) => {
    const n = Number(params.n);
    const detail = textOrExample(params.id as string);
    const sentence = detail.analysis?.sentences[n];
    const en = sentence?.en ?? `(Mock translation of sentence ${n + 1}.)`;
    if (store.texts[params.id as string] && detail.analysis && sentence) {
      detail.analysis.sentences[n] = { ...sentence, en };
      save();
    }
    return { n, en };
  }),
  // Side effect only, then the contract example answers (with the example's text id): the
  // learner's copy of the starter text is kept under that id.
  http.post(patternOf('library.add'), ({ params }) => {
    const item = EXAMPLE_LIBRARY.find((i) => i.id === params.id);
    const id = LIBRARY_COPY_ID;
    if (item && !store.texts[id]) {
      const text = newText(id, item.title, EXAMPLE_TEXT.body, 'library');
      text.polls = MOCK_PROCESSING_POLLS - 1;
      advance(text);
      text.detail.sourceRef = item.id;
      save();
    }
    return undefined;
  }),
  // Side effect only: record the status, then the next handler (the contract example)
  // answers, so other features see the usual reply.
  http.post(patternOf('notes.create'), async ({ request }) => {
    try {
      const body = (await request.clone().json()) as { kind?: string; lemmaId?: number };
      if (body.kind === 'word' && typeof body.lemmaId === 'number') {
        const id = String(body.lemmaId);
        const current = store.lemmaStatus[id];
        if (!current || current === 'unknown') store.lemmaStatus[id] = 'learning';
        save();
      }
    } catch {
      // Not JSON: leave it to the next handler.
    }
    return undefined;
  }),
  mockEndpoint('lemmas.setStatus', ({ params, body }) => {
    store.lemmaStatus[String(params.id)] = body.status;
    save();
    return { lemmaId: Number(params.id), status: body.status };
  }),
];
