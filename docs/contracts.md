# Contracts

> Snapshot of the Contracts tab of the plan document, exported on 2026-11-17 by package F1. From now on the repository is the source of truth.

This tab is the reference every work package builds against. Package F2 turns it into code, and from that point the repository is the source of truth.

## Repository layout

Every folder has one owner package, and imports point in one direction. The package ids in brackets are defined in the Work packages tab.

```text
slovak-app/
├─ AGENTS.md                 Rules for agents (F1)
├─ package.json              Root scripts (F1)
├─ pnpm-workspace.yaml       Workspace list and the version catalog (F1)
├─ .nvmrc                    Node 24 (F1)
├─ apps/
│  ├─ api/src/
│  │  ├─ app.ts              Hono app, middleware, route mounting (F5)
│  │  ├─ platform/           Token check, transactions, errors, config, background work (F5)
│  │  ├─ ports.ts            Port interfaces (F5)
│  │  ├─ container.ts        Wires each port to its implementation (F5)
│  │  ├─ testing/            Port stand ins and one test suite per port (F5)
│  │  └─ modules/
│  │     ├─ review/  notes/              B1
│  │     ├─ lexicon/                     B2
│  │     ├─ analyzer/                    B3
│  │     ├─ reader/                      B4
│  │     ├─ declension/                  B5
│  │     ├─ words/  placement/           B6
│  │     ├─ profile/  reports/           B7
│  │     └─ tutor/                       B9
│  └─ web/src/
│     ├─ routes.tsx          Route table with one lazy import per screen (F6)
│     ├─ lib/                API client, login, local database, sync (F6)
│     ├─ mocks/              Mock server setup (F6)
│     ├─ ui/                 Design system (F7)
│     └─ features/
│        ├─ account/  today/             M1
│        ├─ review/                      M2
│        ├─ reader/                      M3
│        ├─ cases/                       M4
│        ├─ words/  placement/           M5
│        └─ tutor/                       M6
├─ packages/
│  ├─ contracts/             Schemas, endpoint table, example payloads (F2)
│  ├─ db/                    Tables, migrations, transactions, content loader (F3)
│  ├─ testkit/               Test database and factories (F3), mini dataset (F9)
│  ├─ srs/                   Scheduler wrapper and answer grading (F4)
│  ├─ ling/                  Tokenizer, form tags, tables of forms, diagnosis (F4)
│  └─ ai/                    Gateway (first version F5, then B8), one prompt folder per route (route owner)
├─ tools/
│  ├─ pipeline/              Content pipeline, one folder per stage (C1 to C5)
│  └─ evals/                 Eval runners (I3)
├─ content/                  Authored, generated and registry files (C1 to C5)
├─ e2e/                      Browser tests against the real API (I1)
└─ docs/                     This document as Markdown, and one handoff note per package
```

### Module layout

An API module is a folder with fixed file names. A module may serve endpoints, implement a port, or both.

| File | Holds |
|---|---|
| `routes.ts` | HTTP handlers. They validate with the contract schemas and call the service. |
| `service.ts` | Logic. It takes ports and a transaction and knows nothing about HTTP. |
| `repo.ts` | SQL through Drizzle. No other file of the module runs SQL. |
| `port.ts` | The module's implementation of a port, if it provides one |
| `*.test.ts` | Tests beside the code |

### Import rules

A dependency check in CI enforces these rules.

- `contracts` imports nothing from the repository.
- `srs` and `ling` import only `contracts` and do no input or output. The srs package may also import ling.
- `db` and `ai` import only `contracts`. `testkit` imports `contracts` and `db`.
- Apps import packages and never import each other. Tools import packages and may import `apps/api`, which the evals and the full content build need.
- A module reaches the logic of another module only through an interface in `ports.ts`.
- Inside a module, only `repo.ts` runs SQL. A module may read any table, and it writes only the tables it owns, as listed under Internal ports.

### Root scripts

| Script | Does |
|---|---|
| `pnpm dev` | Starts the API and the client in local mode |
| `pnpm check` | Type check, lint, unit tests and the dependency check. CI runs exactly this. |
| `pnpm test --filter <package>` | Tests of one package |
| `pnpm e2e` | Browser tests against the real API in local mode |
| `pnpm db:generate`, `pnpm db:migrate` | Create and apply migrations |
| `pnpm pipeline <stage>` | Runs one stage of the content pipeline |
| `pnpm openapi` | Regenerates `docs/openapi.json` from the contracts |
| `pnpm seed:demo` | Creates a demo learner with a few weeks of history. Package I1 provides it. |
| `pnpm smoke <url>` | Checks a deployed address: health, sign in, profile and review queue. Package F8 provides it. |

## Shared vocabulary

These names mean the same thing in the database, the API, the client and the content files. Package F2 exports each list from `contracts`, and the database builds its check constraints from them.

### Enums

| Name | Values |
|---|---|
| `Case` | `nom`, `gen`, `dat`, `acc`, `voc`, `loc`, `ins` |
| `Number` | `sg`, `pl` |
| `Gender` | `m_anim`, `m_inan`, `f`, `n` |
| `Pos` | `noun`, `adj`, `pron`, `num`, `verb`, `adv`, `prep`, `conj`, `part`, `intj`, `other` |
| `Rating` | `1` again, `2` hard, `3` good, `4` easy |
| `Grade` | `correct`, `close`, `wrong`, `revealed` |
| `CardState` | `new`, `learning`, `review`, `relearning` |
| `NoteKind` | `word`, `phrase`, `case_sentence` |
| `LemmaStatus` | `unknown`, `learning`, `known`, `ignored` |
| `Diagnosis` | `correct`, `other_case`, `diacritics`, `wrong_pattern`, `not_a_form` |
| `ErrorType`, case family | `case_after_preposition`, `case_after_verb`, `case_after_numeral`, `case_other`, `agreement_gender`, `agreement_number`, `agreement_case`, `animacy`, `genitive_plural`, `pattern_ending`, `pronoun_form` |
| `ErrorType`, other | `verb_form`, `aspect`, `word_order`, `vocabulary`, `spelling`, `other` |
| `TutorErrorStatus` | `prompted`, `self_corrected`, `corrected`, `summary_only`, `disputed` |
| `LessonStatus` | `locked`, `available`, `in_progress`, `completed`, `tested_out` |
| `LessonStepKind` | `explain`, `triggers`, `comprehension`, `production`, `checkpoint` |
| `TextStatus` | `processing`, `ready`, `failed` |
| `TriggerKind` | `preposition`, `verb`, `numeral`, `quantifier`, `question`, `adjective`, `noun`, `function` |
| `ExerciseKind` | `cloze`, `choice_meaning`, `choice_form` |
| `ReadingMethod` | `single`, `rule`, `model`, `guess` |
| `AiRoute` | `tutor.analyze`, `tutor.reply`, `tutor.summary`, `reader.disambiguate`, `reader.gloss`, `reader.translate` |
| `ErrorCode` | `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `rate_limited`, `budget_exceeded`, `upstream_failed`, `internal` |

The tutor corrects errors of the case family during the chat. Errors of the other family appear only in the end summary.

### Form tags

A form tag says which case, number and gender a word form expresses. It is short because the forms table holds over a million rows.

| Part | Values | Example |
|---|---|---|
| Number | `s` singular, `p` plural |  |
| Case | `1` nom, `2` gen, `3` dat, `4` acc, `5` voc, `6` loc, `7` ins. This is the numbering Slovak schools use. |  |
| Gender, only for words that agree | `m` masculine animate, `i` masculine inanimate, `f`, `n` |  |
| Noun | number and case | `s2` is genitive singular |
| Adjective, pronoun or numeral that agrees | number, case and gender | `p4f` is accusative plural feminine |
| Pronoun without number | `x` and case | `x3` is the dative of *ja* |
| Verb | `v:` and the rest of the source tag, opaque in the first release | `v:Kesc+` |
| Anything else | empty |  |

A form with several readings carries several tags, separated by spaces: *mesta* has `s2`, and *mestá* has `p1 p4 p5`. Only `ling` parses tags. JSON payloads carry the decoded values, for example `{ case: "gen", number: "sg" }`.

### Ids

| Thing | Id | Example |
|---|---|---|
| Learner rows | UUID version 7. The client makes the id for notes, reviews, attempts, texts, conversations, learner messages, placement runs and reports. |  |
| Lemma | Integer from the registry `content/registry/lemma-ids.tsv`, with a readable key | `20`, key `mesto|noun|n|1` |
| Sentence | Source prefix and source number, or a hash for generated ones | `tat-482913`, `ud-train-0042`, `gen-9f2c1a7b` |
| Exercise | Hash of kind, sentence and target | `ex-3fa94c21d0` |
| Lesson, lesson step | Slug, and slug with position | `gen-sg`, `gen-sg/3` |
| Trigger | Kind, word, and the case when a word has two | `prep-do`, `prep-na-acc`, `verb-pomahat` |
| Pattern | The model word without accents | `chlap`, `zena`, `pekny` |
| Scenario, library text | Prefix and slug or number | `scn-cafe-order`, `lib-003` |

The database holds no foreign keys from schema `app` to schema `ling`. The ids above are stable, and the pipeline's validate stage proves that none ever disappears.

### Text and time

- `foldAscii(s)` lower cases a string and strips its accents. `contracts` exports the only implementation, and the column `form_ascii` is built with it.
- `normalizeAnswer(s)` trims, joins repeated spaces, lower cases and drops a final full stop, question mark or exclamation mark.
- Timestamps are `timestamptz` in the database and ISO 8601 strings in UTC in JSON.
- A learner's day starts at `day_start_hour` in the profile's time zone. The default is 4 in the morning. Daily caps count from there.

## Data model: schema ling

Schema `ling` holds reference data in 13 tables. The pipeline loads it, and the app only reads it, with one exception: glosses written at run time.

The SQL below is the specification for package F3, which expresses it in Drizzle. Columns named `g_case`, `g_number` and `g_gender` hold the grammar values, because `case` is a reserved word in SQL. In JSON they are `case`, `number` and `gender`.

```sql
create schema ling;

create table ling.lemma (
  id          integer primary key,          -- from the registry, never reused
  key         text not null unique,         -- 'mesto|noun|n|1'
  lemma       text not null,
  lemma_ascii text not null,
  pos         text not null,                -- Pos
  gender      text,                         -- Gender, nouns only
  pattern     text,                         -- ling.pattern.id, nouns and adjectives
  aspect      text,                         -- 'ipf' | 'pf' | 'both', verbs only
  freq_rank   integer,                      -- 1 is the most common; null beyond the ranked list
  top_forms   jsonb not null default '[]',  -- [{ form, tag, share }], most used first
  flags       jsonb not null default '{}'   -- { proper, irregular, pluralOnly, indeclinable }
);
create index on ling.lemma (lemma_ascii);
create index on ling.lemma (freq_rank) where freq_rank is not null;

create table ling.form (
  lemma_id   integer not null references ling.lemma (id),
  form       text not null,                 -- as written, capitals kept
  form_ascii text not null,                 -- foldAscii(form)
  tags       text not null,                 -- form tags separated by spaces: 'p1 p4 p5'
  primary key (lemma_id, form)
);
create index on ling.form (form_ascii);     -- every lookup goes through this index

create table ling.sense (
  lemma_id integer not null references ling.lemma (id),
  ord      smallint not null,
  gloss_en text not null,
  note     text,
  source   text not null,                   -- 'wiktionary' | 'generated' | 'manual' | 'runtime'
  verified boolean not null default false,
  primary key (lemma_id, ord)
);

create table ling.sentence (
  id         text primary key,
  text_sk    text not null,
  text_en    text not null,
  tokens     jsonb not null,                -- [{ s, e, lemmaId, tag }]
  difficulty real not null,                 -- 0 easy to 1 hard
  source     text not null,                 -- 'tatoeba' | 'ud' | 'generated'
  source_ref text,
  license    text not null,
  audio_path text,                          -- unused in the first release
  verified   boolean not null default false
);

create table ling.lemma_sentence (
  lemma_id    integer not null references ling.lemma (id),
  sentence_id text not null references ling.sentence (id),
  token_index smallint not null,
  form        text not null,
  tag         text not null,                -- the form tag used in this sentence
  ord         smallint not null,            -- display order for this lemma
  primary key (lemma_id, sentence_id, token_index)
);

create table ling.trigger (
  id             text primary key,          -- 'prep-do', 'prep-na-acc'
  kind           text not null,             -- TriggerKind
  lemma          text not null,             -- 'do', 'na', 'pomáhať', 'päť'
  lemma_id       integer,
  g_case         text not null,             -- the Case it demands
  meaning_en     text not null,
  note_en        text,
  example_sk     text not null,
  example_en     text not null,
  contrast_group text,                      -- shared by 'prep-na-acc' and 'prep-na-loc'
  freq_rank      integer
);

create table ling.pattern (
  id                      text primary key, -- 'chlap', 'zena', 'pekny'
  label_sk                text not null,    -- 'chlap', 'žena', 'pekný'
  pos                     text not null,    -- 'noun' | 'adj'
  gender                  text,             -- Gender, noun patterns only
  model_lemma_id          integer,
  everyday_model_lemma_id integer,          -- 'muž' beside 'chlap'
  endings                 jsonb not null,   -- { "s1": "", "s2": "a", ... } keyed by form tag
  notes_en                text
);

create table ling.lesson (
  id            text primary key,           -- 'acc-sg'
  course        text not null default 'declension',
  ord           smallint not null,
  title_en      text not null,
  title_sk      text not null,
  g_case        text,                       -- null for lessons that mix cases
  g_number      text,
  focus         jsonb not null,             -- { buckets: [{ case, number, gender, weight }], triggerIds: [] }
  summary_md    text not null,
  prerequisites text[] not null default '{}'
);

create table ling.lesson_step (
  lesson_id text not null references ling.lesson (id),
  ord       smallint not null,
  kind      text not null,                  -- LessonStepKind
  content   jsonb not null,                 -- LessonStepContent, see Shared data shapes
  primary key (lesson_id, ord)
);

create table ling.exercise (
  id          text primary key,             -- 'ex-' + hash
  kind        text not null,                -- ExerciseKind
  sentence_sk text not null,
  sentence_en text not null,
  target      jsonb not null,               -- { start, end, lemmaIds, cue, answers }
  g_case      text not null,
  g_number    text not null,
  g_gender    text not null,
  pattern     text,
  trigger_id  text,
  options     jsonb,                        -- choice kinds: [{ text, correct }]
  lesson_id   text,                         -- the lesson this exercise belongs to
  difficulty  real not null,
  source      text not null,                -- 'authored' | 'generated' | 'ud' | 'tatoeba'
  verified    boolean not null default false,
  flags       jsonb not null default '{}'
);
create index on ling.exercise (g_case, g_number, g_gender);
create index on ling.exercise (lesson_id);

create table ling.scenario (
  id               text primary key,        -- 'scn-cafe-order'
  mode             text not null,           -- 'scenario' | 'case_coach'
  title_en         text not null,
  title_sk         text not null,
  goal_en          text not null,
  setting_sk       text not null,
  tutor_role       text not null,
  target_cases     text[] not null,
  target_triggers  text[] not null,
  level            text not null,           -- 'A2' | 'B1'
  opening_sk       text not null,
  success_criteria jsonb not null,          -- [{ id, textEn }]
  vocab_hint       jsonb not null default '[]',  -- [{ sk, en }]
  ord              smallint not null
);

create table ling.library_text (
  id           text primary key,            -- 'lib-003'
  title        text not null,
  body         text not null,
  level        text not null,
  analysis     jsonb,                       -- TextAnalysis; null until analysed
  lemma_counts jsonb,                       -- { lemmaId: count }
  source       text not null,               -- 'authored' | 'generated' | 'public_domain'
  license      text not null,
  ord          smallint not null
);

create table ling.content_version (
  id        integer generated always as identity primary key,
  version   text not null,                  -- '2026-12-01.1'
  built_at  timestamptz not null,
  loaded_at timestamptz not null default now(),
  sources   jsonb not null,                 -- [{ name, url, checksum, license }]
  counts    jsonb not null                  -- rows per table
);
```

### Rules for this schema

- **Read only for the app.** The role `authenticated` gets `select` on every table and nothing else. The schema has no row level security, because it holds no personal data.
- **One run time write.** When the dictionary lacks a gloss, the lexicon module stores the model's gloss in `ling.sense` with the source `runtime`. A content load keeps such rows until a real gloss replaces them.
- **Links are checked by the pipeline.** Text columns that point at another table, such as `pattern` and `trigger_id`, carry no foreign key, so tables can load in any order. The validate stage checks every link.
- **Loads are upserts.** A load never deletes a lemma, a sentence or an exercise that a learner's card may point at. Retired rows get a flag instead.
- **Size.** Measured on synthetic rows in PGlite, a row of `ling.form` takes about 150 bytes with both indexes. The whole table should take 180 to 210 MB.

## Data model: schema app

Schema `app` holds learner data in 14 tables, and every row has an owner. Each table carries `user_id`, which points at `app.profile` and cascades on delete, so removing a profile removes everything the learner made.

```sql
create schema app;

create table app.profile (
  user_id            uuid primary key,             -- the id from the login service
  display_name       text,
  ui_lang            text not null default 'en',
  explain_lang       text not null default 'en',
  level              text not null default 'A2',
  timezone           text not null default 'Europe/Bratislava',
  day_start_hour     smallint not null default 4,
  daily_new_limit    smallint not null default 10,
  daily_review_limit smallint not null default 80,
  desired_retention  real not null default 0.9,
  strict_diacritics  boolean not null default false,
  placement_done_at  timestamptz,
  current_lesson_id  text,
  words_band_target  integer not null default 1000,
  settings           jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- In every table below: user_id uuid not null references app.profile on delete cascade

create table app.user_lemma (
  user_id    uuid not null,
  lemma_id   integer not null,
  status     text not null,                        -- LemmaStatus
  source     text not null,                        -- 'placement' | 'triage' | 'reader' | 'review' | 'manual'
  known_at   timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lemma_id)
);

create table app.note (
  id          uuid primary key,                    -- made on the client
  user_id     uuid not null,
  kind        text not null,                       -- NoteKind
  lemma_id    integer,                             -- word notes, and the target word of a case sentence
  exercise_id text,                                -- case sentences taken from the exercise bank
  text_id     uuid,                                -- the text it was captured in
  content     jsonb not null,                      -- NoteContent
  source      text not null,                       -- 'reader' | 'words' | 'declension' | 'tutor' | 'manual'
  source_ref  jsonb,
  suspended   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index on app.note (user_id, lemma_id) where kind = 'word' and deleted_at is null;
create unique index on app.note (user_id, exercise_id) where exercise_id is not null and deleted_at is null;
create index on app.note (user_id, created_at);

create table app.card (
  id                uuid primary key,
  user_id           uuid not null,
  note_id           uuid not null references app.note on delete cascade,
  template          text not null default 'recall',
  state             text not null default 'new', -- CardState
  due_at            timestamptz,                   -- null while new
  new_ord           bigint,                        -- order among new cards, lower first
  stability         real,
  difficulty        real,
  reps              integer not null default 0,
  lapses            integer not null default 0,
  last_review_at    timestamptz,
  scheduler_state   jsonb,                         -- opaque, owned by packages/srs
  scheduler_version text,                          -- for example 'ts-fsrs@6/fsrs-7'
  variant_cursor    smallint not null default 0,   -- which sentence of the note comes next
  suspended         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (note_id, template)
);
create index on app.card (user_id, state, due_at);

create table app.review (                          -- append only
  id           uuid primary key,                   -- made on the client; makes a repeat harmless
  user_id      uuid not null,
  card_id      uuid not null references app.card on delete cascade,
  answered_at  timestamptz not null,               -- client time; a time in the future is set to now
  received_at  timestamptz not null default now(),
  rating       smallint not null,                  -- Rating
  grade        text not null,                      -- Grade, as the server graded it
  overridden   boolean not null default false,     -- the learner changed the rating
  typed        text,
  expected     text,
  variant      smallint,
  duration_ms  integer,
  state_before jsonb,
  state_after  jsonb,
  client_id    text,
  diagnosis    jsonb
);
create index on app.review (user_id, answered_at);
create index on app.review (card_id, answered_at);

create table app.attempt (                         -- append only
  id          uuid primary key,                    -- made on the client
  user_id     uuid not null,
  source      text not null,                       -- 'trainer' | 'lesson' | 'review' | 'placement' | 'tutor'
  source_ref  text,                                -- session, review, placement or tutor error id
  exercise_id text,
  lemma_id    integer,
  g_case      text not null,
  g_number    text not null,
  g_gender    text,
  pattern     text,
  trigger_id  text,
  correct     boolean not null,
  retry       boolean not null default false,
  diagnosis   text,                                -- Diagnosis
  error_type  text,                                -- ErrorType
  given       text,
  expected    text,
  given_case  text,
  occurred_at timestamptz not null,
  duration_ms integer
);
create index on app.attempt (user_id, g_case, g_number, g_gender, occurred_at desc);

create table app.lesson_progress (
  user_id      uuid not null,
  lesson_id    text not null,
  status       text not null,                      -- LessonStatus
  step_index   smallint not null default 0,
  score        jsonb,
  started_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table app.text (
  id                 uuid primary key,             -- made on the client
  user_id            uuid not null,
  title              text not null,
  body               text not null,
  source             text not null,                -- 'paste' | 'library' | 'generated' | 'url'
  source_ref         text,
  analysis           jsonb,                        -- TextAnalysis
  analysis_version   smallint,
  status             text not null default 'processing', -- TextStatus
  error              text,
  token_count        integer,
  unique_lemma_count integer,
  coverage           real,
  coverage_at        timestamptz,
  last_opened_at     timestamptz,
  progress           jsonb not null default '{}',  -- { sentence }
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on app.text (user_id, archived, last_opened_at desc);

create table app.conversation (
  id             uuid primary key,                 -- made on the client
  user_id        uuid not null,
  scenario_id    text not null,
  mode           text not null,                    -- 'scenario' | 'case_coach'
  status         text not null default 'active',   -- 'active' | 'completed' | 'abandoned'
  goal_state     jsonb not null default '{}',      -- { criteriaMet: [id] }
  turn_count     integer not null default 0,
  summary        jsonb,
  model          text,
  prompt_version text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  updated_at     timestamptz not null default now()
);

create table app.message (
  id              uuid primary key,
  user_id         uuid not null,
  conversation_id uuid not null references app.conversation on delete cascade,
  seq             integer not null,
  role            text not null,                   -- 'tutor' | 'learner' | 'system_note'
  content         text not null,
  annotations     jsonb,                           -- error marks on a learner message
  usage           jsonb,
  client_id       uuid,                            -- learner messages: made on the client
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq),
  unique (conversation_id, client_id)
);

create table app.tutor_error (
  id                 uuid primary key,
  user_id            uuid not null,
  conversation_id    uuid not null references app.conversation on delete cascade,
  message_id         uuid not null references app.message on delete cascade,
  span_start         integer not null,
  span_end           integer not null,
  given              text not null,
  expected           text not null,
  corrected_sentence text,
  error_type         text not null,                -- ErrorType
  case_expected      text,
  case_given         text,
  lemma_id           integer,
  trigger_id         text,
  explanation_en     text,
  severity           text not null,                -- 'case' | 'other'
  verified           boolean not null default false,
  status             text not null,                -- TutorErrorStatus
  note_id            uuid references app.note on delete set null,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create table app.placement (
  id           uuid primary key,                   -- made on the client
  user_id      uuid not null,
  status       text not null default 'active',     -- 'active' | 'completed' | 'abandoned'
  items        jsonb not null default '[]',        -- every item shown, with the answer given
  result       jsonb,                              -- PlacementResult
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table app.ai_call (                         -- append only; counts and cost, never content
  id                 uuid primary key,
  user_id            uuid not null,
  route              text not null,                -- AiRoute
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           numeric(10, 6) not null default 0,
  latency_ms         integer,
  status             text not null,                -- 'ok' | 'refused' | 'truncated' | 'error'
  request_id         text,
  created_at         timestamptz not null default now()
);
create index on app.ai_call (user_id, created_at);

create table app.content_report (
  id          uuid primary key,                    -- made on the client
  user_id     uuid not null,
  target_kind text not null,                       -- 'exercise' | 'sense' | 'sentence' | 'lesson' | 'tutor_error' | 'analysis_token'
  target_ref  text not null,
  comment     text,
  status      text not null default 'open',        -- 'open' | 'resolved'
  created_at  timestamptz not null default now()
);
```

### Rules for this schema

- **Row level security on every table, enabled and forced.** The policy compares `user_id` with `(select auth.uid())` for the role `authenticated`, in both the `using` and the `with check` clause.
- **Append only tables.** `review`, `attempt` and `ai_call` have policies for select, insert and delete, and none for update.
- **Check constraints** on every enum column are built from the lists in `contracts`.
- **No mastery, session or capture tables.** Mastery is computed from `attempt`. A trainer session lives only in its response. A capture is a note.
- **Derived state can be rebuilt.** A card's state follows from replaying its reviews. Coverage follows from `user_lemma` and card stability.
- **A CI test lists the tables of the schema** and fails if one lacks `user_id`, a policy, or forced row level security.
- **In tests,** the test kit creates the role `authenticated` and a function `auth.uid()` that reads the request claim, as Supabase does. The same migrations then run on both.

The API logs in as the role `app_api`, which package F3 creates. It owns no table, cannot bypass row level security, and may switch to `authenticated`. On its own it reads schema `ling`, writes glosses to `ling.sense`, and holds no rights on schema `app`.

## API conventions

Every endpoint follows the same rules, so a client package can guess the behaviour of an endpoint it has never called.

- **Base path and login.** All paths start with `/api/v1`. Every endpoint except `GET /health` needs the header `Authorization: Bearer <access token>`.
- **Naming.** JSON uses camelCase. The database uses snake_case. The mapping happens in `repo.ts`.
- **Validation.** Path, query and body are validated with the contract schema before the handler runs. Responses are validated in tests and in local mode.
- **Repeats are harmless.** Creating a row with an id the learner already owns returns the stored row with status 200. Batch endpoints skip items they already hold and report them as accepted.
- **Time.** The server clock decides what is due. A client timestamp in the future is set to the server time.
- **Paging.** Lists take `cursor` and `limit` and return `nextCursor`, which is null at the end. The default limit is 50 and the maximum is 200.
- **Streaming.** Only the tutor message endpoint streams. It answers a POST with `text/event-stream`, and the client reads it with fetch.
- **Limits.** A request body may be 256 KB. A text import may be 20,000 characters and a tutor message 1,000.
- **Rate limits.** 20 tutor messages a minute and 10 text imports an hour, counted in the database.
- **Versions.** Changes inside `v1` only add. A breaking change is a contract change that updates both sides in one pull request.

### Errors

Every error has the shape `{ "error": { "code": "...", "message": "...", "details": { } } }`.

| Code | Status | When |
|---|---|---|
| `validation_failed` | 400 | The request does not match the schema. `details` lists the fields. |
| `unauthorized` | 401 | The token is missing, invalid or expired |
| `forbidden` | 403 | The learner is signed in but may not do this |
| `not_found` | 404 | No such row for this learner. Rows of other learners look the same. |
| `conflict` | 409 | The id exists with other content, or the state does not allow the action |
| `rate_limited` | 429 | Too many calls. `details.retryAfterSeconds` says when to retry. |
| `budget_exceeded` | 429 | The daily model budget is used up. `details.resetsAt` says when it returns. |
| `upstream_failed` | 502 | The model or the login service failed |
| `internal` | 500 | Anything else. The message never carries internals. |

## API endpoints

The API has 45 endpoints in nine modules. Shapes in capitals are defined under Shared data shapes or follow directly from the table columns.

### System and profile

| Method and path | Request | Response |
|---|---|---|
| `GET /health` |  | `{ ok, version, contentVersion }`, no login needed |
| `GET /me` |  | `Profile`. The first call creates the profile. |
| `PATCH /me` | Any of the settings columns of `app.profile` | `Profile` |
| `DELETE /me` |  | 204. Deletes every learner row and the login. |
| `GET /me/export` |  | All learner rows as one JSON file |
| `GET /today` |  | `Today`: review counts, the text to continue, the next lesson, weak buckets, a tutor suggestion, word band progress |
| `GET /stats/summary` |  | Reviews per day for 7 days, retention over 30 days, words known and learning, mastery per bucket |

### Review

| Method and path | Request | Response |
|---|---|---|
| `GET /review/queue` | `limit` | `{ items: ReviewItem[], counts: { due, new, learning }, serverTime }` |
| `POST /review/answers` | `{ clientId, answers: ReviewAnswer[] }` | `{ results: [{ id, cardId, grade, rating, card: CardSnapshot }], counts }` |
| `GET /notes` | `kind`, `q`, `cursor`, `limit` | `{ items: NoteSummary[], nextCursor }` |
| `GET /notes/:id` |  | `NoteDetail`: the note, its card and its last reviews |
| `POST /notes` | `{ id, kind, ... }`: a word with its reader context, a phrase, or a manual note | `NoteDetail` |
| `PATCH /notes/:id` | `{ suspended?, content? }` | `NoteDetail` |
| `DELETE /notes/:id` |  | 204. The note is marked deleted and leaves the queue. |

### Words and placement

| Method and path | Request | Response |
|---|---|---|
| `GET /words/bands` |  | `{ bands: [{ band, fromRank, toRank, total, known, learning, unknown }] }` |
| `GET /words` | `band`, `status`, `cursor`, `limit` | `{ items: [{ lemmaId, lemma, pos, rank, glossEn, status, topForms }], nextCursor }` |
| `POST /words/triage` | `{ decisions: [{ lemmaId, decision }] }`, where a decision is `known`, `learn` or `ignored` | `{ updated, notesCreated }` |
| `GET /lemmas/:id` |  | `LemmaDetail`: senses, the full table of forms, sentences, status and the learner's note id |
| `PUT /lemmas/:id/status` | `{ status }` | `{ lemmaId, status }` |
| `POST /placement` | `{ id }` | `PlacementRun` with its first round |
| `POST /placement/:id/answers` | `{ round, answers: [{ itemId, choice? , typed? }] }` | `{ status, round?, result? }`: the next round, or the result after the last one |
| `GET /placement/:id` |  | `PlacementRun` |

### Reader

| Method and path | Request | Response |
|---|---|---|
| `POST /texts` | `{ id, title?, body }` | 202 with `{ id, status: "processing" }` |
| `GET /texts` | `archived`, `cursor`, `limit` | `{ items: TextSummary[], nextCursor }` |
| `GET /texts/:id` |  | `TextDetail`: body, status, `TextAnalysis`, the status of each lemma in it, saved phrases, reading position, coverage |
| `PATCH /texts/:id` | `{ title?, progress?, archived? }` | `TextSummary` |
| `DELETE /texts/:id` |  | 204 |
| `POST /texts/:id/sentences/:n/translation` |  | `{ n, en }`. The translation is stored in the analysis. |
| `GET /library` |  | `{ items: [{ id, title, level, tokenCount, coverage, textId? }] }` |
| `POST /library/:id/add` | `{ id }`, the id of the new text | `{ id, status }` |

A capture in the reader uses `POST /notes`. Marking a word known or ignored uses `PUT /lemmas/:id/status`.

### Declension

| Method and path | Request | Response |
|---|---|---|
| `GET /declension/course` |  | `{ lessons: [{ id, ord, titleEn, titleSk, case, number, status, score }], mastery: BucketMastery[] }` |
| `GET /declension/lessons/:id` |  | `LessonDetail`: the lesson, its steps with their exercises as `ExerciseItem`, its triggers, and the learner's progress |
| `PUT /declension/lessons/:id/progress` | `{ stepIndex, status?, score? }` | `LessonProgress`. Completing a lesson creates its review cards. |
| `POST /declension/sessions` | `{ mode, lessonId?, size, seed? }`, where a mode is `lesson`, `mixed` or `weak` | `{ sessionId, seed, items: ExerciseItem[] }` |
| `POST /declension/attempts` | `{ attempts: AttemptInput[] }` | `{ accepted, cardsCreated, mastery: BucketMastery[] }` |
| `GET /declension/patterns/:id` |  | `PatternDetail`: label, model words, the table of endings, notes |

### Tutor and reports

| Method and path | Request | Response |
|---|---|---|
| `GET /tutor/scenarios` |  | `{ items: [{ id, mode, titleEn, titleSk, goalEn, level, targetCases, timesDone }] }` |
| `POST /tutor/conversations` | `{ id, scenarioId }` | `ConversationDetail` with the tutor's opening message |
| `GET /tutor/conversations` | `cursor`, `limit` | `{ items: ConversationSummary[], nextCursor }` |
| `GET /tutor/conversations/:id` |  | `ConversationDetail`: conversation, messages and errors |
| `POST /tutor/conversations/:id/messages` | `{ clientId, content }` | An event stream, see Shared data shapes |
| `POST /tutor/conversations/:id/peek` | `{ kind, messageId?, errorId? }`, where a kind is `translate`, `hint` or `answer` | `{ text }` |
| `POST /tutor/conversations/:id/end` |  | `{ summary, cardsCreated }` |
| `POST /tutor/errors/:id/dispute` | `{ comment? }` | `{ id, status: "disputed" }` |
| `POST /reports` | `{ id, targetKind, targetRef, comment? }` | 201 with `{ id }` |

### What the contracts package holds for each endpoint

- A name, such as `review.submitAnswers`, with method and path.
- Zod schemas for path, query, body and response.
- At least one example request and response in `fixtures/`. The examples use words from the mini Slovak dataset, so mocks and tests agree.
- For the tutor stream, an example sequence of events.

## Shared data shapes

These shapes cross more than one package, so they are fixed here. Package F2 writes each one as a zod schema, and the TypeScript below is the specification. `Span` is `{ start: number; end: number }` in characters.

### Review

```ts
type ReviewItem = {
  cardId: string; noteId: string; kind: NoteKind; state: CardState; dueAt: string | null;
  prompt: {
    sentenceSk: string;            // the whole sentence
    blank: Span;                   // the part to hide
    sentenceEn: string;
    cue?: string;                  // base form shown for a case sentence: 'nové mesto'
    glossEn?: string;              // word and phrase notes
  };
  answers: string[];               // accepted answers, the first is shown as the solution
  formMap: Record<string, string[]>; // every form of the target word -> form tags, for diagnosis
  explain?: { case?: Case; number?: Number; triggerLabel?: string; patternId?: string };
  variant: number;                 // which sentence of the note this is
  scheduler: unknown;              // opaque state for packages/srs
};

type ReviewAnswer = {
  id: string; cardId: string; answeredAt: string; typed: string; variant: number;
  clientGrade: Grade; rating: Rating; overridden: boolean; durationMs: number;
};

type CardSnapshot = {
  cardId: string; state: CardState; dueAt: string | null;
  stability: number | null; difficulty: number | null; reps: number; lapses: number;
  scheduler: unknown;
};
```

`packages/srs` exports four functions, and no other code imports ts-fsrs.

```ts
newState(now: Date): SchedulerState
schedule(state: SchedulerState, rating: Rating, now: Date, opts: { desiredRetention: number }): { state: SchedulerState; snapshot: CardSnapshot }
replay(reviews: { rating: Rating; answeredAt: Date }[], opts: { desiredRetention: number }): { state: SchedulerState; snapshot: CardSnapshot }
gradeAnswer(typed: string, answers: string[], formMap: Record<string, string[]>, opts: { strictDiacritics: boolean }): { grade: Grade; rating: Rating; diagnosis: Diagnosis }
```

### Notes

```ts
type NoteContent =
  | { kind: 'word'; lemmaId: number; lemma: string; glossEn: string;
      variants: { sentenceId?: string; sentenceSk: string; sentenceEn: string; blank: Span; answer: string; tag: string }[] }
  | { kind: 'phrase'; textSk: string; glossEn: string;
      context: { sentenceSk: string; sentenceEn: string; blank: Span } }
  | { kind: 'case_sentence'; exerciseId?: string; sentenceSk: string; sentenceEn: string; blank: Span;
      cue: string; answers: string[]; features: { case: Case; number: Number; gender?: Gender };
      lemmaId?: number; triggerId?: string };
```

### Text analysis

Field names are short because one text holds hundreds of tokens.

```ts
type TextAnalysis = {
  v: 1;
  sentences: {
    s: number; e: number;          // character offsets in the body
    en?: string;                   // translation, filled on request
    tokens: {
      s: number; e: number;
      t: 'word' | 'num' | 'punct';
      l?: number;                  // lemma id
      tag?: string;                // the form tag of the chosen reading
      m?: ReadingMethod;           // how the reading was chosen
      trig?: { i?: number; kind: TriggerKind; id?: string };  // i: index of the trigger token in this sentence
    }[];
  }[];
  lemmas: Record<string, { lemma: string; pos: Pos; gender?: Gender; gloss: string[] }>;
};
```

`packages/ling` exports the sentence splitter and the tokenizer, and the analyzer and the pipeline both call them. Offsets always point into the text as it was given.

```ts
splitSentences(text: string): Span[]
tokenize(text: string): { s: number; e: number; t: 'word' | 'num' | 'punct' }[]
```

### Exercises, attempts and mastery

```ts
type ExerciseItem = {
  exerciseId: string; kind: ExerciseKind;
  sentenceSk: string; sentenceEn: string; blank: Span;
  cue: string;                     // base form: 'nový dom'
  answers: string[];
  options?: { text: string; correct: boolean }[];   // choice kinds only
  features: { case: Case; number: Number; gender: Gender; pattern?: string };
  trigger?: { id: string; kind: TriggerKind; label: string };
  formMap: Record<string, string[]>;               // every form of the target word -> form tags
  siblingEndings?: Record<string, string>;         // pattern id -> the ending that pattern has for this tag
};

type AttemptInput = {
  id: string; sessionId?: string; source: 'trainer' | 'lesson'; exerciseId: string;
  typed: string; correct: boolean; retry: boolean; clientDiagnosis: Diagnosis;
  occurredAt: string; durationMs: number;
};

type BucketMastery = {
  case: Case; number: Number; gender: Gender;
  attempts: number; mastery: number;               // 0 to 1
  level: 'unseen' | 'weak' | 'ok' | 'strong';
};

type LessonStepContent =
  | { kind: 'explain'; md: string; examples: { sk: string; en: string; highlight: Span }[] }
  | { kind: 'triggers'; triggerIds: string[] }
  | { kind: 'comprehension' | 'production' | 'checkpoint'; exerciseIds: string[]; passShare?: number };
```

Diagnosis runs in this order, and the first match wins. `packages/ling` exports it as `diagnoseForm`, and the client and the server both call it.

- The normalised answer equals an accepted answer: `correct`.
- It equals another key of `formMap`: `other_case`, with that form's tags.
- Its folded form equals the folded form of an accepted answer: `diacritics`.
- It equals the stem plus an ending from `siblingEndings`: `wrong_pattern`, with that pattern.
- Anything else: `not_a_form`.

A diagnosis maps to an error type by the trigger. `other_case` becomes `case_after_preposition`, `case_after_verb` or `case_after_numeral` by the kind of trigger, and `case_other` without one. `wrong_pattern` becomes `pattern_ending`, or `genitive_plural` when that form was expected. `diacritics` becomes `spelling`, and `not_a_form` becomes `other`.

Mastery of a bucket is `sum(w * x) / sum(w)` over its last 30 attempts, newest first. The weight `w` of attempt number `i` is `0.9 ^ i`. The value `x` is 1 for a correct first try, 0.5 for a correct retry and 0 for a wrong answer. With fewer than 5 attempts the level is `unseen`. Below 0.6 it is `weak`, from 0.85 it is `strong`, and between them `ok`.

### Tutor stream

The message endpoint sends these events in this order: one `analysis`, many `delta`, one `done`. An `error` event can replace any of them and ends the stream.

```text
event: analysis
data: {"messageId":"...","errors":[{"id":"...","start":19,"end":26,"given":"kamarát","errorType":"case_after_preposition","status":"prompted"}],"resolved":[]}

event: delta
data: {"text":"S kým si bol "}

event: done
data: {"tutorMessage":{"id":"...","seq":8,"content":"S kým si bol v kine?"},"cardsCreated":[],"goal":{"criteriaMet":["c1"]},"budget":{"remainingUsd":0.71}}

event: error
data: {"code":"upstream_failed","message":"..."}
```

An error with the status `prompted` carries no `expected` form, so the client cannot reveal the answer by accident. The form arrives once the status is `corrected`.

The route `tutor.analyze` must return this JSON, and package B9 owns its zod schema.

```ts
type TutorAnalysis = {
  errors: {
    start: number; end: number; given: string; expected: string; correctedSentence: string;
    errorType: ErrorType; lemma?: string; caseExpected?: Case; caseGiven?: Case;
    trigger?: string; explanationEn: string;
  }[];
  retries: { errorId: string; fixed: boolean }[];   // earlier prompted errors the learner answered
  goalUpdates: { criterionId: string; met: boolean }[];
  meaningOk: boolean;                               // false when the message cannot be understood
};
```

### Placement

```ts
type PlacementItem =
  | { itemId: string; kind: 'vocab'; lemmaId: number; lemma: string; options: string[] }  // English meanings, the last is "I don't know"
  | { itemId: string; kind: 'case'; sentenceSk: string; sentenceEn: string; blank: Span; cue: string };

type PlacementRun = { id: string; status: 'active' | 'completed' | 'abandoned'; round?: { round: number; items: PlacementItem[] }; result?: PlacementResult };

type PlacementResult = {
  knownUpToRank: number;            // 0, 500, 1000 ... 3000
  lessonsTestedOut: string[];
  startLessonId: string;
  buckets: { lessonId: string; correct: number; total: number }[];
};
```

- The vocabulary part has 3 rounds of 12 words over six strata of 500 ranks. Round 1 takes two words from each stratum. Rounds 2 and 3 take their words around the first stratum with a miss.
- A stratum counts as known when at least 85% of its sampled words were right.
- The case part is one round of 16 typed gaps, two for each of the eight teaching lessons. A lesson is tested out when both are right.
- The server grades every round, and items carry no answers.
- Applying the result marks the lemmas up to `knownUpToRank` as known, sets the tested out lessons, and sets the lesson to start with. Each case answer is also logged as an attempt.

### Content files

The pipeline writes a content set as files in one folder, and `loadContent(db, folder)` from `packages/db` loads it. The mini Slovak dataset is a content set too.

| File | One row holds | Loads into |
|---|---|---|
| `lemmas.jsonl` | A lemma with key, part of speech, gender, pattern, rank, top forms, flags | `ling.lemma` |
| `forms.jsonl` | `{ lemmaId, form, tags }` | `ling.form` |
| `senses.jsonl` | A gloss with its source | `ling.sense` |
| `sentences.jsonl` | A sentence with tokens and its links to lemmas | `ling.sentence`, `ling.lemma_sentence` |
| `triggers.jsonl` | A trigger | `ling.trigger` |
| `patterns.jsonl` | A pattern with endings | `ling.pattern` |
| `lessons.jsonl` | A lesson with its steps | `ling.lesson`, `ling.lesson_step` |
| `exercises.jsonl` | An exercise | `ling.exercise` |
| `scenarios.jsonl` | A scenario | `ling.scenario` |
| `library.jsonl` | A text, with its analysis once made | `ling.library_text` |
| `manifest.json` | Version, sources with checksums and licences, row counts | `ling.content_version` |

## Internal ports

A port is an interface through which one API module uses another. Package F5 declares every port in `apps/api/src/ports.ts` and ships a stand in for each, so every backend package can start at once.

```ts
interface MorphologyPort {
  lookupForms(forms: string[]): Promise<Map<string, FormCandidate[]>>;  // keyed by the folded form
  getParadigm(lemmaId: number): Promise<Paradigm>;                      // every form with its tags
  verifyForm(form: string, want: { lemmaId?: number; case?: Case; number?: Number }): Promise<FormCandidate[]>;
  getLemma(lemmaId: number): Promise<Lemma | null>;
  findLemma(text: string, pos?: Pos): Promise<Lemma[]>;
}

interface DictionaryPort {
  getSenses(lemmaIds: number[]): Promise<Map<number, Sense[]>>;
  ensureGlosses(lemmaIds: number[], ctx?: { sentenceSk: string }): Promise<Map<number, string[]>>;  // asks the model for missing ones and stores them
}

interface NotesPort {
  createWordNote(tx: Tx, input: WordNoteInput): Promise<{ noteId: string; created: boolean }>;
  createPhraseNote(tx: Tx, input: PhraseNoteInput): Promise<{ noteId: string; created: boolean }>;
  createCaseSentenceNote(tx: Tx, input: CaseSentenceNoteInput): Promise<{ noteId: string; created: boolean }>;
  suspendNote(tx: Tx, noteId: string): Promise<void>;
  setLemmaStatus(tx: Tx, lemmaIds: number[], status: LemmaStatus, source: string): Promise<void>;  // one statement for the whole list
}

interface AttemptsPort {
  record(tx: Tx, attempts: AttemptRecord[]): Promise<void>;
  getMastery(tx: Tx): Promise<BucketMastery[]>;
}

interface AnalyzerPort {
  analyzeText(body: string, opts: { userId: string }): Promise<{ analysis: TextAnalysis; tokenCount: number; lemmaCounts: Record<number, number> }>;
}

interface AiGateway {
  structured<T>(req: { route: AiRoute; userId: string; system: PromptBlock[]; messages: ChatMessage[]; schema: ZodType<T>; maxTokens?: number }): Promise<{ data: T; usage: Usage }>;
  stream(req: { route: AiRoute; userId: string; system: PromptBlock[]; messages: ChatMessage[]; maxTokens?: number; onText: (delta: string) => void; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }>;
}

interface Clock { now(): Date }
interface IdGenerator { uuid(): string }
```

| Port | Real implementation | Used by |
|---|---|---|
| `MorphologyPort`, `DictionaryPort` | B2, in `modules/lexicon` | B1, B3, B5, B6, B9 |
| `NotesPort` | B1, in `modules/notes` | B5, B6, B9 |
| `AttemptsPort` | B5, in `modules/declension` | B1, B6, B7, B9 |
| `AnalyzerPort` | B3, in `modules/analyzer` | B4 |
| `AiGateway` | B8, in `packages/ai` | B2, B3, B4, B9 |
| `Clock`, `IdGenerator` | F5, in `platform` | Every module |

### How a stand in becomes real

- F5 creates each provider folder with a `port.ts` that exports a factory. The factory returns the stand in from `apps/api/src/testing`.
- `container.ts` calls those factories and never changes again.
- The owning package replaces the body of its own `port.ts`. No other file is touched.
- `apps/api/src/testing` holds one test suite per port. The stand in and the real implementation must both pass it.
- The gateway is the one port that lives outside the API. F5 writes the first version of `packages/ai/src` with the types, a mock, a test suite and `createGateway(config)`. B8 then takes the folder over.
- F5 also creates the six prompt folders under `packages/ai/prompts`, each with an `index.ts` and a placeholder version. The owner of a route replaces the content of its folder.

The stand ins for morphology and dictionary read the mini Slovak dataset from memory. The stand in gateway returns scripted answers by route.

### Who writes which table

A module may read any table from its own `repo.ts`, because the schema is frozen in phase 0. Each table has one module that writes it. Other modules change it only through that module's port, apart from the three cases named in the last column.

| Table | Written by | How others change it |
|---|---|---|
| `profile` | The profile module. The platform creates the row. | Placement sets `placement_done_at` and `current_lesson_id` itself. |
| `user_lemma`, `note`, `card`, `review` | The review and notes modules | Through `NotesPort` |
| `attempt`, `lesson_progress` | The declension module | Through `AttemptsPort`. Placement inserts `tested_out` rows itself, for lessons that have no row yet. |
| `text` | The reader module | Not at all |
| `placement` | The placement module | Not at all |
| `conversation`, `message`, `tutor_error` | The tutor module | Not at all |
| `content_report` | The reports module | The tutor module inserts one row itself for a dispute. |
| `ai_call` | The platform | Through the two usage functions in the gateway's config |
| `ling.sense` | The lexicon module, for glosses made at run time | Through `DictionaryPort.ensureGlosses` |

### Transactions

```ts
withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>   // sets role and claim; row level security applies
withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T>                 // no learner; reference data only
runInBackground(task: Promise<unknown>): void                          // waitUntil on Vercel, a tracked promise elsewhere
```

- A handler opens a transaction with `withUser` and passes `tx` down. A service never opens its own.
- No model call and no other network call happens while a transaction is open.
- `withUser` runs `set local role authenticated` and sets `request.jwt.claims` for the transaction. Both end with it.
- `withSystem` runs as the API's own role, which holds no rights on learner tables. It reads reference data and stores glosses.

## Environment and run modes

Three switches turn each cloud part into its local stand in, and the same code runs in every mode.

### Server variables

| Variable | Values | Meaning |
|---|---|---|
| `APP_ENV` | `local`, `preview`, `production` | Where the app runs |
| `DB_MODE` | `postgres`, `pglite` | Real Postgres, or PGlite in the API process |
| `DATABASE_URL` | Connection string | On Supabase, the transaction pooler on port 6543 |
| `AUTH_MODE` | `supabase`, `dev` | Real token check, or the dev login |
| `SUPABASE_URL` | Project URL | Token issuer and the address of the public keys |
| `SUPABASE_SECRET_KEY` | Secret | Used only to delete a login when an account is deleted |
| `AI_MODE` | `anthropic`, `mock` | Real gateway, or the mock gateway |
| `ANTHROPIC_API_KEY` | Secret | Needed only when `AI_MODE` is `anthropic` |
| `AI_MODEL_<ROUTE>` | Model id | Optional model per route, for example `AI_MODEL_TUTOR_REPLY` |
| `AI_DAILY_BUDGET_USD` | Number, default `1.00` | The daily model budget per learner |

### Client variables

| Variable | Meaning |
|---|---|
| `VITE_API_BASE` | Base path of the API, default `/api/v1` |
| `VITE_AUTH_MODE` | `supabase` or `dev` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The only Supabase values the client may hold |
| `VITE_MOCK_API` | `true` starts the mock server in the browser. Client packages develop with it. |
| `VITE_SIGNUP` | `closed` hides sign up (the login link and `/signup`, which then goes to `/login`). Unset shows it. |

### Environments

| Environment | Database | Login | Model | Used for |
|---|---|---|---|---|
| Local | PGlite with the mini Slovak dataset | Dev login | Mock gateway | Every package in phases 0 and 1, CI, browser tests |
| Preview | Supabase development project | Supabase | Real with a low budget, or the mock until the key is set | Each pull request once F8 is done |
| Production | Supabase production project | Supabase | Real | The app on your phone |

### Local mode

- `pnpm dev` sets `DB_MODE=pglite`, `AUTH_MODE=dev` and `AI_MODE=mock`. It applies the migrations, loads the mini Slovak dataset and starts the API and the client.
- PGlite keeps its files in `.local/pgdata`. Deleting the folder resets the database.
- The dev login sends `Authorization: Bearer dev:<uuid>`. The API accepts it only when `AUTH_MODE` is `dev`.
- The API refuses to start with `AUTH_MODE=dev` or `AI_MODE=mock` when `APP_ENV` is `production`.

### Database connection

- The API uses the postgres.js driver with `prepare: false`, which the transaction pooler requires.
- Each function instance keeps a pool of at most 5 connections.
- Migrations run through a direct connection from CI, never from the API.
