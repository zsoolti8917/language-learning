// The tutor module end to end: the app on PGlite with the mini dataset, the mock gateway and
// one shared test database for the file.
import type { ScriptedAnswer } from '@app/ai';
import {
  ConversationDetailSchema,
  EndConversationResultSchema,
  type TutorStreamEvent,
  TutorStreamEventSchema,
} from '@app/contracts';
import { contentReport, conversation, message, note, tutorError } from '@app/db';
import { createTestDb, type TestDb, uuidv7 } from '@app/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSse } from '../../platform/sse';
import { currentUserId } from '../../platform/tx';
import type { NotesPort } from '../../ports';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import {
  type AttemptsRecorder,
  createNotesRecorder,
  type NotesRecorder,
} from '../../testing/recorders';
import type { AnalysisError, TutorAnalysis } from './analysis';

// --- Set up ----------------------------------------------------------------------

let db: TestDb;
let t: TestApp;
let notes: NotesRecorder;
/** withUser transactions open right now. */
let openTx = 0;
/** For every model call: how many transactions were open when it started. */
const txAtModelCall: number[] = [];

/** The notes stand in, plus a real `app.note` row, so `tutor_error.note_id` can point at it. */
function notesWithRows(rec: NotesRecorder): NotesPort {
  return {
    ...rec,
    async createCaseSentenceNote(tx, input) {
      const r = await rec.createCaseSentenceNote(tx, input);
      if (r.created)
        await tx.insert(note).values({
          id: r.noteId,
          userId: await currentUserId(tx),
          kind: 'case_sentence',
          lemmaId: input.content.lemmaId ?? null,
          content: input.content,
          source: input.source,
          sourceRef: input.sourceRef ?? null,
        });
      return r;
    },
    async suspendNote(tx, noteId) {
      await rec.suspendNote(tx, noteId);
      await tx.update(note).set({ suspended: true }).where(eq(note.id, noteId));
    },
  };
}

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  const counted: TestDb = {
    ...db,
    withUser: (userId, fn) => {
      openTx += 1;
      return db.withUser(userId, fn).finally(() => {
        openTx -= 1;
      });
    },
  };
  notes = createNotesRecorder({ uuid: uuidv7 });
  t = await createTestApp({ db: counted, ports: { notes: notesWithRows(notes) } });
  const gw = t.gateway;
  const structured = gw.structured.bind(gw);
  const stream = gw.stream.bind(gw);
  gw.structured = (req) => {
    txAtModelCall.push(openTx);
    return structured(req);
  };
  gw.stream = (req) => {
    txAtModelCall.push(openTx);
    return stream(req);
  };
});
afterAll(async () => {
  await t.close();
  await db.close();
});
beforeEach(() => {
  t.gateway.reset();
});

const attempts = () => t.ports.attempts as AttemptsRecorder;

// --- Helpers ---------------------------------------------------------------------------

function analysis(over: Partial<TutorAnalysis> = {}): ScriptedAnswer {
  return { data: { errors: [], retries: [], goalUpdates: [], meaningOk: true, ...over } };
}

function caseError(
  message: string,
  given: string,
  expected: string,
  over: Partial<AnalysisError> = {},
): AnalysisError {
  const start = message.indexOf(given);
  return {
    start,
    end: start + given.length,
    given,
    expected,
    correctedSentence: message.replace(given, expected),
    errorType: 'case_after_preposition',
    explanationEn: `Use ${expected}.`,
    ...over,
  };
}

const KAMARAT_MSG = 'Dnes idem do kina s kamarát.';
const KAMARAT = caseError(KAMARAT_MSG, 'kamarát', 'kamarátom', {
  caseExpected: 'ins',
  caseGiven: 'nom',
  lemma: 'kamarát',
  trigger: 's',
  correctedSentenceEn: 'Today I am going to the cinema with a friend.',
  explanationEn: 'After s (with), use the instrumental: kamarátom.',
});

async function start(c: TestClient, scenarioId = 'scn-city-walk'): Promise<string> {
  const id = uuidv7();
  const res = await c.call('tutor.startConversation', { body: { id, scenarioId } });
  expect(res.status, res.text).toBe(200);
  return id;
}

async function send(
  c: TestClient,
  id: string,
  content: string,
  clientId = uuidv7(),
): Promise<{ status: number; events: TutorStreamEvent[]; text: string; body: unknown }> {
  const res = await c.call('tutor.sendMessage', { params: { id }, body: { clientId, content } });
  if (res.status !== 200) return { status: res.status, events: [], text: res.text, body: res.body };
  const events = parseSse(res.text).map((e) => TutorStreamEventSchema.parse(e));
  return { status: 200, events, text: res.text, body: undefined };
}

function eventOf<E extends TutorStreamEvent['event']>(
  events: TutorStreamEvent[],
  name: E,
): Extract<TutorStreamEvent, { event: E }>['data'] {
  const e = events.find((x) => x.event === name);
  if (!e) throw new Error(`no ${name} event in ${JSON.stringify(events)}`);
  return e.data as never;
}

async function errorsOf(conversationId: string) {
  return db.db.select().from(tutorError).where(eq(tutorError.conversationId, conversationId));
}

// --- Scenarios and conversations ---------------------------------------------------------

describe('scenarios and conversations', () => {
  it('lists the scenarios with the times each was completed', async () => {
    const c = t.as();
    const res = await c.call('tutor.scenarios');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([
      'scn-city-walk',
      'scn-coach-loc',
    ]);
    expect(res.body.items[0]).toMatchObject({ targetCases: ['gen', 'ins'], timesDone: 0 });
  });

  it('starts with the opening line, repeats harmlessly, lists and opens it', async () => {
    const c = t.as();
    const id = uuidv7();
    const first = await c.call('tutor.startConversation', {
      body: { id, scenarioId: 'scn-city-walk' },
    });
    expect(first.status).toBe(200);
    const d = ConversationDetailSchema.parse(first.body);
    expect(d.messages).toEqual([
      expect.objectContaining({ seq: 0, role: 'tutor', content: 'Ahoj! Ideš dnes do mesta?' }),
    ]);
    expect(d.scenario.successCriteria.map((s) => s.id)).toEqual(['c1', 'c2']);
    expect(d.conversation).toMatchObject({
      status: 'active',
      turnCount: 0,
      goalState: { criteriaMet: [] },
    });

    const again = await c.call('tutor.startConversation', {
      body: { id, scenarioId: 'scn-city-walk' },
    });
    expect(again.body).toEqual(first.body);
    const other = await c.call('tutor.startConversation', {
      body: { id, scenarioId: 'scn-coach-loc' },
    });
    expect(other.status).toBe(409);
    const missing = await c.call('tutor.startConversation', {
      body: { id: uuidv7(), scenarioId: 'scn-nope' },
    });
    expect(missing.status).toBe(404);

    const got = await c.call('tutor.getConversation', { params: { id } });
    expect(got.body).toEqual(first.body);
  });

  it('pages the list with a cursor, newest first', async () => {
    const c = t.as();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await start(c));
      t.clock.advance(1000);
    }
    const p1 = await c.call('tutor.listConversations', { query: { limit: 2 } });
    expect(p1.body.items.map((x: { id: string }) => x.id)).toEqual([ids[2], ids[1]]);
    expect(p1.body.items[0].titleEn).toBe('A walk in town');
    const p2 = await c.call('tutor.listConversations', {
      query: { limit: 2, cursor: p1.body.nextCursor },
    });
    expect(p2.body.items.map((x: { id: string }) => x.id)).toEqual([ids[0]]);
    expect(p2.body.nextCursor).toBeNull();
    const bad = await c.call('tutor.listConversations', { query: { cursor: 'nope' } });
    expect(bad.status).toBe(400);
  });
});

// --- The turn --------------------------------------------------------------------------

describe('a turn', () => {
  it('script one: an error is prompted, the learner fixes it, self_corrected, no card', async () => {
    const c = t.as();
    const id = await start(c);
    t.gateway.script(
      'tutor.analyze',
      analysis({ errors: [KAMARAT], goalUpdates: [{ criterionId: 'c1', met: true }] }),
    );
    t.gateway.script('tutor.reply', { text: ['S kým ', 'ideš do kina?'] });
    const turn1 = await send(c, id, KAMARAT_MSG);
    expect(turn1.events.map((e) => e.event)).toEqual(['analysis', 'delta', 'delta', 'done']);
    const a1 = eventOf(turn1.events, 'analysis');
    expect(a1.errors).toEqual([
      {
        id: expect.any(String),
        start: 20,
        end: 27,
        given: 'kamarát',
        errorType: 'case_after_preposition',
        status: 'prompted',
      },
    ]);
    const done1 = eventOf(turn1.events, 'done');
    expect(done1).toMatchObject({
      tutorMessage: { seq: 2, content: 'S kým ideš do kina?' },
      cardsCreated: [],
      goal: { criteriaMet: ['c1'] },
    });
    expect(done1.budget.remainingUsd).toBeGreaterThan(0);

    // The reply model never sees the prompted form.
    const replyCall = t.gateway.callsFor('tutor.reply')[0];
    expect(replyCall?.messages[0]?.content).not.toContain('kamarátom');
    expect(replyCall?.messages[0]?.content).toContain('S kým?');

    const errorId = a1.errors[0]?.id ?? '';
    t.gateway.script(
      'tutor.analyze',
      analysis({
        retries: [{ errorId, fixed: true }],
        goalUpdates: [{ criterionId: 'c2', met: true }],
      }),
    );
    t.gateway.script('tutor.reply', { text: 'Áno, s kamarátom! Super.' });
    const turn2 = await send(c, id, 'Idem s kamarátom.');
    expect(eventOf(turn2.events, 'analysis').resolved).toEqual([
      {
        id: errorId,
        status: 'self_corrected',
        expected: 'kamarátom',
        explanationEn: KAMARAT.explanationEn,
      },
    ]);
    expect(eventOf(turn2.events, 'done')).toMatchObject({
      cardsCreated: [],
      goal: { criteriaMet: ['c1', 'c2'] },
    });
    // The analysis model was told about the open error.
    expect(t.gateway.callsFor('tutor.analyze')[1]?.messages[0]?.content).toContain(`id ${errorId}`);

    const [row] = await errorsOf(id);
    expect(row).toMatchObject({
      status: 'self_corrected',
      verified: true,
      noteId: null,
      lemmaId: 2,
      triggerId: 'prep-s-ins',
    });
    expect(notes.notes.filter((n) => n.userId === c.id)).toEqual([]);
    expect(
      attempts()
        .attempts.filter((a) => a.userId === c.id)
        .map((a) => [a.correct, a.retry, a.case, a.number]),
    ).toEqual([
      [false, false, 'ins', 'sg'],
      [true, true, 'ins', 'sg'],
    ]);

    const detail = ConversationDetailSchema.parse(
      (await c.call('tutor.getConversation', { params: { id } })).body,
    );
    expect(detail.messages.map((m) => [m.seq, m.role])).toEqual([
      [0, 'tutor'],
      [1, 'learner'],
      [2, 'tutor'],
      [3, 'learner'],
      [4, 'tutor'],
    ]);
    expect(detail.conversation.turnCount).toBe(2);
    expect(detail.errors[0]).toMatchObject({ status: 'self_corrected', expected: 'kamarátom' });
  });

  it('script two: two misses, corrected, exactly one case sentence note with the right gap', async () => {
    const c = t.as();
    const id = await start(c);
    const msg = 'Potom ideme do mesto.';
    t.gateway.script(
      'tutor.analyze',
      analysis({
        errors: [
          caseError(msg, 'mesto', 'mesta', {
            caseExpected: 'gen',
            caseGiven: 'nom',
            lemma: 'mesto',
            trigger: 'do',
            correctedSentenceEn: 'Then we are going to town.',
            explanationEn: 'After do (to), use the genitive: mesta.',
          }),
        ],
      }),
    );
    t.gateway.script('tutor.reply', { text: 'Do čoho ideme?' });
    const turn1 = await send(c, id, msg);
    const errorId = eventOf(turn1.events, 'analysis').errors[0]?.id ?? '';
    expect(eventOf(turn1.events, 'analysis').errors[0]).not.toHaveProperty('expected');

    t.gateway.script('tutor.analyze', analysis({ retries: [{ errorId, fixed: false }] }));
    t.gateway.script('tutor.reply', { text: 'Do mesta (after do, use the genitive). Kedy?' });
    const turn2 = await send(c, id, 'Do mesto.');
    expect(eventOf(turn2.events, 'analysis').resolved).toEqual([
      expect.objectContaining({ id: errorId, status: 'corrected', expected: 'mesta' }),
    ]);
    const cards = eventOf(turn2.events, 'done').cardsCreated;
    expect(cards).toHaveLength(1);
    // The correction reached the reply model.
    expect(t.gateway.callsFor('tutor.reply')[1]?.messages[0]?.content).toContain(
      '"mesto" should be "mesta"',
    );

    const [row] = await errorsOf(id);
    expect(row).toMatchObject({ status: 'corrected', noteId: cards[0] });
    const mine = notes.notes.filter((n) => n.userId === c.id);
    expect(mine).toHaveLength(1);
    const rows = await db.db
      .select()
      .from(note)
      .where(eq(note.userId, c.id ?? ''));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toEqual({
      kind: 'case_sentence',
      sentenceSk: 'Potom ideme do mesta.',
      sentenceEn: 'Then we are going to town.',
      blank: { start: 15, end: 20 },
      cue: 'mesto',
      answers: ['mesta'],
      features: { case: 'gen', number: 'sg', gender: 'n' },
      lemmaId: 20,
      triggerId: 'prep-do',
    });
    expect(
      attempts()
        .attempts.filter((a) => a.userId === c.id)
        .map((a) => [a.correct, a.retry]),
    ).toEqual([
      [false, false],
      [false, true],
    ]);
  });

  it('drops a reported error whose given form is correct', async () => {
    const c = t.as();
    const id = await start(c);
    const msg = 'Idem do mesta.';
    t.gateway.script(
      'tutor.analyze',
      analysis({
        errors: [caseError(msg, 'mesta', 'mesto', { caseExpected: 'gen', lemma: 'mesto' })],
      }),
    );
    t.gateway.script('tutor.reply', { text: 'Super! S kým?' });
    const turn = await send(c, id, msg);
    expect(eventOf(turn.events, 'analysis').errors).toEqual([]);
    expect(await errorsOf(id)).toEqual([]);
    expect(t.gateway.callsFor('tutor.reply')[0]?.messages[0]?.content).not.toContain('mesto"');
  });

  it('never shows an expected form that does not exist, and never makes it a card', async () => {
    const c = t.as();
    const id = await start(c);
    const bad = { ...KAMARAT, expected: 'kamarátem', explanationEn: 'Use kamarátem.' };
    t.gateway.script('tutor.analyze', analysis({ errors: [bad] }));
    t.gateway.script('tutor.reply', { text: 'Kam idete?' });
    const turn = await send(c, id, KAMARAT_MSG);
    expect(eventOf(turn.events, 'analysis').errors).toEqual([]);
    expect(turn.text).not.toContain('kamarátem');
    const replyPrompt = t.gateway.callsFor('tutor.reply')[0]?.messages[0]?.content ?? '';
    expect(replyPrompt).not.toContain('kamarátem');
    const [row] = await errorsOf(id);
    expect(row).toMatchObject({ status: 'summary_only', verified: false, severity: 'case' });

    const got = await c.call('tutor.getConversation', { params: { id } });
    expect(got.text).not.toContain('kamarátem');
    t.gateway.script('tutor.summary', { data: { textEn: 'Good start.' } });
    const end = await c.call('tutor.end', { params: { id } });
    expect(end.status).toBe(200);
    expect(end.text).not.toContain('kamarátem');
    expect(end.body.cardsCreated).toBe(0);
    expect(notes.notes.filter((n) => n.userId === c.id)).toEqual([]);
    expect(t.gateway.callsFor('tutor.summary')[0]?.messages[0]?.content).not.toContain('kamarátem');
    const reveal = await c.call('tutor.peek', {
      params: { id },
      body: { kind: 'answer', errorId: row?.id },
    });
    expect(reveal.status).toBe(409);
  });

  it('prompts at most two errors; other slips stay in the summary only', async () => {
    const c = t.as();
    const id = await start(c);
    const msg = 'Idem do mesto s kamarát a bývam v mesto, ja ísť.';
    t.gateway.script(
      'tutor.analyze',
      analysis({
        errors: [
          caseError(msg, 'kamarát', 'kamarátom', {
            caseExpected: 'ins',
            trigger: 's',
            lemma: 'kamarát',
          }),
          caseError(msg, 'mesto', 'mesta', { caseExpected: 'gen', trigger: 'do', lemma: 'mesto' }),
          {
            ...caseError(msg, 'mesto', 'meste', {
              caseExpected: 'loc',
              trigger: 'v',
              lemma: 'mesto',
            }),
            start: 34,
            end: 39,
          },
          caseError(msg, 'ísť', 'idem', { errorType: 'verb_form' }),
        ],
      }),
    );
    t.gateway.script('tutor.reply', { text: 'Do čoho? S kým?' });
    const turn = await send(c, id, msg);
    expect(eventOf(turn.events, 'analysis').errors.map((e) => [e.given, e.status])).toEqual([
      ['mesto', 'prompted'],
      ['kamarát', 'prompted'],
    ]);
    const rows = await errorsOf(id);
    expect(rows.map((r) => [r.given, r.status, r.severity, r.verified]).sort()).toEqual([
      ['kamarát', 'prompted', 'case', true],
      ['mesto', 'prompted', 'case', true],
      ['mesto', 'summary_only', 'case', true],
      ['ísť', 'summary_only', 'other', false],
    ]);

    // Ending: the prompted ones become corrected, the third checked one a card too.
    t.gateway.script('tutor.summary', { data: { textEn: 'Practise the genitive after do.' } });
    const end = await c.call('tutor.end', { params: { id } });
    expect(end.status).toBe(200);
    const r = EndConversationResultSchema.parse(end.body);
    expect(r.cardsCreated).toBe(3);
    expect(r.summary).toMatchObject({
      textEn: 'Practise the genitive after do.',
      goalMet: false,
      criteriaMet: [],
    });
    expect(r.summary.errors.map((e) => e.status).sort()).toEqual([
      'corrected',
      'corrected',
      'summary_only',
      'summary_only',
    ]);
    expect(t.gateway.callsFor('tutor.summary')[0]?.messages[0]?.content).toContain(
      'correct "kamarátom"',
    );

    // A repeat returns the stored summary without a model call; the scenario counts as done.
    const again = await c.call('tutor.end', { params: { id } });
    expect(again.body).toEqual(end.body);
    expect(t.gateway.callsFor('tutor.summary')).toHaveLength(1);
    const scenarios = await c.call('tutor.scenarios');
    expect(scenarios.body.items[0].timesDone).toBe(1);
    const closed = await send(c, id, 'Ešte niečo.');
    expect(closed.status).toBe(409);
  });

  it('a repeated clientId returns the stored result without a new model call', async () => {
    const c = t.as();
    const id = await start(c);
    t.gateway.script('tutor.analyze', analysis({ errors: [KAMARAT] }));
    t.gateway.script('tutor.reply', { text: ['S kým ', 'ideš?'] });
    const clientId = uuidv7();
    const first = await send(c, id, KAMARAT_MSG, clientId);
    const calls = t.gateway.calls.length;
    const again = await send(c, id, KAMARAT_MSG, clientId);
    expect(t.gateway.calls.length).toBe(calls);
    expect(again.events.map((e) => e.event)).toEqual(['analysis', 'delta', 'done']);
    expect(eventOf(again.events, 'analysis')).toEqual(eventOf(first.events, 'analysis'));
    expect(eventOf(again.events, 'delta').text).toBe('S kým ideš?');
    expect(eventOf(again.events, 'done')).toEqual(eventOf(first.events, 'done'));
    const msgs = await db.db.select().from(message).where(eq(message.conversationId, id));
    expect(msgs).toHaveLength(3);
    const other = await send(c, id, 'Iný text.', clientId);
    expect(other.status).toBe(409);
  });

  it('a model failure becomes an error event and stores nothing', async () => {
    const c = t.as();
    const id = await start(c);
    t.gateway.script('tutor.analyze', { error: 'refused' });
    const failed = await send(c, id, 'Ahoj.');
    expect(failed.events).toEqual([
      { event: 'error', data: { code: 'upstream_failed', message: expect.any(String) } },
    ]);
    t.gateway.script('tutor.analyze', analysis());
    t.gateway.script('tutor.reply', { error: 'truncated' });
    const cut = await send(c, id, 'Ahoj.');
    expect(cut.events.map((e) => e.event)).toEqual(['analysis', 'error']);
    const msgs = await db.db.select().from(message).where(eq(message.conversationId, id));
    expect(msgs).toHaveLength(1);
  });

  it('answers budget_exceeded as an event when the daily budget is used up', async () => {
    const c = t.as();
    const id = await start(c);
    await db.factory.aiCall({ userId: c.id ?? '', costUsd: '5.000000', createdAt: t.clock.now() });
    const res = await send(c, id, 'Ahoj.');
    expect(res.events).toEqual([
      {
        event: 'error',
        data: {
          code: 'budget_exceeded',
          message: expect.any(String),
          details: { resetsAt: expect.any(String) },
        },
      },
    ]);
    expect(t.gateway.calls).toHaveLength(0);
  });

  it('no model call starts while a transaction is open', () => {
    expect(txAtModelCall.length).toBeGreaterThan(10);
    expect(txAtModelCall.every((n) => n === 0)).toBe(true);
  });
});

// --- Stream mechanics ------------------------------------------------------------------

describe('stream', () => {
  it('sends a keep alive every 15 seconds while the model is slow', async () => {
    const c = t.as();
    const id = await start(c);
    let release: (a: ScriptedAnswer) => void = () => {};
    const held = new Promise<ScriptedAnswer>((r) => {
      release = r;
    });
    t.gateway.script('tutor.analyze', analysis());
    t.gateway.respond('tutor.reply', () => held);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const pending = send(c, id, 'Ahoj.');
      while (t.gateway.callsFor('tutor.reply').length === 0)
        await new Promise((r) => setTimeout(r, 5));
      vi.advanceTimersByTime(31_000);
      release({ text: 'Ahoj! Kam ideš?' });
      const res = await pending;
      const keepAlive = res.text.indexOf(': keep-alive');
      expect(res.text.split(': keep-alive').length - 1).toBe(2);
      expect(keepAlive).toBeGreaterThan(res.text.indexOf('event: analysis'));
      expect(keepAlive).toBeLessThan(res.text.indexOf('event: delta'));
      expect(res.events.map((e) => e.event)).toEqual([
        'analysis',
        'delta',
        'delta',
        'delta',
        'done',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still stores the turn when the client disconnects', async () => {
    const c = t.as();
    const id = await start(c);
    let release: (a: ScriptedAnswer) => void = () => {};
    const held = new Promise<ScriptedAnswer>((r) => {
      release = r;
    });
    t.gateway.script('tutor.analyze', analysis({ errors: [KAMARAT] }));
    t.gateway.respond('tutor.reply', () => held);
    const abort = new AbortController();
    const clientId = uuidv7();
    const res = await t.app.request(`http://test/api/v1/tutor/conversations/${id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer dev:${c.id}`, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, content: KAMARAT_MSG }),
      signal: abort.signal,
    });
    const reader = res.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain('event: analysis');
    abort.abort();
    await reader?.cancel();
    release({ text: 'S kým ideš?' });
    await t.drain();
    const msgs = await db.db.select().from(message).where(eq(message.conversationId, id));
    expect(msgs.map((m) => m.role).sort()).toEqual(['learner', 'tutor', 'tutor']);
    expect(await errorsOf(id)).toHaveLength(1);
    // The retry gets the stored turn.
    const calls = t.gateway.calls.length;
    const again = await send(c, id, KAMARAT_MSG, clientId);
    expect(eventOf(again.events, 'done').tutorMessage.content).toBe('S kým ideš?');
    expect(t.gateway.calls.length).toBe(calls);
  });
});

// --- Limits ------------------------------------------------------------------------------

describe('limits', () => {
  it('refuses a message over 1,000 characters', async () => {
    const c = t.as();
    const id = await start(c);
    const res = await send(c, id, 'a'.repeat(1001));
    expect(res.status).toBe(400);
  });

  it('allows 20 messages a minute', async () => {
    const c = t.as();
    const id = await start(c);
    const other = await db.factory.conversation({
      userId: c.id ?? '',
      scenarioId: 'scn-city-walk',
    });
    for (let i = 0; i < 20; i++)
      await db.factory.message({
        userId: c.id ?? '',
        conversationId: other.id,
        seq: 100 + i,
        createdAt: new Date(t.clock.now().getTime() - 30_000),
      });
    const res = await send(c, id, 'Ahoj.');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: 'rate_limited' } });
    t.clock.advance(31_000);
    t.gateway.script('tutor.analyze', analysis());
    t.gateway.script('tutor.reply', { text: 'Ahoj!' });
    expect((await send(c, id, 'Ahoj.')).status).toBe(200);
  });

  it('allows 40 turns a conversation', async () => {
    const c = t.as();
    const id = await start(c);
    await db.db.update(conversation).set({ turnCount: 40 }).where(eq(conversation.id, id));
    const res = await send(c, id, 'Ahoj.');
    expect(res.status).toBe(409);
    expect(t.gateway.calls).toHaveLength(0);
  });
});

// --- Peek, dispute ------------------------------------------------------------------------

describe('peek and dispute', () => {
  async function prompted(
    c: TestClient,
  ): Promise<{ id: string; errorId: string; replyId: string }> {
    const id = await start(c);
    t.gateway.script('tutor.analyze', analysis({ errors: [KAMARAT] }));
    t.gateway.script('tutor.reply', { text: 'S kým ideš do kina?' });
    const turn = await send(c, id, KAMARAT_MSG);
    return {
      id,
      errorId: eventOf(turn.events, 'analysis').errors[0]?.id ?? '',
      replyId: eventOf(turn.events, 'done').tutorMessage.id,
    };
  }

  it('gives a hint without the answer and without a model call', async () => {
    const c = t.as();
    const { id, errorId } = await prompted(c);
    const calls = t.gateway.calls.length;
    const res = await c.call('tutor.peek', { params: { id }, body: { kind: 'hint', errorId } });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe(
      'Look again at kamarát. After s (with), Slovak uses the instrumental. Ask yourself: S kým? Words like chlap end in -om in the instrumental singular.',
    );
    expect(res.body.text).not.toContain('kamarátom');
    expect(t.gateway.calls.length).toBe(calls);
    const [row] = await errorsOf(id);
    expect(row?.status).toBe('prompted');
  });

  it('revealing the answer corrects the error, logs a wrong attempt and makes a card', async () => {
    const c = t.as();
    const { id, errorId } = await prompted(c);
    const res = await c.call('tutor.peek', { params: { id }, body: { kind: 'answer', errorId } });
    expect(res.body.text).toBe(`kamarátom. ${KAMARAT.explanationEn}`);
    const [row] = await errorsOf(id);
    expect(row?.status).toBe('corrected');
    expect(row?.noteId).not.toBeNull();
    const mine = attempts().attempts.filter((a) => a.userId === c.id);
    expect(mine.at(-1)).toMatchObject({
      correct: false,
      retry: true,
      sourceRef: errorId,
      expected: 'kamarátom',
    });
    const n = notes.notes.find((x) => x.noteId === row?.noteId);
    expect(n?.kind === 'case_sentence' && n.input.content).toMatchObject({
      sentenceSk: 'Dnes idem do kina s kamarátom.',
      sentenceEn: 'Today I am going to the cinema with a friend.',
      blank: { start: 20, end: 29 },
      answers: ['kamarátom'],
      features: { case: 'ins', number: 'sg', gender: 'm_anim' },
    });
    // Revealing again changes nothing.
    await c.call('tutor.peek', { params: { id }, body: { kind: 'answer', errorId } });
    expect(attempts().attempts.filter((a) => a.userId === c.id)).toHaveLength(mine.length);
    // The next message does not count the revealed error as open.
    t.gateway.script('tutor.analyze', analysis());
    t.gateway.script('tutor.reply', { text: 'Dobre.' });
    const next = await send(c, id, 'Dobre.');
    expect(eventOf(next.events, 'analysis').resolved).toEqual([]);
  });

  it('translates a message once and keeps the translation', async () => {
    const c = t.as();
    const { id, replyId } = await prompted(c);
    t.gateway.script('tutor.reply', { text: 'Who are you going to the cinema with?' });
    const body = { kind: 'translate' as const, messageId: replyId };
    const res = await c.call('tutor.peek', { params: { id }, body });
    expect(res.body).toEqual({ text: 'Who are you going to the cinema with?' });
    expect(t.gateway.callsFor('tutor.reply').at(-1)?.messages[0]?.content).toContain(
      'task: translate',
    );
    const again = await c.call('tutor.peek', { params: { id }, body });
    expect(again.body).toEqual(res.body);
    expect(t.gateway.callsFor('tutor.reply')).toHaveLength(2);
    const missing = await c.call('tutor.peek', { params: { id }, body: { kind: 'translate' } });
    expect(missing.status).toBe(400);
  });

  it('a dispute suspends the note and stores a content report', async () => {
    const c = t.as();
    const { id, errorId } = await prompted(c);
    await c.call('tutor.peek', { params: { id }, body: { kind: 'answer', errorId } });
    const [row] = await errorsOf(id);
    const res = await c.call('tutor.disputeError', {
      params: { id: errorId },
      body: { comment: 'I think it was right.' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: errorId, status: 'disputed' });
    const [n] = await db.db
      .select()
      .from(note)
      .where(eq(note.id, row?.noteId ?? ''));
    expect(n?.suspended).toBe(true);
    expect(notes.notes.find((x) => x.noteId === row?.noteId)?.suspended).toBe(true);
    const reports = await db.db
      .select()
      .from(contentReport)
      .where(eq(contentReport.targetRef, errorId));
    expect(reports).toEqual([
      expect.objectContaining({
        targetKind: 'tutor_error',
        comment: 'I think it was right.',
        status: 'open',
        userId: c.id,
      }),
    ]);
    const again = await c.call('tutor.disputeError', { params: { id: errorId }, body: {} });
    expect(again.body).toEqual({ id: errorId, status: 'disputed' });
    expect(
      await db.db.select().from(contentReport).where(eq(contentReport.targetRef, errorId)),
    ).toHaveLength(1);
    const [after] = await errorsOf(id);
    expect(after?.status).toBe('disputed');
  });
});

// --- Isolation -----------------------------------------------------------------------------

describe('isolation', () => {
  it("learner B gets not_found for learner A's rows on every endpoint", async () => {
    const a = t.as();
    const b = t.as();
    const id = await start(a);
    t.gateway.script('tutor.analyze', analysis({ errors: [KAMARAT] }));
    t.gateway.script('tutor.reply', { text: 'S kým?' });
    const turn = await send(a, id, KAMARAT_MSG);
    const errorId = eventOf(turn.events, 'analysis').errors[0]?.id ?? '';
    const replyId = eventOf(turn.events, 'done').tutorMessage.id;
    const calls = t.gateway.calls.length;

    const results = [
      await b.call('tutor.getConversation', { params: { id } }),
      await b.call('tutor.sendMessage', {
        params: { id },
        body: { clientId: uuidv7(), content: 'Ahoj.' },
      }),
      await b.call('tutor.peek', {
        params: { id },
        body: { kind: 'translate', messageId: replyId },
      }),
      await b.call('tutor.peek', { params: { id }, body: { kind: 'hint', errorId } }),
      await b.call('tutor.peek', { params: { id }, body: { kind: 'answer', errorId } }),
      await b.call('tutor.end', { params: { id } }),
      await b.call('tutor.disputeError', { params: { id: errorId }, body: {} }),
    ];
    for (const r of results) {
      expect(r.status, r.text).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
    // B's own conversation cannot reach A's error either.
    const own = await start(b);
    const cross = await b.call('tutor.peek', {
      params: { id: own },
      body: { kind: 'hint', errorId },
    });
    expect(cross.status).toBe(404);
    expect(
      (await b.call('tutor.listConversations')).body.items.map((x: { id: string }) => x.id),
    ).toEqual([own]);
    expect(
      (await b.call('tutor.startConversation', { body: { id, scenarioId: 'scn-city-walk' } }))
        .status,
    ).toBe(409);
    expect(t.gateway.calls.length).toBe(calls);
    const [row] = await errorsOf(id);
    expect(row?.status).toBe('prompted');
  });
});
