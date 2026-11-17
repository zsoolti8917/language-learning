// `pnpm seed:demo`: a demo learner with a few weeks of history, made through the real API.
//
// The API runs in this process on the local database (PGlite in PGLITE_DIR, default
// .local/pgdata, the folder `pnpm dev` uses; stop `pnpm dev` first, PGlite opens a folder from
// one process only) with a clock that starts DEMO_DAYS days ago (default 21) and moves through
// every day: onboarding and placement, sorted words, a lesson, trainer sessions, an imported
// text with captures, a library text, tutor conversations, and the daily reviews, answered
// mostly right. Every row is written by the module that owns it, as the app would.
//
// The learner is the dev login's user (DEMO_USER overrides), so `pnpm dev` and "Continue as the
// dev user" open the demo. Running it again deletes that learner first and starts over.
import { pathToFileURL } from 'node:url';
import {
  API_BASE,
  buildPath,
  type EndpointDef,
  type EndpointName,
  type ExerciseItem,
  endpoints,
  type RequestInput,
  type ResponseOf,
  type ReviewItem,
} from '@app/contracts';
import { createDb } from '@app/db';
import { v7 as uuidv7 } from 'uuid';
import { createApp } from '../app';
import { createContainer } from '../container';
import { createBackground } from '../platform/background';
import { createFixedClock, type FixedClock } from '../platform/clock';
import { loadConfig } from '../platform/config';
import { assertRealPorts } from '../platform/stand-in';
import { localEnv } from '../server';
import { prepareLocalDatabase } from './local';

/** The dev login's user (apps/web/src/lib/auth/dev.ts, `EXAMPLE_IDS.user`). */
export const DEMO_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A text to paste on the import screen, in the words of the mini dataset. */
const PASTED_TEXT = {
  title: 'Sobota v meste',
  body: 'V sobotu idem s kamarátom do mesta. Najprv ideme do kina. Potom kúpim novú knihu a dobrú kávu. Večer sme doma.',
};

const TUTOR_LINES = [
  ['Dnes idem do kina s kamarát.', 'Idem s kamarátom. Potom ideme do mesto.', 'Ideme do mesta.'],
  ['Bývam v Bratislave.', 'Pracujem v novom obchode.'],
];

export interface DemoApp {
  app: { request: (url: string, init: RequestInit) => Response | Promise<Response> };
  clock: FixedClock;
  drain: () => Promise<void>;
}

export interface DemoOptions {
  userId?: string;
  /** Days of history; the last one is today. */
  days?: number;
  /** "Now" at the end of the history. */
  now?: Date;
  /** A deterministic chance: same inputs, same history. */
  seed?: number;
  log?: (line: string) => void;
}

export interface DemoSummary {
  userId: string;
  days: number;
  reviews: number;
  reviewDays: number;
  notes: number;
  attempts: number;
  texts: number;
  conversations: number;
}

/** Mulberry32: a small seeded random generator. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(t: DemoApp, opts: DemoOptions = {}): Promise<DemoSummary> {
  const userId = opts.userId ?? DEMO_USER;
  const days = opts.days ?? 21;
  const log = opts.log ?? (() => {});
  const rnd = random(opts.seed ?? 20261117);
  const end = opts.now ?? new Date();

  const now = () => t.clock.now();
  const id = () => uuidv7({ msecs: now().getTime() });
  const tick = (ms = 20_000) => t.clock.advance(ms);

  async function raw(name: EndpointName, input: Partial<RequestInput<EndpointName>> = {}) {
    const def = endpoints[name] as EndpointDef;
    let path = buildPath(def.path, (input.params ?? {}) as Record<string, string | number>);
    const q = Object.entries((input.query ?? {}) as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (q.length > 0)
      path += `?${new URLSearchParams(q.map(([k, v]): [string, string] => [k, String(v)]))}`;
    const headers: Record<string, string> = { authorization: `Bearer dev:${userId}` };
    if (input.body !== undefined) headers['content-type'] = 'application/json';
    const res = await t.app.request(`http://demo${API_BASE}${path}`, {
      method: def.method,
      headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${name} answered ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }
  async function call<N extends EndpointName>(
    name: N,
    input: Partial<RequestInput<N>> = {},
  ): Promise<ResponseOf<N>> {
    const text = await raw(name, input as Partial<RequestInput<EndpointName>>);
    tick();
    return (text ? JSON.parse(text) : undefined) as ResponseOf<N>;
  }

  // --- The steps of a day ------------------------------------------------------------

  async function onboarding() {
    const me = await call('profile.get');
    await call('profile.update', {
      body: {
        displayName: 'Demo',
        timezone: 'Europe/Bratislava',
        dailyNewLimit: 10,
        dailyReviewLimit: 80,
        settings: { ...me.settings, minutesPerDay: 15, onboardedAt: now().toISOString() },
      },
    });
  }

  async function placement() {
    let run = await call('placement.start', { body: { id: id() } });
    const glosses = new Map<number, string[]>();
    while (run.status !== 'completed' && run.round) {
      const answers = [];
      for (const item of run.round.items) {
        if (item.kind === 'vocab') {
          if (!glosses.has(item.lemmaId)) {
            const lemma = await call('lemmas.get', { params: { id: item.lemmaId } });
            glosses.set(
              item.lemmaId,
              lemma.senses.map((s) => s.glossEn),
            );
          }
          const right = item.options.findIndex((o) => glosses.get(item.lemmaId)?.includes(o));
          // Knows a few words, so the placement leaves the common words to sort.
          const knows = right >= 0 && rnd() < 0.3;
          answers.push({ itemId: item.itemId, choice: knows ? right : item.options.length - 1 });
        } else {
          answers.push({ itemId: item.itemId, typed: rnd() < 0.5 ? item.cue : '' });
        }
      }
      const next = await call('placement.answer', {
        params: { id: run.id },
        body: { round: run.round.round, answers },
      });
      if (next.status === 'completed' || !next.round) break;
      run = { ...run, round: next.round };
    }
    log('placement done');
  }

  async function sortWords(learn: number, known: number) {
    const words = await call('words.list', {
      query: { band: 0, status: 'unknown', limit: learn + known },
    });
    const decisions = words.items.map((w, i) => ({
      lemmaId: w.lemmaId,
      decision: i < learn ? ('learn' as const) : ('known' as const),
    }));
    if (decisions.length === 0) return;
    await call('words.triage', { body: { decisions } });
  }

  /** One graded answer: right three times in four in the trainer, always in a lesson. */
  function attempt(item: ExerciseItem, source: 'trainer' | 'lesson', sessionId?: string) {
    const right = source === 'lesson' || rnd() < 0.75;
    tick(15_000);
    return {
      id: id(),
      ...(sessionId ? { sessionId } : {}),
      source,
      exerciseId: item.exerciseId,
      typed: right ? (item.answers[0] ?? '') : 'zzz',
      correct: right,
      retry: false,
      clientDiagnosis: right ? ('correct' as const) : ('not_a_form' as const),
      occurredAt: now().toISOString(),
      durationMs: 6000,
    };
  }

  async function lesson() {
    const course = await call('declension.course');
    const next = course.lessons.find((l) => l.status === 'available' || l.status === 'in_progress');
    if (!next) return;
    const detail = await call('declension.lesson', { params: { id: next.id } });
    let score = { correct: 0, total: 0 };
    for (const [i, step] of detail.steps.entries()) {
      const attempts = step.exercises.map((e) => attempt(e, 'lesson'));
      if (attempts.length > 0) await call('declension.submitAttempts', { body: { attempts } });
      if (step.content.kind === 'checkpoint')
        score = { correct: attempts.length, total: attempts.length };
      const last = i === detail.steps.length - 1;
      await call('declension.saveProgress', {
        params: { id: next.id },
        body: last
          ? { stepIndex: i, status: 'completed', score }
          : { stepIndex: i + 1, status: 'in_progress' },
      });
    }
    log(`lesson ${next.id} completed`);
  }

  async function trainer() {
    const session = await call('declension.createSession', {
      body: { mode: 'mixed', size: 10, seed: Math.floor(rnd() * 1_000_000) },
    });
    const attempts = session.items.map((item) => attempt(item, 'trainer', session.sessionId));
    if (attempts.length === 0) return;
    await call('declension.submitAttempts', { body: { attempts } });
  }

  async function readText() {
    const textId = id();
    await call('texts.create', { body: { id: textId, ...PASTED_TEXT } });
    await t.drain();
    const text = await call('texts.get', { params: { id: textId } });
    if (!text.analysis) return;
    // Capture two words the learner does not know yet, with their sentence.
    let saved = 0;
    for (const s of text.analysis.sentences) {
      for (const token of s.tokens) {
        if (saved >= 2 || token.l === undefined || token.t !== 'word') continue;
        const status = text.lemmaStatus[String(token.l)] ?? 'unknown';
        if (status !== 'unknown') continue;
        await call('notes.create', {
          body: {
            id: id(),
            kind: 'word',
            source: 'reader',
            lemmaId: token.l,
            textId,
            context: {
              sentenceSk: text.body.slice(s.s, s.e),
              blank: { start: token.s - s.s, end: token.e - s.s },
              ...(token.tag ? { tag: token.tag } : {}),
            },
          },
        });
        text.lemmaStatus[String(token.l)] = 'learning';
        saved++;
      }
    }
    await call('texts.update', {
      params: { id: textId },
      body: { progress: { sentence: text.analysis.sentences.length - 1 } },
    });
  }

  async function library() {
    const list = await call('library.list');
    const first = list.items.find((i) => !i.textId);
    if (!first) return;
    const textId = id();
    await call('library.add', { params: { id: first.id }, body: { id: textId } });
    await t.drain();
    await call('texts.get', { params: { id: textId } });
  }

  let conversations = 0;
  async function tutor(lines: readonly string[]) {
    const scenarios = await call('tutor.scenarios');
    const scenario = scenarios.items[conversations++ % scenarios.items.length];
    if (!scenario) return;
    const conversationId = id();
    await call('tutor.startConversation', {
      body: { id: conversationId, scenarioId: scenario.id },
    });
    for (const content of lines) {
      await raw('tutor.sendMessage', {
        params: { id: conversationId },
        body: { clientId: id(), content },
      });
      tick(60_000);
    }
    await call('tutor.end', { params: { id: conversationId } });
  }

  async function reviews(): Promise<number> {
    let answered = 0;
    // Learning steps bring cards back within minutes: a few passes over the queue.
    for (let pass = 0; pass < 4; pass++) {
      const queue = await call('review.queue', { query: { limit: 200 } });
      const due = queue.items.filter(
        (i: ReviewItem) => i.dueAt === null || Date.parse(i.dueAt) <= now().getTime(),
      );
      if (due.length === 0) break;
      const answers = due.map((item) => {
        const right = rnd() < 0.85;
        tick(25_000);
        return {
          id: id(),
          cardId: item.cardId,
          answeredAt: now().toISOString(),
          typed: right ? (item.answers[0] ?? '') : 'zzz',
          variant: item.variant,
          clientGrade: right ? ('correct' as const) : ('wrong' as const),
          rating: (right ? (rnd() < 0.2 ? 4 : 3) : 1) as 1 | 3 | 4,
          overridden: false,
          durationMs: 5000 + Math.round(rnd() * 8000),
        };
      });
      for (let i = 0; i < answers.length; i += 200)
        await call('review.submitAnswers', {
          body: { clientId: 'demo-seed', answers: answers.slice(i, i + 200) },
        });
      answered += answers.length;
      // The 1 and 10 minute steps.
      tick(11 * MINUTE);
    }
    return answered;
  }

  // --- The history ---------------------------------------------------------------------

  // Start over: the learner's rows go, and the next call makes a fresh profile.
  await raw('profile.delete');
  const first = new Date(end.getTime() - (days - 1) * DAY);
  first.setUTCHours(7, 0, 0, 0);
  t.clock.set(first);
  // What happens on which day (index from the first day); other days are plain review days.
  const plan = new Map<number, () => Promise<void>>([
    [1, lesson],
    [2, readText],
    [4, library],
    [5, () => tutor(TUTOR_LINES[0] ?? [])],
    [8, lesson],
    [12, () => tutor(TUTOR_LINES[1] ?? [])],
    [15, lesson],
  ]);
  for (let d = 0; d < days; d++) {
    t.clock.set(new Date(first.getTime() + d * DAY + Math.round(rnd() * 90) * MINUTE));
    if (d === 0) {
      await onboarding();
      await placement();
      await sortWords(8, 6);
    }
    // A missed day now and then, as real learners have (never the first, the last or a planned one).
    if (d > 0 && d < days - 1 && !plan.has(d) && rnd() < 0.12) {
      log(`day ${d + 1}: skipped`);
      continue;
    }
    await plan.get(d)?.();
    if (d % 7 === 3) await sortWords(5, 3);
    if (d % 2 === 1) await trainer();
    const n = await reviews();
    log(`day ${d + 1}: ${n} reviews`);
  }
  await t.drain();

  // The summary, from the learner's own export.
  const data = await call('profile.export');
  const rows = (name: string) => data.tables[name] ?? [];
  const reviewDays = new Set(rows('review').map((r) => String(r.answeredAt).slice(0, 10)));
  return {
    userId,
    days,
    reviews: rows('review').length,
    reviewDays: reviewDays.size,
    notes: rows('note').length,
    attempts: rows('attempt').length,
    texts: rows('text').length,
    conversations: rows('conversation').length,
  };
}

async function main(): Promise<void> {
  const env = localEnv(process.env);
  const config = loadConfig(env);
  if (config.appEnv === 'production' || config.dbMode !== 'pglite')
    throw new Error('seed:demo runs on the local database only (DB_MODE=pglite).');
  const database = createDb({
    mode: 'pglite',
    ...(config.pgliteDir ? { dataDir: config.pgliteDir } : {}),
  });
  try {
    await prepareLocalDatabase(database, env.CONTENT_DIR || undefined);
    const clock = createFixedClock();
    const background = createBackground();
    const deps = createContainer({ config, database, clock, background });
    assertRealPorts(deps, config.aiMode);
    const app = createApp(deps);
    const days = Number(process.env.DEMO_DAYS ?? 21);
    const summary = await seedDemo(
      { app, clock, drain: () => background.drain() },
      {
        userId: process.env.DEMO_USER || DEMO_USER,
        days,
        log: (line) => console.log(line),
      },
    );
    console.log(
      `Demo learner ${summary.userId} in ${config.pgliteDir ?? 'memory'}: ${summary.days} days, ` +
        `${summary.reviews} reviews on ${summary.reviewDays} days, ${summary.notes} notes, ` +
        `${summary.attempts} case attempts, ${summary.texts} texts, ` +
        `${summary.conversations} conversations. Start \`pnpm dev\` and continue as the dev user.`,
    );
    await background.drain();
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(`seed:demo failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
