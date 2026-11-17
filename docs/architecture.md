# Slovak learning app: technical architecture and build plan

> Snapshot of the Architecture tab of the plan document, exported on 2026-11-17 by package F1. From now on the repository is the source of truth.

2026-11-17 · @Zsolt

## Summary

The app is an installable web app with one API, one Postgres database, and the Claude API behind a single gateway. The build is split into 35 work packages in three phases, so up to ten agents with fresh context can work at the same time.

| Topic | Decision |
|---|---|
| App | An installable web app in React, as you chose on 17 November. It can be wrapped as a store app later. |
| Backend | One TypeScript API on Vercel, with the database and login on Supabase in Frankfurt |
| Model | Claude Opus 5.5 on every route, behind one gateway with a daily budget |
| Slovak data | Open morphology, frequency and dictionary data, built offline into verified content |
| Correctness | Every word form is checked against the morphology data. The model never has the last word on a form. |
| Offline | Reviews, the case trainer, word sorting and opened texts work without a connection |
| Cost | About $5 to $8 a month for the model and $40 to $80 once for content, both estimates. Hosting starts on free plans. |

### How the build runs

- Phase 0 has nine packages. They build the shared surfaces and freeze them.
- Phase 1 has twenty packages in three tracks that run side by side: content, backend and client.
- Phase 2 has six packages. They join the tracks, build the full content, tune the prompts and end with your test on your phone.
- Nine waves lead from an empty repository to the first release, and the largest wave has ten packages.

### What it needs from you

The first step is an empty private GitHub repository, attached to this project. Four more steps are listed under [What you need to do](#m9gt5mkxfnv.49828). Four choices in this plan are still proposals, listed under [Proposals that wait for your yes](#m9gt5mkxfnv.50281).

### How to read this document

- This tab explains the design and the phases.
- `docs/contracts.md` is the reference: folders, tables, endpoints, shared shapes and ports.
- `docs/work-packages.md` holds one specification per package and a brief that starts a fresh agent.

## Scope of the first release

The first release delivers the seven features from the [research report](https://claude.ai/artifact/XuxxtZyWWMz9YmP68aKTBT) and nothing else. Features the report lists as next or later wait, but the design already leaves a hook for each.

| Feature | What it must do | Built from |
|---|---|---|
| Login and saved progress | One account, with history kept across devices | Auth service, API, database |
| Placement check | A short adaptive check of the common words and of each case, which sets the starting point | Placement module, item bank from the content pipeline |
| Review deck | One spaced queue with typed answers for words, phrases and case sentences, with a daily cap | Review engine, offline queue in the client |
| Declension course and trainer | For each case: a meaning card, the triggers, understanding tasks, typed sentence cards, then mixed practice. Results tracked by case, gender and number | Declension module, exercise bank, morphology data |
| Reader with capture | Paste a text. Tap a word for its gloss, base form, case and trigger. Save words and phrases with their sentence. Show the share of known words | Text analyzer, dictionary, reader screens |
| Common words track | The 1,000 most frequent lemmas with their most used forms and example sentences, a quick pass to mark known words, then an extension to 3,000 | Frequency list and dictionary from the content pipeline |
| Tutor chat | Goal based scenarios and a case coach, with prompts to self correct, and errors that become review cards | Tutor module, Claude API through the AI gateway |

The report's assumptions still stand unconfirmed: level A2 to B1, English explanations, one learner, 20 to 30 minutes a day, text before voice. The design keeps each one cheap to change. Explanation language is a profile setting, and every row of learner data has an owner from the first day, so more users need no rework.

| Waits for a later release | Hook already in the design |
|---|---|
| Generated graded stories | Texts carry a source field, and the content pipeline already generates and verifies Slovak text |
| Listening and audio | Sentences, texts and tutor messages carry an optional audio reference |
| Progress view | Every graded answer is logged with its case, gender and number from the first day |
| Voice conversation | The tutor endpoint streams text today and can carry audio beside it later |
| Daily reminders | The service worker that enables web push is already installed |

## Stack

One language, TypeScript, runs the client, the API and the content pipeline. Every agent then works in the same toolchain and shares one set of types.

| Layer | Choice | Why |
|---|---|---|
| Client | React 19.3 on Vite 8.3, installable through vite-plugin-pwa 2.0 | Your choice of an installable web app. Agents can run it in a headless browser at phone size and check their own work. |
| Client routing and data | TanStack Router 1.170, TanStack Query 5.107 | Typed routes and cached server data with little code. |
| Client storage | Dexie 4.4 on IndexedDB | Holds the review queue, opened texts and unsent answers, so reviews work without a connection. |
| Styling | Tailwind CSS 4.3, Radix primitives (radix-ui 1.8), vaul 1.1 for bottom sheets | Accessible building blocks that suit a phone screen. |
| API | Hono 4.13 on Node 24 | Small handlers on web standards. The same code runs on Vercel, on a plain Node server and in tests. |
| Contracts | Zod 4.6 schemas in one shared package | One definition validates requests on the server and types the client. |
| Database | PostgreSQL on Supabase | A relational fit for cards, reviews and word forms, with a dashboard to inspect the data. |
| Data access | Drizzle ORM 0.45, drizzle-kit 0.31 | Typed queries that run unchanged on Supabase and on the test database. |
| Test database | PGlite 0.5, which is PostgreSQL 18 compiled to WebAssembly | Real Postgres inside the test process, row level security included. No Docker and no cloud account. |
| Login | Supabase Auth, tokens checked with jose 6.2 | Email and password work out of the box. The API verifies each token against the project's public keys. |
| Scheduling | ts-fsrs 6.0, which defaults to FSRS-7 | The scheduler family the research report recommends. |
| Model access | @anthropic-ai/sdk 1.9, model `claude-opus-5-5` | Streaming for the tutor, schema checked JSON for analysis, and the Batch API for content generation at half price. |
| Hosting | Vercel Hobby plan, Frankfurt region | Static files plus one function, deployed on every push, with a preview link for every pull request. |
| Tooling | pnpm 12 workspaces, TypeScript 7.0, Biome 2.6, Vitest 5.1, Playwright 1.65, MSW 3.0, GitHub Actions | One install, one lint and format tool, fast tests. |

Versions were read from the npm registry on 17 November 2026, and package F1 pins them exactly. Several are new major versions (Vite 8, TypeScript 7, Vitest 5, MSW 3, ts-fsrs 6). Agents must read the installed package's own documentation instead of trusting memory.

ts-fsrs 6 declares Node 24 as its minimum. The cloud containers default to Node 22 and ship Node 24 beside it, so the repository pins Node 24.

Two load bearing assumptions were tested in a scratch project while writing this plan. PGlite enforced row level security with the role switch described under Auth and security. ts-fsrs 6 scheduled cards with the fields the data model stores.

| Alternative | Why it is not the choice |
|---|---|
| Native app with Expo SDK 58 | You chose the web app. The API, the contracts and the content pipeline would stay the same, so this door remains open. |
| Next.js | Server rendering adds weight that an app like this, which must also work offline, does not need. |
| Supabase Edge Functions for the API | They run on Deno and need Docker for local runs. A Node function keeps tests and production identical. |
| Cloudflare Workers as host | An equal fit for the code. The free plan's CPU limit is tight for text analysis. Worth a second look if the app goes public. |
| Python for the content pipeline | A second language and toolchain for work that mostly parses files and calls the Claude API. |

## System overview

The app has four running parts: the web client, the API, the database with login, and the Claude API. A fifth part, the content pipeline, runs offline and fills the database with verified Slovak data.

Each arrow points from the caller to the part it calls. The API also checks every token against the public keys of the auth service.

Two rules keep the parts independent. The client talks only to the API, apart from login calls to the auth service. Only the API talks to the database and to Claude.

| Part | What it does | Where it lives |
|---|---|---|
| Web client | Screens, typed answers, the reader, a local cache and the queue of unsent answers | `apps/web`, served as static files |
| API | Validates every request, enforces ownership, runs scheduling, text analysis and the tutor turn | `apps/api`, one function under `/api` |
| Shared packages | Contracts, scheduling and grading, Slovak text helpers, the model gateway | `packages/*`, imported by client and API |
| Database | Learner data in schema `app`, reference data in schema `ling` | Supabase Postgres |
| Auth service | Sign up, sign in, token refresh | Supabase Auth |
| Claude API | Tutor replies, error analysis, choice between possible readings of a word form, glosses | Called only by the API and the pipeline |
| Content pipeline | Turns open Slovak data into the word list, dictionary, word forms, sentences and exercises | `tools/pipeline`, run by an agent or developer, never by the app |

### How the parts communicate

| From and to | Transport | What travels |
|---|---|---|
| Client to auth service | HTTPS through the Supabase client library | Email, password and six digit codes go up. An access token and a refresh token come back. |
| Client to API | HTTPS and JSON under `/api/v1`, with the access token as bearer | Batches of items come down, batches of answers go up. Every write carries an id made on the client, so a retry is harmless. |
| Client to API, tutor turn | One POST with a streamed response (server sent events) | The learner's message goes up. Error marks, reply text in chunks and a final result come down. |
| API to database | SQL over TLS through the Supabase connection pooler | Each learner query runs in a transaction that switches to that user's role, so row level security blocks every row the user does not own. |
| API to Claude API | HTTPS through the official SDK | Prompts go out. Streamed text or schema checked JSON comes back. One gateway logs tokens and cost and enforces a daily budget. |
| Pipeline to Claude API | Batch API | Content generation requests at half price. Results are verified before they are loaded. |
| Pipeline to database | Direct SQL with an admin connection | Bulk load of schema `ling`, started by hand or by CI. |

### Four patterns that repeat

- **Work in batches.** The client fetches a batch (review queue, trainer set, placement round, word band), works through it locally and submits the results in one call. Reviews and drills therefore survive a bad connection.
- **Rules before the model.** Word forms are checked against the morphology data. The model judges, generates and explains, but it is never the source of truth for a form.
- **Frozen shared surfaces.** Contracts, database schema and design tokens are created in phase 0. Later changes go through small dedicated pull requests.
- **Local mode.** Each cloud part has a stand in: PGlite for the database, a dev login, and a mock model gateway. One command runs the whole app on a laptop or in an agent's container with no cloud account.

## Repository and contracts

Everything lives in one repository, and one package in it, `contracts`, defines every shape that crosses a boundary.

```text
slovak-app/
├─ apps/
│  ├─ web/          React client, the installable web app
│  └─ api/          Hono API, one folder per module
├─ packages/
│  ├─ contracts/    Zod schemas, endpoint table, enums, example payloads
│  ├─ db/           Drizzle schema, migrations, transactions, content loader
│  ├─ srs/          Scheduler wrapper and answer grading
│  ├─ ling/         Tokenizer, tag parser, form diagnosis
│  ├─ ai/           Model gateway, prompts, mock gateway
│  └─ testkit/      Test database, factories, mini Slovak dataset
├─ tools/
│  ├─ pipeline/     Content pipeline CLI
│  └─ evals/        Model evaluation runners
├─ content/         Authored lessons, triggers, scenarios, generated seed files
└─ docs/            Architecture snapshot, work packages, handoff notes
```

Four rules make parallel work safe:

- **One direction of imports.** Apps import packages. Packages never import apps, and `contracts` imports nothing else from the repository. `srs` and `ling` do no input or output, so the same code grades an answer in the browser and on the server.
- **One definition per endpoint.** `contracts` holds the method, path, request schema, response schema and an example payload. The API validates against it, the client takes its types from it, and the client's mock server replays the examples. Client and API packages can therefore be built at the same time.
- **One schema, created early.** Phase 0 creates every database table. Feature packages fill in logic and do not add tables.
- **Owned folders.** Phase 0 wires every API module and every screen in as a stub. Later packages replace stubs inside their own folders and never edit a shared file.

The full reference, down to columns and fields, is in `docs/contracts.md`.

## Data model

The database has two schemas. `ling` holds Slovak reference data that is the same for everyone and is loaded by the pipeline. `app` holds what a learner creates, and every row in it has an owner.

| Reference table (`ling`) | Holds | Size |
|---|---|---|
| `lemma` | One row per dictionary word: base form, part of speech, gender, declension pattern, frequency rank, most used forms | About 99,000 |
| `form` | Every inflected form with its grammatical tags | About 1.1 million distinct forms |
| `sense` | English glosses | The top 3,000 lemmas first, then on demand |
| `sentence`, `lemma_sentence` | Example sentences with translation, linked to the lemma and form they show | Target 9,000 |
| `trigger` | Prepositions, verbs, numerals and question words with the case they demand | Target 200 |
| `pattern` | Declension patterns with model words and endings | About 20 |
| `lesson`, `lesson_step` | The declension course | 9 lessons |
| `exercise` | Case exercises with verified answers: gap sentences and meaning tasks | Target 2,000 |
| `scenario` | Tutor scenarios and case coach question sets | Target 12 |
| `library_text` | Starter reading texts, already analysed | Target 12 |
| `content_version` | Which content build is loaded | One row per load |

| Learner table (`app`) | Holds |
|---|---|
| `profile` | Settings: daily limits, time zone, level, explanation language |
| `user_lemma` | The status of each word for this learner: unknown, learning, known or ignored |
| `note` | One thing to remember: a word, a phrase or a case sentence, with its context |
| `card` | The schedule of a note: state, due date, stability, difficulty |
| `review` | Every answer ever given. Rows are never changed. |
| `attempt` | Every graded case form with its case, number, gender, trigger and error type |
| `lesson_progress` | Where the learner stands in each lesson |
| `text` | Imported and library texts with their analysis and reading position |
| `conversation`, `message` | Tutor chats |
| `tutor_error` | Each error the tutor found, how it was resolved, and the card it became |
| `placement` | Placement check runs and their results |
| `ai_call` | Tokens and cost of every model call |
| `content_report` | Reports from the "this looks wrong" button |

Four choices shape the model:

- **Answers are a log, card state is derived.** `review` and `attempt` are append only. A card's state can be rebuilt by replaying its reviews, which makes sync between devices safe.
- **The scheduler's state is opaque.** Each card stores the scheduler's own state as JSON, plus a few plain columns (state, due date, stability, difficulty) for queries. A scheduler upgrade changes the JSON, not the table.
- **Reference ids are stable.** Lemma ids come from an append only registry file. Sentences, exercises and lessons have stable text ids. Rebuilding content never orphans a learner's cards.
- **Ownership is enforced twice.** The API filters by user, and every `app` table also carries a row level security policy. A test fails the build if a table lacks one.

Columns, types and indexes are listed in `docs/contracts.md`.

## Auth and security

Login runs on Supabase Auth with email and password. The API trusts nothing but a verified token, and the database enforces ownership a second time.

### From login to a database row

- The learner signs up with email and password in the app. Supabase emails a six digit code, which the learner types into the app. Codes replace links because an emailed link on an iPhone opens in Safari, not in the installed app.
- The Supabase client library keeps the session on the device and refreshes the access token before it expires.
- Every API call carries the access token as a bearer header.
- The API verifies the token's signature against the project's public keys, checks issuer and expiry, and reads the user id from the `sub` claim.
- The API opens a transaction, switches to the `authenticated` database role and sets the user id as the request claim. Row level security policies compare each row's `user_id` with it.
- On the learner's first call the API creates the profile row.

Password reset uses the same code pattern. The public keys are served at `/auth/v1/.well-known/jwks.json` on the Supabase project URL.

The API logs in to the database as its own role, `app_api`. That role owns no table and cannot bypass row level security, so the policies also hold against a bug in the API.

### Risks and measures

| Risk | Measure |
|---|---|
| One user reads another's data | Row level security on every `app` table, plus a CI test that signs in as two users and proves isolation. Schemas `app` and `ling` are not exposed through Supabase's own data API. |
| Leaked secrets | The Claude API key and the database URL exist only in server environment variables. The client receives only the Supabase project URL and its publishable key. |
| Strangers signing up | For personal use, new sign ups are switched off in Supabase once your account exists. A public release turns them on with a captcha and its own mail sender, since the sender Supabase includes is limited to 2 emails an hour. |
| Runaway model cost | The gateway checks a daily budget per learner before each call, and tutor messages and text imports are rate limited. A spend limit on the API key in the Claude Console is the outer wall. |
| Hostile text in an import | Imported text is treated as data. The call that picks a reading can only return indexes into candidates the database supplied, and all model output is shown as plain text. |
| Oversized requests | Text imports are capped at 20,000 characters and tutor messages at 1,000. |
| Dev login in production | The dev login of local mode refuses to start when it detects the production environment. |
| Data loss | The Supabase free plan has no backups. A weekly GitHub Action dumps schema `app` to private storage. The Pro plan adds daily backups. |
| Privacy | The database sits in Frankfurt. Learner messages and imported texts go to the Claude API for processing. The `ai_call` log stores counts and costs, never content. An account deletion endpoint removes every row. |

## API

The API is one versioned JSON interface with nine modules. Each module belongs to one backend package and serves one or two screens.

| Module | Paths | Serves | Main calls |
|---|---|---|---|
| Profile | `/me`, `/today`, `/stats` | Onboarding, settings, home screen | Read and change settings. Get the plan for today with its counts. |
| Review | `/review`, `/notes` | Review session, deck | Fetch the queue. Submit a batch of answers. Create, edit and suspend notes. |
| Words | `/words`, `/lemmas` | Common words track, word detail | List bands with counts. List one band. Sort many words at once. Get one lemma with senses, forms table and sentences. |
| Placement | `/placement` | Placement check | Start a run. Answer a round. Get the result. |
| Reader | `/texts`, `/library` | Reader | Import a text. Open it with its analysis. Save the reading position. Translate one sentence. Add a library text. |
| Declension | `/declension` | Course and trainer | Get the course map and a lesson. Start a trainer session. Submit attempts. Get a pattern table. |
| Tutor | `/tutor` | Tutor chat | List scenarios. Start a conversation. Send a message and receive a streamed reply. Peek. End with a summary. Dispute a correction. |
| Reports | `/reports` | Every screen | File a "this looks wrong" report on any content item. |
| System | `/health` | Monitoring | Report the app version and the content version, without login. |

Six conventions hold for every endpoint:

- The base path is `/api/v1`. Bodies are JSON with camelCase field names.
- Errors share one shape, `{ error: { code, message, details } }`, with a fixed list of codes.
- Every write that creates something carries an id made on the client. A repeated call returns the stored result and changes nothing.
- Timestamps are ISO 8601 in UTC. The server clock decides what is due.
- Lists page with a cursor.
- Only the tutor message endpoint streams.

Every endpoint with its request and response shape is listed in `docs/contracts.md`.

## Review engine

One spaced queue holds words, phrases and case sentences. Answers are typed, graded by code shared between client and server, and scheduled by FSRS.

### Notes and cards

| Note kind | Comes from | Prompt | Typed answer |
|---|---|---|---|
| Word | Reader capture, common words track | The English gloss and a Slovak sentence with the word blanked | The word in the form the sentence needs |
| Phrase | Reader capture | The English meaning and the sentence with the phrase blanked | The phrase |
| Case sentence | Declension lessons, trainer mistakes, tutor errors | A sentence with a gap, the base form as cue, the English translation | The correct form of the word or phrase |

A word note carries several sentences, one for each of the word's most used forms, and each review shows the next one. The learner meets the frequent forms without extra cards.

### Grading

| Result | When | Default rating |
|---|---|---|
| Correct | The typed answer matches an accepted answer after trimming and lower casing | Good |
| Close | Only accents or capital letters differ, and the typed string is not another form of the same word | Hard |
| Wrong | Anything else | Again |
| Revealed | The learner asked to see the answer | Again |

Accents can change the case in Slovak: *mesta* is genitive singular and *mestá* is nominative plural. A typed string that matches another form of the word therefore counts as wrong, not close. For a case sentence the app looks the wrong answer up in the word's own table and names the case that was typed. The learner can change the rating after seeing the answer.

### Scheduling

- FSRS runs through ts-fsrs with default parameters and a target retention of 0.90, which is a profile setting.
- A new card repeats after 1 and 10 minutes before it enters long intervals. A forgotten card repeats after 10 minutes.
- The profile holds the daily caps. The defaults are 10 new cards and 80 reviews.
- A session shows cards in short steps first, then due reviews with the oldest first, then new cards. Reader captures come before common words.
- A word counts as known for text coverage once its card's stability passes 21 days.
- All scheduler calls go through four functions in `packages/srs`: new state, schedule, replay and grade. No other code imports ts-fsrs.

### Sync

- The client fetches the queue: due cards, today's new cards, everything needed to show and grade them, and each card's scheduler state.
- The learner answers. The client grades and schedules locally and puts each answer in its outbox.
- The client posts the outbox as one batch when a connection exists.
- The server skips answers it already has, grades again, schedules, and stores the review and the new card state in one transaction.
- If an answer is older than the card's last review, because a second device was offline, the server replays that card's whole log in time order.
- The response carries the server's card states, which replace the client's own.

## Declension engine

Declension practice runs on rules and data, not on the model. The model only helps write practice sentences in the content pipeline, and every answer is checked against the morphology tables.

### The data it uses

| Data | Table | What it holds |
|---|---|---|
| Paradigms | `ling.form` | Every form of every lemma with its case, number and gender tags |
| Patterns | `ling.pattern` | The 14 noun patterns and the adjective patterns, with their endings |
| Triggers | `ling.trigger` | Words that demand a case: prepositions, verbs, numerals, quantity words, question words |
| Lessons | `ling.lesson`, `ling.lesson_step` | The course in order, with the steps of each lesson |
| Exercises | `ling.exercise` | Sentences with one gap, the accepted answers and the features under test |

A preposition that takes two cases is stored as two trigger rows that share a contrast group. The trainer can then drill *na stole* against *na stôl* on purpose.

### The course

The course has nine lessons, in the order the research report recommends.

| # | Lesson id | Covers |
|---|---|---|
| 1 | `acc-sg` | Accusative singular |
| 2 | `loc-sg` | Locative singular |
| 3 | `gen-sg` | Genitive singular |
| 4 | `ins-sg` | Instrumental singular |
| 5 | `dat-pron` | Dative, starting with pronouns |
| 6 | `nom-acc-pl` | Nominative and accusative plural |
| 7 | `loc-ins-dat-pl` | Locative, instrumental and dative plural |
| 8 | `gen-pl` | Genitive plural |
| 9 | `mixed` | All cases together |

Every lesson has the same five steps:

- **Meaning.** What the case does, with two or three examples.
- **Triggers.** The prepositions, verbs and question words that demand it.
- **Comprehension.** Choice items: pick the meaning, or pick the right form.
- **Production.** Typed gaps with a hint.
- **Checkpoint.** A short typed test. A score of 75% or more completes the lesson.

Finishing a lesson adds about ten of its sentences to the review deck, starting with the ones the learner got wrong. The order of lessons is a recommendation, and the learner can open any lesson.

### Trainer sessions

A trainer session is fetched as one batch and graded on the phone. The batch carries the accepted answers, the forms that are easy to confuse, and a map from each form of the word to its case. That is enough to grade and explain an answer without a network call.

There are three modes:

- `lesson` drills the current lesson.
- `mixed` drills everything unlocked so far.
- `weak` drills the buckets with the lowest mastery.

A bucket is one combination of case, number and gender, with animate and inanimate masculine counted apart. Mastery per bucket is a weighted average of the last 30 attempts, where newer attempts count more. It is computed from `app.attempt` on request, so no mastery table can drift out of sync.

Item selection follows three rules:

- A bucket's weight is its share in real text times one minus its mastery.
- At least 30% of the items come from strong buckets, so old material stays alive.
- Selection takes a seed. The same seed gives the same session, which makes tests exact.

### Diagnosis of a wrong answer

A wrong answer is looked up in the table of the expected word, and the lookup names what went wrong.

| Result | Meaning | Example |
|---|---|---|
| `correct` | Matches an accepted answer |  |
| `other_case` | A real form of the word, but another case | *do meste*: "That is the locative. After *do* comes the genitive: *mesta*." |
| `diacritics` | Right letters, accents missing or wrong, and not another form | *zenam* for *ženám* |
| `wrong_pattern` | An ending borrowed from another pattern | *z ulicy*: "*Ulica* is a soft noun: *z ulice*." |
| `not_a_form` | Not a form of this word | The answer is shown |

Each result maps to one value of the shared error list. Every graded form is written to `app.attempt`, whichever screen it came from: trainer, review, placement or tutor. Wrong trainer items become review cards, up to a daily cap.

### Patterns

Each noun gets its pattern by rule, from gender, animacy and its nominative and genitive endings. The noun patterns are chlap, hrdina, dub, stroj, kuli, žena, ulica, dlaň, kosť, gazdiná, mesto, srdce, vysvedčenie and dievča. Adjectives follow pekný and cudzí, with páví and otcov as rarer types.

The app shows an everyday word beside the traditional label, for example *muž* beside chlap. Adjective and noun pairs are drilled as whole phrases, because agreement is where the errors happen. Each case keeps one colour across the whole app.

The exercise payload, the diagnosis order and the mastery formula are in `docs/contracts.md`.

## AI integration

Every model call the app makes goes through one gateway, and no form the model proposes reaches the learner as a correction until the morphology data confirms it. The gateway lives in `packages/ai`, and no other code in the app imports the Anthropic SDK. The content pipeline sends its batches through a runner of its own.

### Routes

A route is one named kind of call, with its own prompt, output schema, effort level and token limit.

| Route | Used by | Returns | Effort | Mode |
|---|---|---|---|---|
| `tutor.analyze` | Tutor | The errors in the learner's message, as JSON | medium | Live |
| `tutor.reply` | Tutor | The tutor's next message | low | Live, streamed |
| `tutor.summary` | Tutor | The summary at the end of a conversation | medium | Live |
| `reader.disambiguate` | Text import | Which candidate reading fits each ambiguous word | low | Live |
| `reader.gloss` | Text import | English glosses for words the dictionary lacks | low | Live |
| `reader.translate` | Reader | The English translation of one sentence | low | Live |
| `content.sentences` | Pipeline | Example sentences for a word | medium | Batch |
| `content.exercises` | Pipeline | Case exercises for a bucket | medium | Batch |
| `content.glosses` | Pipeline | Glosses for words Wiktionary lacks | low | Batch |
| `content.review` | Pipeline | A second pass check of generated content | medium | Batch |

Every route uses `claude-opus-5-5` by default. The model is one setting per route, so a cheaper model can be tried on a single route once the evals exist to judge it.

### What the gateway does

- Loads the versioned prompt for the route from `packages/ai/prompts/<route>/v<N>.ts`.
- Requests JSON that must match a zod schema, or streams text.
- Puts the stable part of the prompt first and marks it for caching.
- Checks the stop reason. A refusal or a cut off answer becomes a typed error, never a half shown reply.
- Checks the learner's daily budget before the call, and records tokens and cost in `app.ai_call` after it.
- Leaves retries of short outages to the SDK, then fails with the error code `upstream_failed`.

A mock gateway with scripted answers stands in for it in tests and in local mode. Tests never call the real API.

### One tutor turn

Time runs from top to bottom, and each arrow is one call or one stream event. The six steps below describe the same turn.

- The API checks the login and the daily budget. It then loads the conversation, the scenario and the open errors in one short transaction.
- `tutor.analyze` reads the learner's message and returns each error: its position, the form given, the form expected, the error type, the lemma, both cases and the trigger. It also reports which earlier errors the learner has now fixed.
- The API verifies each case error against `ling.form`. The expected form must exist with the claimed case. If the form the learner typed is itself valid for that case, the error is dropped.
- The API decides what happens to each error, by the table below.
- `tutor.reply` writes the tutor's message from a directive the API builds: which question to ask, which verified forms it may confirm, and the goal to move toward. The text streams to the phone.
- A second short transaction stores both messages, the errors, any new cards, the attempts and the usage.

| Situation | What the learner sees | What is stored |
|---|---|---|
| Verified case error, first time | A short question such as *S kým?* and a chance to fix it. At most two per message. | Status `prompted` |
| The learner fixes it | A brief confirmation | Status `self_corrected`, and a correct attempt marked as a retry |
| The learner misses again | The correct form with a one line reason | Status `corrected`, and a case sentence card with the form blanked |
| Other slip: word order, vocabulary, spelling | Nothing during the chat | Status `summary_only`, shown in the end summary |
| Error that failed verification | Nothing during the chat | Status `summary_only`, flagged unverified, never a card |
| The learner taps "this looks wrong" | The card is suspended | Status `disputed`, plus a content report |

No network call runs inside a database transaction. The two model calls sit between the two transactions.

The stream carries four kinds of event: `analysis` with the errors found, `delta` with text, `done` with ids and saved cards, and `error`. The case coach is the same pipeline with another scenario type. Peek returns a translation or the answer and marks the item as revealed, so it never counts as known.

### Prompts and caching

The system prompt has a fixed order: role and rules, the error checklist, then the scenario. None of the three changes inside a conversation, so later turns pay a twentieth of the input price for them. The prompt holds no dates, names or other values that change per request.

### Evals

The evals need no hand labelling.

- Correct sentences come from the Slovak Universal Dependencies treebank. The tutor must find no error in them.
- Wrong sentences are made by swapping one noun phrase into another case with the morphology data. The tutor must find exactly that error.
- The text analyzer is scored against the treebank's hand checked lemmas and cases.

The eval package reports precision and recall per case and per kind of trigger. A prompt or model change ships only if those numbers hold.

### Cost

These figures are estimates from token counts at list prices, not measurements.

| Item | Estimate |
|---|---|
| One tutor turn (two model calls) | About $0.03 |
| One tutor conversation of ten turns | About $0.30 |
| One imported text of 600 words | About $0.07 |
| A month with three or four chats a week and twenty texts | About $5 to $8 |
| Building all content once through the Batch API | About $40 to $80 |

A daily budget per learner, $1.00 by default, caps the worst case. When it is reached, the tutor and text import answer with `budget_exceeded` and the rest of the app keeps working.

## Content pipeline

All reference content is built offline by one command line tool and loaded into the `ling` schema as a versioned set. The tool lives in `tools/pipeline`. Each stage reads files and writes files, so a stage can be built, tested and rerun on its own.

### Stages

| # | Stage | Reads | Writes |
|---|---|---|---|
| 1 | `fetch` | Source URLs | Raw files with checksums, and their licences in `content/SOURCES.md` |
| 2 | `morph` | SNK morphological database | Lemmas, forms with parsed tags, a pattern per noun and adjective, a quality report |
| 3 | `freq` | Araneum frequency lists, OpenSubtitles list | A rank for the 5,000 most common lemmas, and the most used forms of each |
| 4 | `dict` | Wiktionary extract from kaikki.org | English glosses. Gaps are filled by the model and flagged as generated. |
| 5 | `sentences` | Tatoeba, the UD treebank | Two or three example sentences per lemma, with translation |
| 6 | `triggers` | Authored YAML | Prepositions, verbs, numerals and question words with their cases |
| 7 | `lessons` | Authored files | Lessons, lesson steps and pattern notes |
| 8 | `exercises` | Triggers, forms, ranks | At least 40 verified exercises per bucket |
| 9 | `scenarios` | Authored YAML | Tutor scenarios and case coach sets |
| 10 | `library` | Authored and generated texts | 12 graded starter texts |
| 11 | `validate` | Everything above | Pass or fail against the content schemas, plus link checks between files |
| 12 | `load` | Validated files | Rows in `ling` and a new row in `content_version` |

The first release holds the 1,000 word track and its extension in the same data: ranks 1 to 1,000 form the first band, and ranks up to 3,000 the next two. No audio is generated yet. Sentences carry an optional audio path for a later release.

### Where files live

| Folder | In git | Holds |
|---|---|---|
| `content/authored/` | Yes | Triggers, lessons, pattern notes, scenarios, library texts |
| `content/generated/` | Yes | Model written and reviewed files: sentences, exercises, glosses |
| `content/registry/` | Yes | The lemma id registry |
| `content/raw/`, `content/build/` | No | Downloaded sources and the built morphology files |
| `packages/testkit/mini/` | Yes | The mini Slovak dataset that tests and local mode load |

### Rules the pipeline follows

- **Lemma ids never change.** The registry maps each lemma key to a number and only ever grows. Learner data points at these numbers.
- **Two sources set the rank.** A large web corpus gives coverage, and film subtitles pull everyday spoken words up.
- **Example sentences are short and easy.** A sentence qualifies with 4 to 12 words, other words within the 3,000 most common, and the target word in one of its most used forms.
- **Generated items are verified twice.** First by rule: the answer must be a real form with the right case, and wrong options must be real forms of other cases. Then by a second model pass.
- **Nothing generated is marked verified by default.** Each row records its source, and the app can show that a gloss was machine written.
- **Model answers are cached on disk.** A rerun of a stage sends only requests it has not seen, so reruns cost nothing.

### Text analysis at import

Analysing a learner's text happens in the API, not in the pipeline. It turns pasted text into tappable words, each with a lemma, a case and a trigger.

- Normalise the text and split it into sentences and words.
- Look up every word in `ling.form` with one query.
- Prune by rule. A preposition limits the case of the noun after it, and an adjective must agree with its noun.
- Send only the words still ambiguous to the model. It picks from the listed candidates and cannot invent a reading.
- Mark triggers and add glosses from the dictionary. The model writes the few glosses that are missing, and they are stored for next time.
- Compute coverage: the share of words the learner already knows.
- Store the result as one JSON document on the text.

Import answers at once with the status `processing`, and the phone polls until the text is ready. Each word records how its reading was chosen: single candidate, rule, model or guess. The reader can then show less certainty for a guess.

### Database size

The word forms are the only large table. A test with synthetic rows in PGlite measured about 150 bytes per row, both indexes included. The full morphology data should take 180 to 210 MB of the 500 MB that the Supabase free plan allows, and the load step has a rank limit as a fallback.

### Licences

| Source | Used for | Licence as stated by the source | Consequence |
|---|---|---|---|
| SNK morphological database | Forms and tags | Research purposes only, under AGPL 3, CC BY-SA 4.0 or GFDL 1.3 | Fine for personal study. Ask the institute before any public release. |
| Araneum Slovacum frequency lists | Ranks | None stated | Ask before a public release. |
| OpenSubtitles frequency list | Spoken ranks | CC BY-SA 4.0 | Credit the source. |
| Wiktionary through kaikki.org | Glosses | CC BY-SA | Credit the source and share derived data alike. |
| UD Slovak SNK treebank | Sentences and evals | CC BY-SA 4.0 | Credit the source. |
| Tatoeba | Sentences | CC BY 2.0 FR | Credit the source. |

The app carries an attribution page that lists these sources. Only the `morph` and `freq` stages know where their data came from, so a source can be replaced without touching the app.

## Mobile client

The client is one React app that installs to the home screen and keeps daily practice working without a connection. It lives in `apps/web`.

### Screens

| Tab | Routes | What happens there |
|---|---|---|
| Today | `/`, `/settings`, `/settings/about` | The plan for the day: reviews due, a text to continue, the next case lesson, a tutor suggestion |
| Review | `/review`, `/deck`, `/deck/$noteId`, `/words`, `/words/band/$band`, `/lemma/$lemmaId` | The typed review session, the deck, and the common words track |
| Read | `/read`, `/read/import`, `/read/$textId` | The library, pasting a text, and the reader |
| Cases | `/cases`, `/cases/lesson/$lessonId`, `/cases/train`, `/cases/pattern/$patternId` | The course, the trainer and the pattern tables |
| Tutor | `/tutor`, `/tutor/$conversationId` | The scenario picker and the chat |
| No tab | `/login`, `/signup`, `/verify`, `/reset`, `/onboarding`, `/placement` | Account screens and the first run |

### Code layout

Each feature owns one folder. `apps/web/src/features/<feature>/` holds its screens, components, hooks, mock handlers and tests.

Shared code lives in two places only: `apps/web/src/ui` for the design system, and `apps/web/src/lib` for the API client, login, local storage and sync. Phase 0 builds both and wires every route to a placeholder screen. A feature package then fills its own folder and never edits `ui`, `lib` or the route table.

That split is what lets six client packages run at the same time.

### State and offline

| Kind of state | Where it lives |
|---|---|
| Server data | The TanStack Query cache |
| Review queue, opened texts, word statuses, unsent writes | IndexedDB, through Dexie |
| A running session: review, trainer, chat input | A small reducer inside the feature |

The local database has five tables: `kv`, `reviewQueue`, `outbox`, `texts` and `lemmaStatus`.

Writes made offline wait in the outbox with the ids the client gave them. The outbox is sent when the app starts, when the connection returns, when the app comes to the foreground, after each new write, and on a manual sync. iOS offers no background sync, so the app never relies on one.

The service worker caches the app shell only. API data is stored by the app itself, so each kind of data has one clear owner.

| Feature | Works offline |
|---|---|
| Review | Yes, for the fetched queue |
| Case trainer | Yes, for the fetched session |
| Reader | Yes, for texts already opened |
| Sorting common words | Yes, for the fetched band |
| Text import, tutor chat | No, both need the server |

### Design system

The shared components are Button, Input, AccentBar, AnswerInput, Sheet, Card, Tabs, Toast, ProgressRing, CaseBadge, TokenText, EmptyState and Skeleton.

These rules hold on every screen:

- Answer fields set `lang="sk"` and switch off autocorrect, automatic capitals and spellcheck.
- The accent bar sits above the keyboard and offers á ä č ď é í ĺ ľ ň ó ô ŕ š ť ú ý ž.
- Text in input fields is at least 16 px, so iOS does not zoom the page.
- Tap targets are at least 44 px, and layouts respect the safe areas of the phone.
- Light and dark themes come from the same colour tokens.
- Interface text sits in one English messages file, so another language can be added later.

### Reader

Tapping a word opens a bottom sheet that is built from the stored analysis, with no network call. The sheet shows the gloss, the dictionary form, the case with its trigger, and the actions Save, Known and Ignore. A link opens the full table of forms.

Selecting several words offers Save phrase. The colour of a word shows its status: unknown, learning or known.

### Limits and checks

- The first load ships at most 200 KB of compressed JavaScript.
- Browser tests run at 390 by 844 pixels, the size of a current iPhone screen.
- On iOS the app shows a one time hint for Add to Home Screen, because Safari has no install prompt.
- Installed apps on iOS keep their own storage, apart from Safari. The learner signs in once more after installing.

## Build phases

The build has three phases and 35 work packages, and up to ten of them run at the same time. Phase 0 builds and freezes the shared surfaces. Phase 1 runs three tracks side by side. Phase 2 joins them and hardens the result.

The picture shows the phases, not the exact order. A phase 1 package starts as soon as its own dependencies have merged, so the phases overlap in time.

| Phase | Packages | What it produces | Agents at once |
|---|---|---|---|
| 0 Foundation | F1 to F9 | Repository, contracts, database, language and review core, mini Slovak dataset, API and client skeletons, design system, deploy path | 1 to 4 |
| 1 Content | C1 to C5 | Morphology, ranks, dictionary, sentences, declension content, scenarios, library | 1 to 3 |
| 1 Backend | B1 to B9 | Every API module, the text analyzer and the AI gateway | 9 |
| 1 Client | M1 to M6 | Every screen, built against mock data | 6 |
| 2 Integration | I1 to I6 | The real app end to end, full content, evals, offline hardening, production, acceptance | 1 to 3 |

### Why the tracks do not block each other

- **Client packages need no backend.** They build against mock handlers that replay the example payloads from the contracts.
- **Backend packages need no real content and no cloud account.** They build against the mini Slovak dataset in PGlite and against the mock gateway.
- **Content packages need no API.** They write files that must pass the content schemas.
- **Modules call each other through ports.** Package F5 ships every port with an in memory stand in and a shared test suite. The stand in and the real implementation must both pass that suite.

### Waves

A wave is a set of packages with no dependency on each other. All packages of a wave can start as soon as the wave before it has merged.

| Wave | Packages | Agents |
|---|---|---|
| 1 | F1 | 1 |
| 2 | F2, F7 | 2 |
| 3 | F3, F4, F6, F9 | 4 |
| 4 | F5, C1, M1 to M6 | 8 |
| 5 | B1 to B9, C2 | 10 |
| 6 | C3, C4, C5, F8, I1, I3 | 6 |
| 7 | I2, I4 | 2 |
| 8 | I5 | 1 |
| 9 | I6, with you on your phone | 1 |

With fewer agents, any wave can be split in two, in any order. Each package's exact dependencies are in its specification, so a package may also start early once its own dependencies have merged.

### What needs you

Five packages need something from you, and everything else runs in local mode with no account at all.

- F1 needs an empty GitHub repository.
- F8 needs your Supabase and Vercel accounts.
- I2 and I3 need a Claude API key and your approval of the estimated spend.
- I6 is your own test on your phone.

The content packages also download public data, so the project's cloud environment must allow those hosts.

## Work packages

Each package is sized for one agent with fresh context, owns its own folders and ends in one pull request. The table lists all 35. The full specifications are in `docs/work-packages.md`.

| Id | Package | Depends on | Delivers |
|---|---|---|---|
| F1 | Repository and tooling | Nothing | Monorepo, pinned versions, CI, `AGENTS.md`, empty workspace packages |
| F2 | Contracts | F1 | All schemas, the endpoint table, example payloads, content file schemas |
| F3 | Database and test kit | F2 | Tables, migrations, row level security, the PGlite test database, the content loader |
| F4 | Language and review core | F2 | `packages/ling` with the tokenizer, form tags and diagnosis, `packages/srs` with scheduling and grading |
| F5 | API skeleton | F3, F4, F9 | Hono app, token check, transactions, ports with stand ins, every route answering with examples, local mode |
| F6 | Client skeleton | F2 | App shell, route table with placeholders, API client, mocks, login plumbing, local database and outbox |
| F7 | Design system | F1 | Colour tokens and the 13 shared components, with a gallery page |
| F8 | Cloud setup and deploy path | F5, F6 | Supabase and Vercel environments, the migration workflow, a deployed preview |
| F9 | Mini Slovak dataset | F2 | 72 lemmas with full tables, and samples of every other content kind |
| C1 | Morphology import | F3, F4, F9 | Lemmas, forms, tags, patterns, the id registry, the pipeline skeleton with validate and load |
| C2 | Frequency ranks and dictionary | C1 | Frequency ranks, most used forms, English glosses, the batch runner |
| C3 | Example sentences | C2 | Two or three verified sentences for each of 3,000 lemmas |
| C4 | Declension content | C2 | Triggers, pattern notes, nine lessons, the exercise bank |
| C5 | Scenarios and starter library | C2 | Twelve tutor scenarios and twelve graded texts |
| B1 | Review engine and notes | F5 | The review queue, the answer batch with replay, notes |
| B2 | Lexicon services | F5 | The morphology and dictionary services behind their ports |
| B3 | Text analyzer | F5 | Text turned into words with lemma, case, trigger and gloss |
| B4 | Reader module | F5 | Texts, library, capture, coverage, sentence translation |
| B5 | Declension module | F5 | Course, lessons, trainer sessions, attempts, mastery |
| B6 | Words track and placement | F5 | Bands, sorting, word page data, the placement check |
| B7 | Profile, today, stats and reports | F5 | Settings, the plan for today, stats, reports, export, account deletion |
| B8 | AI gateway | F5 | The Anthropic implementation, budgets, the usage log, the prompt registry |
| B9 | Tutor module | F5 | Conversations, the turn pipeline, streaming, error cards |
| M1 | Account, onboarding, settings and Today | F6, F7 | Login screens, onboarding, settings, the home screen |
| M2 | Review session and deck | F4, F6, F7 | The review session with its offline queue, the deck screens |
| M3 | Reader | F6, F7 | Library, import, the reader with word sheet and phrase capture |
| M4 | Declension course and trainer | F4, F6, F7 | Course map, lesson player, trainer, pattern tables |
| M5 | Words track, word page and placement | F6, F7 | Bands, sorting, the word page, the placement check |
| M6 | Tutor chat | F6, F7 | Scenario picker, streamed chat, corrections, summary |
| I1 | End to end integration | B1 to B9, M1 to M6 | The client on the real API in local mode, with browser tests for the daily loop |
| I2 | Full content build and load | C1 to C5, B2, B3, B8, F8 | All content generated, verified and loaded |
| I3 | Model evals and prompt tuning | B2, B3, B8, B9, C1 | Eval sets, scores and tuned prompts |
| I4 | Offline, sync and install hardening | I1 | Offline flows, sync edge cases, install and update behaviour |
| I5 | Production readiness | F8, I1, I2 | Production deploy, security checks, backups, monitoring, attribution page |
| I6 | Acceptance on a real phone | I3, I4, I5 | The seven features checked on your phone |

Every specification has the same eight parts: goal, dependencies, what it unblocks, owned paths, what to read first, what to build, done criteria, and what is out of scope.

## Rules for agents

An agent starts with no memory of this project, so the repository must tell it everything. Package F1 copies this document into `docs/` and writes the rules below into `AGENTS.md`.

- **Read four things first:** `AGENTS.md`, the architecture snapshot, the contracts, and the one package specification.
- **Work only in the paths the package owns.** A needed change elsewhere becomes a small pull request of its own, merged first.
- **Never change contracts or the database schema inside a feature package.** A contract change is its own pull request that updates schema, example payload and both sides.
- **One branch and one pull request per package.** The branch is named `wp/<id>-<slug>`, and it merges only with CI green.
- **Use Node 24 and the pinned versions.** Read the installed package's own documentation instead of trusting memory, because several tools are new major versions.
- **Tests never call the real Claude API.** They use the mock gateway. Only the eval and content build packages spend money, and only with approval.
- **No network call inside a database transaction.**
- **Leave a handoff note** in `docs/handoff/<id>.md`: what was built, what differs from the plan, known gaps, and how to run it.

The full rules, the definition of done and a brief the coordinator can paste for a fresh agent are in `docs/work-packages.md`.

## Risks, licences and open questions

Nothing here blocks the build. Three points decide whether the app can ever go public: the licence of the morphology data, the hosting plans, and the accuracy of the model in Slovak.

### Risks

| Risk | Effect | Measure |
|---|---|---|
| The SNK morphological database is offered for research purposes only | Personal study is a defensible use. A public or paid app is not. | Write to the institute before any public release. Only the `morph` stage knows the source, so it can be swapped. |
| The Araneum frequency lists state no licence | The same limit | Ask in the same message. Ranks can be rebuilt from the subtitle list alone. |
| Wiktionary, the UD treebank and the subtitle list are share alike | Derived data must carry credit and the same licence | An attribution page in the app, and source and licence stored on each row |
| The Supabase free plan pauses a project after a week without activity and keeps no backups | The app stops until the project is resumed by hand | Daily use keeps it awake, and a weekly dump covers the data. The Pro plan, from $25 a month, removes both limits. |
| Vercel describes its Hobby plan as for personal, non commercial use | Not a home for a public product | Fine for your own use. The API runs on any Node host, so moving is a deploy change. |
| Several tools are new major versions | An agent may write code for the old API | Versions are pinned, and the rules send agents to the installed documentation. TypeScript 6 is the fallback if a tool lags behind. |
| The model's accuracy on Slovak cases is not benchmarked | A wrong correction would teach a mistake | Every correction is verified against the morphology data. Unverified ones never become cards. Evals gate every prompt change, and the learner can dispute. |
| The tutor needs two model calls before text appears | An estimated wait of 3 to 6 seconds | The error marks arrive first. The evals can try a faster model on the reply route. |
| iOS limits for installed web apps | No background sync, and emailed links open in Safari | Sync runs whenever the app is open. Login uses typed codes. |
| Model cost | A bug could run up a bill | A daily budget per learner, and a spend limit on the API key |
| Database size on the free plan | The word forms take an estimated 40% of the quota | Package C1 measures the real size. The load step has a rank limit as a fallback. |

### What you need to do

- Create an empty private GitHub repository and attach it to this project. Package F1 cannot start without it.
- Add a cloud environment for this project: in the project settings, open the Cloud environment menu and choose Add cloud environment. Under network access, allow the hosts of the data sources listed under Sources, of the Claude API, of Supabase and of Vercel. The content packages and package F8 work through it.
- Create a Supabase account with two projects in Frankfurt, one for development and one for production. Package F8 needs them.
- Create a Vercel account and import the repository. Package F8 needs it.
- Create a Claude API key with a monthly spend limit and add it as a secret of the environment. Packages I2 and I3 need it.

### Proposals that wait for your yes

| Proposal | Alternative |
|---|---|
| Supabase for database and login | Any Postgres host with another login service. The API code stays, the login screens change. |
| Vercel for hosting | Any Node host, or Cloudflare Workers |
| Claude Opus 5.5 on every route | A cheaper model on single routes, once the evals can compare them |
| Email and password with typed codes | Sign in with Google or Apple, added later through Supabase |

### Open questions from the research report

The answers change settings and content, not the architecture.

| Question | What the answer changes |
|---|---|
| Your first language, and the language of explanations | The explanation language setting, and the wording of lessons and prompts |
| Your goal: daily life, work or an exam | Which scenarios and texts come first |
| Minutes per day | The default daily caps |
| Voice in the first release or later | Nothing now. The plan keeps voice for a later release. |
| Personal tool or public product | Licences, hosting plans, open sign up and a privacy page |

### Sources

These pages were opened on 17 November 2026 to check the facts above.

- [SNK morphological database](https://korpus.sk/en/corpora-and-databases/databases/morphology-database/): size, format, tagset and licence
- [Araneum frequency lists](https://www.juls.savba.sk/dataset_araneaarf_en.html): files and columns
- [kaikki.org Slovak dictionary](https://kaikki.org/dictionary/Slovak/): word count and extraction date
- [UD Slovak SNK treebank](https://universaldependencies.org/treebanks/sk_snk): size, tags and licence
- [FrequencyWords](https://github.com/hermitdave/FrequencyWords): subtitle frequency list and its licences
- [Supabase pricing](https://supabase.com/pricing), [auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Vercel function limits](https://vercel.com/docs/functions/limitations) and [Hobby plan](https://vercel.com/docs/plans/hobby)
- [PWA on iOS notes by Maximiliano Firtman](https://firt.dev/notes/pwa-ios/): what installed web apps can and cannot do
- The npm registry, for every version in the stack table
- The Claude API reference, for model ids, prices, batch and caching rules, as of 3 November 2026
