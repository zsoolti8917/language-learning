// The endpoint table (docs/contracts.md, "API endpoints"). One entry per endpoint; the API
// validates against it, the client takes its types from it, and the openapi script reads it.
import { z } from 'zod';
import { PageQuerySchema, UuidSchema } from './common';
import {
  AddLibraryTextSchema,
  ConversationDetailSchema,
  ConversationListSchema,
  CourseSchema,
  CreateNoteSchema,
  CreateReportSchema,
  CreateSessionSchema,
  CreateTextSchema,
  DisputeErrorSchema,
  DisputeResultSchema,
  EndConversationResultSchema,
  ExportSchema,
  HealthSchema,
  LemmaDetailSchema,
  LemmaStatusResultSchema,
  LessonDetailSchema,
  LessonProgressSchema,
  LibraryListSchema,
  NoteDetailSchema,
  NoteListSchema,
  PatternDetailSchema,
  PeekResultSchema,
  PeekSchema,
  PlacementAnswersResultSchema,
  PlacementAnswersSchema,
  PlacementRunSchema,
  ProfileSchema,
  ReportCreatedSchema,
  ReviewQueueSchema,
  SaveLessonProgressSchema,
  ScenarioListSchema,
  SendMessageSchema,
  SentenceTranslationSchema,
  SetLemmaStatusSchema,
  StartConversationSchema,
  StartPlacementSchema,
  StatsSummarySchema,
  SubmitAnswersResultSchema,
  SubmitAnswersSchema,
  SubmitAttemptsResultSchema,
  SubmitAttemptsSchema,
  TextDetailSchema,
  TextListSchema,
  TextStatusResultSchema,
  TextSummarySchema,
  TodaySchema,
  TrainerSessionSchema,
  TriageResultSchema,
  TriageSchema,
  TutorStreamEventSchema,
  UpdateNoteSchema,
  UpdateProfileSchema,
  UpdateTextSchema,
  WordBandsSchema,
  WordListSchema,
} from './entities';
import { LemmaStatusSchema, NoteKindSchema } from './enums';

/** Every path below starts with this base. */
export const API_BASE = '/api/v1';

export const API_MODULES = [
  'system',
  'profile',
  'review',
  'words',
  'placement',
  'reader',
  'declension',
  'tutor',
  'reports',
] as const;
export type ApiModule = (typeof API_MODULES)[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Path, query and body schemas are objects; `null` means the endpoint takes none. */
export type AnyObjectSchema = z.ZodObject<z.ZodRawShape>;

export interface EndpointDef {
  /** Stable name, `module.action` style: 'review.submitAnswers'. */
  readonly name: string;
  /** Which of the nine API modules serves it. */
  readonly module: ApiModule;
  readonly method: HttpMethod;
  /** Path below API_BASE, with `:param` placeholders: '/notes/:id'. */
  readonly path: string;
  readonly summary: string;
  /** False only for `GET /health`. */
  readonly auth: boolean;
  readonly params: AnyObjectSchema | null;
  readonly query: AnyObjectSchema | null;
  readonly body: z.ZodType | null;
  /** Success status. */
  readonly status: 200 | 201 | 202 | 204;
  /** JSON response body; null for 204 and for the event stream. */
  readonly response: z.ZodType | null;
  /** Set only for the streaming endpoint: the schema of one event. */
  readonly stream?: z.ZodType;
}

type Def = Omit<EndpointDef, 'params' | 'query' | 'body' | 'response' | 'auth' | 'status'> &
  Partial<Pick<EndpointDef, 'params' | 'query' | 'body' | 'response' | 'auth' | 'status'>>;

type Filled<D extends Def> = Omit<
  D,
  'params' | 'query' | 'body' | 'response' | 'auth' | 'status'
> & {
  readonly params: D extends { params: infer P } ? P : null;
  readonly query: D extends { query: infer Q } ? Q : null;
  readonly body: D extends { body: infer B } ? B : null;
  readonly response: D extends { response: infer R } ? R : null;
  readonly auth: boolean;
  readonly status: D extends { status: infer S } ? S : 200;
};

function ep<const D extends Def>(d: D): Filled<D> {
  return {
    params: null,
    query: null,
    body: null,
    response: null,
    auth: true,
    status: 200,
    ...d,
  } as unknown as Filled<D>;
}

// --- Path parameters ------------------------------------------------------------

const UuidParam = z.object({ id: UuidSchema });
const SlugParam = z.object({ id: z.string().min(1) });
const LemmaParam = z.object({ id: z.coerce.number().int().positive() });
const SentenceParam = z.object({ id: UuidSchema, n: z.coerce.number().int().nonnegative() });

// --- The table -----------------------------------------------------------------

const list = [
  // System and profile
  ep({
    name: 'system.health',
    module: 'system',
    method: 'GET',
    path: '/health',
    summary: 'App version and content version, without login',
    auth: false,
    response: HealthSchema,
  }),
  ep({
    name: 'profile.get',
    module: 'profile',
    method: 'GET',
    path: '/me',
    summary: 'The profile; the first call creates it',
    response: ProfileSchema,
  }),
  ep({
    name: 'profile.update',
    module: 'profile',
    method: 'PATCH',
    path: '/me',
    summary: 'Change any of the settings columns',
    body: UpdateProfileSchema,
    response: ProfileSchema,
  }),
  ep({
    name: 'profile.delete',
    module: 'profile',
    method: 'DELETE',
    path: '/me',
    summary: 'Delete every learner row and the login',
    status: 204,
  }),
  ep({
    name: 'profile.export',
    module: 'profile',
    method: 'GET',
    path: '/me/export',
    summary: 'All learner rows as one JSON file',
    response: ExportSchema,
  }),
  ep({
    name: 'profile.today',
    module: 'profile',
    method: 'GET',
    path: '/today',
    summary:
      'Review counts, text to continue, next lesson, weak buckets, tutor suggestion, word band progress',
    response: TodaySchema,
  }),
  ep({
    name: 'profile.stats',
    module: 'profile',
    method: 'GET',
    path: '/stats/summary',
    summary: 'Reviews per day, retention, words known and learning, mastery per bucket',
    response: StatsSummarySchema,
  }),

  // Review
  ep({
    name: 'review.queue',
    module: 'review',
    method: 'GET',
    path: '/review/queue',
    summary: 'Due cards, today’s new cards, and all that is needed to show and grade them',
    query: z.object({ limit: PageQuerySchema.shape.limit }),
    response: ReviewQueueSchema,
  }),
  ep({
    name: 'review.submitAnswers',
    module: 'review',
    method: 'POST',
    path: '/review/answers',
    summary: 'Submit a batch of answers; answers already stored are skipped',
    body: SubmitAnswersSchema,
    response: SubmitAnswersResultSchema,
  }),
  ep({
    name: 'notes.list',
    module: 'review',
    method: 'GET',
    path: '/notes',
    summary: 'The deck',
    query: PageQuerySchema.extend({
      kind: NoteKindSchema.optional(),
      q: z.string().min(1).optional(),
    }),
    response: NoteListSchema,
  }),
  ep({
    name: 'notes.get',
    module: 'review',
    method: 'GET',
    path: '/notes/:id',
    summary: 'The note, its card and its last reviews',
    params: UuidParam,
    response: NoteDetailSchema,
  }),
  ep({
    name: 'notes.create',
    module: 'review',
    method: 'POST',
    path: '/notes',
    summary: 'Create a word note with its reader context, a phrase note or a manual note',
    body: CreateNoteSchema,
    response: NoteDetailSchema,
  }),
  ep({
    name: 'notes.update',
    module: 'review',
    method: 'PATCH',
    path: '/notes/:id',
    summary: 'Suspend a note or change its content',
    params: UuidParam,
    body: UpdateNoteSchema,
    response: NoteDetailSchema,
  }),
  ep({
    name: 'notes.delete',
    module: 'review',
    method: 'DELETE',
    path: '/notes/:id',
    summary: 'Mark the note deleted; it leaves the queue',
    params: UuidParam,
    status: 204,
  }),

  // Words and placement
  ep({
    name: 'words.bands',
    module: 'words',
    method: 'GET',
    path: '/words/bands',
    summary: 'Frequency bands with counts per status',
    response: WordBandsSchema,
  }),
  ep({
    name: 'words.list',
    module: 'words',
    method: 'GET',
    path: '/words',
    summary: 'The words of one band',
    query: PageQuerySchema.extend({
      band: z.coerce.number().int().nonnegative().optional(),
      status: LemmaStatusSchema.optional(),
    }),
    response: WordListSchema,
  }),
  ep({
    name: 'words.triage',
    module: 'words',
    method: 'POST',
    path: '/words/triage',
    summary: 'Sort many words at once: known, learn or ignored',
    body: TriageSchema,
    response: TriageResultSchema,
  }),
  ep({
    name: 'lemmas.get',
    module: 'words',
    method: 'GET',
    path: '/lemmas/:id',
    summary: 'Senses, the full table of forms, sentences, status and the learner’s note id',
    params: LemmaParam,
    response: LemmaDetailSchema,
  }),
  ep({
    name: 'lemmas.setStatus',
    module: 'words',
    method: 'PUT',
    path: '/lemmas/:id/status',
    summary: 'Set the learner’s status of a word',
    params: LemmaParam,
    body: SetLemmaStatusSchema,
    response: LemmaStatusResultSchema,
  }),
  ep({
    name: 'placement.start',
    module: 'placement',
    method: 'POST',
    path: '/placement',
    summary: 'Start a placement run; returns its first round',
    body: StartPlacementSchema,
    response: PlacementRunSchema,
  }),
  ep({
    name: 'placement.answer',
    module: 'placement',
    method: 'POST',
    path: '/placement/:id/answers',
    summary: 'Answer a round; returns the next round or the result',
    params: UuidParam,
    body: PlacementAnswersSchema,
    response: PlacementAnswersResultSchema,
  }),
  ep({
    name: 'placement.get',
    module: 'placement',
    method: 'GET',
    path: '/placement/:id',
    summary: 'A placement run',
    params: UuidParam,
    response: PlacementRunSchema,
  }),

  // Reader
  ep({
    name: 'texts.create',
    module: 'reader',
    method: 'POST',
    path: '/texts',
    summary: 'Import a text; analysis runs in the background',
    body: CreateTextSchema,
    status: 202,
    response: TextStatusResultSchema,
  }),
  ep({
    name: 'texts.list',
    module: 'reader',
    method: 'GET',
    path: '/texts',
    summary: 'The learner’s texts',
    query: PageQuerySchema.extend({ archived: z.stringbool().optional() }),
    response: TextListSchema,
  }),
  ep({
    name: 'texts.get',
    module: 'reader',
    method: 'GET',
    path: '/texts/:id',
    summary: 'A text with its analysis, lemma statuses, saved phrases, position and coverage',
    params: UuidParam,
    response: TextDetailSchema,
  }),
  ep({
    name: 'texts.update',
    module: 'reader',
    method: 'PATCH',
    path: '/texts/:id',
    summary: 'Rename, save the reading position, or archive',
    params: UuidParam,
    body: UpdateTextSchema,
    response: TextSummarySchema,
  }),
  ep({
    name: 'texts.delete',
    module: 'reader',
    method: 'DELETE',
    path: '/texts/:id',
    summary: 'Delete a text',
    params: UuidParam,
    status: 204,
  }),
  ep({
    name: 'texts.translateSentence',
    module: 'reader',
    method: 'POST',
    path: '/texts/:id/sentences/:n/translation',
    summary: 'Translate one sentence; the translation is stored in the analysis',
    params: SentenceParam,
    response: SentenceTranslationSchema,
  }),
  ep({
    name: 'library.list',
    module: 'reader',
    method: 'GET',
    path: '/library',
    summary: 'The starter library with the learner’s coverage',
    response: LibraryListSchema,
  }),
  ep({
    name: 'library.add',
    module: 'reader',
    method: 'POST',
    path: '/library/:id/add',
    summary: 'Copy a library text into the learner’s texts',
    params: SlugParam,
    body: AddLibraryTextSchema,
    response: TextStatusResultSchema,
  }),

  // Declension
  ep({
    name: 'declension.course',
    module: 'declension',
    method: 'GET',
    path: '/declension/course',
    summary: 'The course map with lesson status and mastery per bucket',
    response: CourseSchema,
  }),
  ep({
    name: 'declension.lesson',
    module: 'declension',
    method: 'GET',
    path: '/declension/lessons/:id',
    summary: 'A lesson with its steps, exercises, triggers and the learner’s progress',
    params: SlugParam,
    response: LessonDetailSchema,
  }),
  ep({
    name: 'declension.saveProgress',
    module: 'declension',
    method: 'PUT',
    path: '/declension/lessons/:id/progress',
    summary: 'Save lesson progress; completing a lesson creates its review cards',
    params: SlugParam,
    body: SaveLessonProgressSchema,
    response: LessonProgressSchema,
  }),
  ep({
    name: 'declension.createSession',
    module: 'declension',
    method: 'POST',
    path: '/declension/sessions',
    summary: 'Start a trainer session: lesson, mixed or weak',
    body: CreateSessionSchema,
    response: TrainerSessionSchema,
  }),
  ep({
    name: 'declension.submitAttempts',
    module: 'declension',
    method: 'POST',
    path: '/declension/attempts',
    summary: 'Submit trainer and lesson attempts',
    body: SubmitAttemptsSchema,
    response: SubmitAttemptsResultSchema,
  }),
  ep({
    name: 'declension.pattern',
    module: 'declension',
    method: 'GET',
    path: '/declension/patterns/:id',
    summary: 'A pattern: label, model words, the table of endings, notes',
    params: SlugParam,
    response: PatternDetailSchema,
  }),

  // Tutor and reports
  ep({
    name: 'tutor.scenarios',
    module: 'tutor',
    method: 'GET',
    path: '/tutor/scenarios',
    summary: 'Scenarios and case coach sets',
    response: ScenarioListSchema,
  }),
  ep({
    name: 'tutor.startConversation',
    module: 'tutor',
    method: 'POST',
    path: '/tutor/conversations',
    summary: 'Start a conversation; returns it with the tutor’s opening message',
    body: StartConversationSchema,
    response: ConversationDetailSchema,
  }),
  ep({
    name: 'tutor.listConversations',
    module: 'tutor',
    method: 'GET',
    path: '/tutor/conversations',
    summary: 'The learner’s conversations',
    query: PageQuerySchema,
    response: ConversationListSchema,
  }),
  ep({
    name: 'tutor.getConversation',
    module: 'tutor',
    method: 'GET',
    path: '/tutor/conversations/:id',
    summary: 'Conversation, messages and errors',
    params: UuidParam,
    response: ConversationDetailSchema,
  }),
  ep({
    name: 'tutor.sendMessage',
    module: 'tutor',
    method: 'POST',
    path: '/tutor/conversations/:id/messages',
    summary: 'Send a message; the reply streams as text/event-stream',
    params: UuidParam,
    body: SendMessageSchema,
    stream: TutorStreamEventSchema,
  }),
  ep({
    name: 'tutor.peek',
    module: 'tutor',
    method: 'POST',
    path: '/tutor/conversations/:id/peek',
    summary: 'A translation, a hint or the answer; the item counts as revealed',
    params: UuidParam,
    body: PeekSchema,
    response: PeekResultSchema,
  }),
  ep({
    name: 'tutor.end',
    module: 'tutor',
    method: 'POST',
    path: '/tutor/conversations/:id/end',
    summary: 'End a conversation with a summary',
    params: UuidParam,
    response: EndConversationResultSchema,
  }),
  ep({
    name: 'tutor.disputeError',
    module: 'tutor',
    method: 'POST',
    path: '/tutor/errors/:id/dispute',
    summary: 'Dispute a correction; its card is suspended and a report filed',
    params: UuidParam,
    body: DisputeErrorSchema,
    response: DisputeResultSchema,
  }),
  ep({
    name: 'reports.create',
    module: 'reports',
    method: 'POST',
    path: '/reports',
    summary: 'Report a content item that looks wrong',
    body: CreateReportSchema,
    status: 201,
    response: ReportCreatedSchema,
  }),
] as const;

type List = typeof list;

/** The endpoint table, keyed by name. */
export type Endpoints = { readonly [E in List[number] as E['name']]: E };
export type EndpointName = keyof Endpoints;

export const endpoints = Object.fromEntries(list.map((e) => [e.name, e])) as unknown as Endpoints;

/** Every endpoint, in the order of docs/contracts.md. */
export const endpointList: readonly EndpointDef[] = list;

/** Number of endpoints the API serves. */
export const ENDPOINT_COUNT = 45;

// --- Types for clients and handlers ----------------------------------------------

type InOf<S> = S extends z.ZodType ? z.input<S> : never;
type OutOf<S> = S extends z.ZodType ? z.output<S> : never;

/** What a client sends: path params, query and body as the schemas accept them. */
export type RequestInput<N extends EndpointName> = {
  params: InOf<Endpoints[N]['params']>;
  query: InOf<Endpoints[N]['query']>;
  body: InOf<Endpoints[N]['body']>;
};
/** What a handler gets after validation. */
export type RequestOutput<N extends EndpointName> = {
  params: OutOf<Endpoints[N]['params']>;
  query: OutOf<Endpoints[N]['query']>;
  body: OutOf<Endpoints[N]['body']>;
};
/** The JSON response body; `never` for 204 and for the stream. */
export type ResponseOf<N extends EndpointName> = OutOf<Endpoints[N]['response']>;

/** Fills `:param` placeholders: buildPath('/notes/:id', { id }) → '/notes/…'. */
export function buildPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path parameter "${k}" for ${path}`);
    return encodeURIComponent(String(v));
  });
}
