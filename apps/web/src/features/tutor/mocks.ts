// Mock answers of the tutor (M6). The mock server picks these up before the contract defaults.
//
// `tutor.sendMessage` plays a short scripted conversation, chosen by what the learner writes,
// so the chat can be tried (and browser tested) end to end without a server:
//   1. "Dnes idem do kina s kamarát."         → "kamarát" is prompted (case after s).
//   2. "…s kamarátom… do mesto…"               → "kamarát" fixed by the learner; "mesto" prompted.
//   3. "…do mesto…" again                      → "mesto" corrected to "mesta", one card created.
//   "dlho" anywhere                            → a long reply, streamed slowly.
//   "chyba" anywhere                           → fails once after the analysis, then works on a
//                                                retry with the same client id.
//   anything else                              → the contract example's reply, no marks.
// Every Slovak form here is in the mini dataset: kamarátom (lemma 2, s7), mesta (lemma 20, s2),
// and the trigger prep-do takes the genitive.
import {
  EXAMPLE_IDS,
  examples,
  type ResponseOf,
  TUTOR_STREAM_EXAMPLE,
  type TutorStreamEvent,
} from '@app/contracts';
import { type HttpHandler, HttpResponse, http } from 'msw';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';
import { sseResponse } from '../../mocks/handlers';

export const MOCK_IDS = {
  errorKamarat: '0193a1b2-c3d4-7e5f-8a6b-00000000e001',
  errorMesto: '0193a1b2-c3d4-7e5f-8a6b-00000000e002',
  noteMesta: '0193a1b2-c3d4-7e5f-8a6b-00000000e010',
} as const;

const STREAM_DELAY_MS = 25;

/** Splits a reply into small deltas, as the model streams it. */
export function toDeltas(text: string, size = 6): TutorStreamEvent[] {
  const out: TutorStreamEvent[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push({ event: 'delta', data: { text: text.slice(i, i + size) } });
  }
  return out;
}

function span(content: string, word: string): { start: number; end: number } {
  const start = Math.max(0, content.indexOf(word));
  return { start, end: start + word.length };
}

/** A reply id per learner message: the client id with its last digits changed. */
function replyId(clientId: string): string {
  return `${clientId.slice(0, -4)}${clientId.endsWith('ffff') ? 'fffe' : 'ffff'}`;
}

let seq = 0;

function done(
  clientId: string,
  content: string,
  extra: { cardsCreated?: string[]; criteriaMet?: string[] } = {},
): TutorStreamEvent {
  seq += 2;
  return {
    event: 'done',
    data: {
      tutorMessage: { id: replyId(clientId), seq, content },
      cardsCreated: extra.cardsCreated ?? [],
      goal: { criteriaMet: extra.criteriaMet ?? ['c1'] },
      budget: { remainingUsd: 0.7 },
    },
  };
}

const seenFailures = new Set<string>();

/** The scripted events for one learner message. Exported for the tests. */
export function scriptedTurn(clientId: string, content: string): TutorStreamEvent[] {
  const lower = content.toLowerCase();
  const turn = (
    analysis: Extract<TutorStreamEvent, { event: 'analysis' }>['data'],
    reply: string,
    extra?: Parameters<typeof done>[2],
  ): TutorStreamEvent[] => [
    { event: 'analysis', data: analysis },
    ...toDeltas(reply),
    done(clientId, reply, extra),
  ];

  if (lower.includes('chyba') && !seenFailures.has(clientId)) {
    seenFailures.add(clientId);
    return [
      { event: 'analysis', data: { messageId: clientId, errors: [], resolved: [] } },
      ...toDeltas('Prepáč, ja'),
      { event: 'error', data: { code: 'upstream_failed', message: 'The model did not answer.' } },
    ];
  }
  if (lower.includes('dlho')) {
    const reply = Array.from(
      { length: 24 },
      (_, i) => `Veta číslo ${i + 1}: v meste je veľa ľudí a my sa prechádzame po námestí.`,
    ).join('\n');
    return [
      { event: 'analysis', data: { messageId: clientId, errors: [], resolved: [] } },
      ...toDeltas(reply, 24),
      done(clientId, reply),
    ];
  }
  if (lower.includes('kamarátom') && lower.includes('do mesto')) {
    return turn(
      {
        messageId: clientId,
        errors: [
          {
            id: MOCK_IDS.errorMesto,
            ...span(content, 'mesto'),
            given: 'mesto',
            errorType: 'case_after_preposition',
            status: 'prompted',
          },
        ],
        resolved: [{ id: MOCK_IDS.errorKamarat, status: 'self_corrected', expected: 'kamarátom' }],
      },
      'Výborne, s kamarátom! A kam idete potom?',
      { criteriaMet: ['c1', 'c2'] },
    );
  }
  if (lower.includes('do mesto')) {
    return turn(
      {
        messageId: clientId,
        errors: [],
        resolved: [
          {
            id: MOCK_IDS.errorMesto,
            status: 'corrected',
            expected: 'mesta',
            explanationEn: 'After do, use the genitive: do mesta.',
          },
        ],
      },
      'Aha, idete do mesta. Čo tam budete robiť?',
      { cardsCreated: [MOCK_IDS.noteMesta], criteriaMet: ['c1', 'c2'] },
    );
  }
  if (/\bs kamarát\b/.test(lower)) {
    return turn(
      {
        messageId: clientId,
        errors: [
          {
            id: MOCK_IDS.errorKamarat,
            ...span(content, 'kamarát'),
            given: 'kamarát',
            errorType: 'case_after_preposition',
            status: 'prompted',
          },
        ],
        resolved: [],
      },
      'S kým ideš do kina?',
    );
  }
  // The contract example's reply, without its marks (their offsets belong to another sentence).
  return TUTOR_STREAM_EXAMPLE.map((e) =>
    e.event === 'analysis'
      ? { event: 'analysis', data: { messageId: clientId, errors: [], resolved: [] } }
      : e,
  );
}

// src/mocks/handlers.ts loads this file while it is still loading itself (an eager glob), so
// nothing from it may run at module load here: `mockEndpoint` would hit its uninitialised
// imports. The handlers are plain MSW handlers; `sseResponse` runs only when a request comes.
function pattern(path: string): string {
  const base = env.apiBase.replace(/\/$/, '');
  return /^https?:\/\//.test(base) ? `${base}${path}` : `*${base}${path}`;
}

/** The end summary of the scripted conversation: one error fixed, one corrected, one card. */
export const MOCK_END_SUMMARY: ResponseOf<'tutor.end'> = {
  summary: {
    textEn: 'You said where you are going and who with. Remember the genitive after do.',
    goalMet: true,
    criteriaMet: ['c1', 'c2'],
    errors: [
      {
        id: MOCK_IDS.errorKamarat,
        messageId: EXAMPLE_IDS.learnerMessage1,
        start: 20,
        end: 27,
        given: 'kamarát',
        expected: 'kamarátom',
        correctedSentence: 'Dnes idem do kina s kamarátom.',
        errorType: 'case_after_preposition',
        caseGiven: 'nom',
        caseExpected: 'ins',
        lemmaId: 2,
        triggerId: 'prep-s-ins',
        severity: 'case',
        verified: true,
        status: 'self_corrected',
        noteId: null,
      },
      {
        id: MOCK_IDS.errorMesto,
        messageId: EXAMPLE_IDS.learnerMessage1,
        start: 3,
        end: 8,
        given: 'mesto',
        expected: 'mesta',
        correctedSentence: 'Idem do mesta.',
        errorType: 'case_after_preposition',
        caseGiven: 'nom',
        caseExpected: 'gen',
        lemmaId: 20,
        triggerId: 'prep-do',
        explanationEn: 'After do, use the genitive: do mesta.',
        severity: 'case',
        verified: true,
        status: 'corrected',
        noteId: MOCK_IDS.noteMesta,
      },
    ],
  },
  cardsCreated: 1,
};

/** Conversations that played a scripted turn; their end answers with the scripted summary. */
const scripted = new Set<string>();

// The contract's own example requests keep their example answers (src/lib/api/client.test.ts
// checks every endpoint of the mock server against them).
export const handlers: HttpHandler[] = [
  http.post(pattern(ENDPOINT_META['tutor.sendMessage'].path), async ({ request, params }) => {
    const body = (await request.json()) as { clientId: string; content: string };
    if (body.clientId === EXAMPLE_IDS.learnerMessage1) return sseResponse(TUTOR_STREAM_EXAMPLE);
    scripted.add(String(params.id));
    return sseResponse(scriptedTurn(body.clientId, body.content), { delayMs: STREAM_DELAY_MS });
  }),
  http.post(pattern(ENDPOINT_META['tutor.end'].path), ({ params }) =>
    scripted.has(String(params.id))
      ? HttpResponse.json(MOCK_END_SUMMARY)
      : HttpResponse.json(examples['tutor.end'].ok[0]?.response.body as never),
  ),
];
