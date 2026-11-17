# Work packages

> Snapshot of the Work packages tab of the plan document, exported on 2026-11-17 by package F1. From now on the repository is the source of truth.

The build is split into 35 packages, each sized for one agent that starts with fresh context. Every package names what it reads, what it owns, what it delivers and how to prove it is done.

## How to use this tab

Each specification below is a complete brief for one agent with fresh context. The agent needs the repository, its own specification and the two other tabs, which package F1 copies into `docs/`.

Every specification has the same parts: goal, dependencies, what it unblocks, owned paths, what to read first, what to build, done criteria, and what is out of scope. Paths, schemas and endpoint names refer to the Contracts tab.

### Rules for every package

- Read `AGENTS.md`, `docs/architecture.md`, `docs/contracts.md` and your own specification before writing code. Then read the handoff notes of the packages you depend on.
- Run `nvm use` so that Node 24 is active, then `pnpm install`.
- Work on the branch `wp/<id>-<slug>`, for example `wp/b1-review-engine`.
- Change only the paths your package owns. Everything else is read only.
- A change to a shared surface is a small pull request of its own that merges first. Shared surfaces are `packages/contracts`, `packages/db`, `packages/testkit`, `packages/ling`, `packages/srs`, `apps/api/src/platform`, `apps/api/src/ports.ts`, `apps/api/src/testing`, `apps/web/src/lib`, `apps/web/src/ui`, the route table, root files and the dependency list.
- Read the installed documentation of every library you touch. Vite 8, TypeScript 7, Vitest 5, MSW 3, Zod 4, ts-fsrs 6 and the Anthropic SDK all differ from older versions.
- Tests never reach the network: no real model call, no real Supabase.
- No network call runs while a database transaction is open.
- Secrets never enter the repository, a log or a handoff note.
- Interface text goes into the messages file. A Slovak form you are unsure of is checked against the dataset, never guessed.
- Finish with one pull request and one handoff note.

### Definition of done

A package is done when all of these hold:

- Every item of its own done list is proven by a test or a recorded check.
- `pnpm check` passes: type check, lint, unit tests and the dependency check.
- New logic has tests beside it.
- No file outside the owned paths changed, apart from shared surface pull requests that already merged.
- The pull request says what was built and how to try it.
- `docs/handoff/<id>.md` exists.

### Handoff note

```markdown
# <id> <name>
Status: done | done with gaps

## What was built
## How to run and test it
## Differences from the specification, and why
## Known gaps and follow ups
## Notes for packages that depend on this one
```

### Brief for a fresh agent

The coordinator can start an agent with this text and change only the id.

```text
You are building work package <ID> of the Slovak learning app.
Repository: <owner>/<repo>, default branch main.

1. Read AGENTS.md, docs/architecture.md and docs/contracts.md.
2. Read the section for <ID> in docs/work-packages.md. It is your whole task.
3. Read docs/handoff/ for the packages <ID> depends on.
4. Create the branch wp/<id>-<slug> from main.
5. Build what the specification lists, inside the owned paths only.
6. Prove every item under "Done when", and run pnpm check.
7. Write docs/handoff/<ID>.md and open one pull request.

If the specification and the repository disagree, follow the repository and record the difference.
If a piece from another package is missing, stop and report it. Do not build that piece yourself.
```

### Merging

- Packages of the same wave own different folders, so their pull requests merge in any order.
- F1 declares every dependency of the stack up front. A new dependency is a shared surface change.
- After each merge to `main`, open branches rebase. A conflict outside the lock file means a package left its own paths.

## Phase 0: Foundation

Phase 0 creates everything that more than one package touches, and then freezes it. Its nine packages run in four short waves: F1, then F2 and F7, then F3, F4, F6 and F9, then F5. F8 follows once the accounts exist.

### F1 Repository and tooling

**Goal.** A repository in which every later package only adds files inside its own folder.

- **Depends on:** nothing. It needs the empty GitHub repository attached to the project.
- **Unblocks:** F2, F7
- **Owns:** all root files, `.github/`, `docs/`, and the `package.json` and `tsconfig.json` of every workspace package
- **Read first:** Stack, Repository and contracts, Repository layout

**Build**

- A pnpm workspace with every folder of the repository layout. Each is a package named `@app/<name>` with an empty `src/index.ts`. `@app/testkit` also exports the subpath `./mini`, and `@app/ai` also compiles its `prompts/` folder.
- A version catalog in `pnpm-workspace.yaml` that pins every dependency of the stack table to an exact version. Each package lists what it will need, so later packages do not edit dependency lists.
- `.nvmrc` with 24, TypeScript project references, one Biome config, a Vitest workspace, and a dependency check that encodes the import rules.
- A minimal Vite config in `apps/web` with the React and Tailwind plugins, so F7 can render components before F6 exists.
- The root scripts from the Contracts tab. A script whose package is not built yet says which package provides it.
- A CI workflow that runs `pnpm install --frozen-lockfile` and `pnpm check` on every pull request.
- `AGENTS.md` with the rules for agents, and a `CLAUDE.md` that points to it.
- `docs/architecture.md`, `docs/contracts.md` and `docs/work-packages.md`: the three tabs of this document, exported as Markdown on the day F1 starts. Also `docs/handoff/` with the note template.
- `.env.example` with every variable of the run modes, and a `.gitignore` that covers `.local/`, `content/raw/` and `content/build/`.

**Done when**

- A fresh clone passes `nvm use && pnpm install --frozen-lockfile && pnpm check`.
- CI runs on a pull request and is green.
- The dependency check rejects a deliberately wrong import, proven by a test.
- Every workspace package can import the others by name.

**Not in scope:** any schema, table, route or screen.

### F2 Contracts

**Goal.** Every shape that crosses a boundary exists once, as a zod schema with an example.

- **Depends on:** F1
- **Unblocks:** F3, F4, F6, F9
- **Owns:** `packages/contracts/**`, `docs/openapi.json`
- **Read first:** the whole Contracts tab

**Build**

- `enums.ts`: every enum of the shared vocabulary, as constant arrays and zod enums.
- `text.ts`: `foldAscii` and `normalizeAnswer`, tested on all Slovak letters.
- `entities/`: a schema for every shape under Shared data shapes and for every response named in the endpoint tables.
- `endpoints.ts`: one entry for each of the 45 endpoints, with name, method, path and the schemas for path, query, body and response.
- `fixtures/`: at least one example request and response per endpoint, and one example event sequence for the tutor stream. Examples use only the words listed in the F9 specification, with the lemma ids given there.
- `content/`: a schema for one row of every content file, and for the manifest.
- A script that writes `docs/openapi.json` from the endpoint table.
- Types inferred from the schemas and exported by name.

**Done when**

- A test walks the endpoint table and parses every example with its schema.
- A test counts 45 endpoints and fails when one lacks an example.
- `foldAscii("Ľudia")` returns `ludia`, and the tests cover every accented Slovak letter.
- The package imports nothing except zod.
- `pnpm openapi` writes a valid OpenAPI document.

**Not in scope:** handlers, database code, mock handlers.

### F3 Database and test kit

**Goal.** Both schemas exist as migrations, the database itself enforces ownership, and any test can start a real Postgres inside its own process.

- **Depends on:** F2
- **Unblocks:** F5, C1
- **Owns:** `packages/db/**`, `packages/testkit/src/**`
- **Read first:** Data model, both schema sections of the Contracts tab, Internal ports, Environment and run modes

**Build**

- The Drizzle schema of all 27 tables, with check constraints built from the contract enums.
- SQL migrations for schemas, tables, indexes, grants and policies. The same files run on Supabase and on PGlite.
- The roles: `authenticated` is created when it is missing, and `app_api` is the role the API logs in with. `app_api` owns nothing, cannot bypass row level security, and may switch to `authenticated`.
- `createDb(config)`, which returns a client for Postgres through postgres.js, or for PGlite.
- `withUser` and `withSystem` as specified.
- `loadContent(db, folder)`: it validates every file with the content schemas, upserts into `ling` and writes the content version.
- The test kit: `createTestDb({ content })` with migrations applied and the `auth.uid()` function in place, plus factories for profile, note, card, review, text and conversation. `content` is a folder of content files, and the name `mini` stands for the folder that F9 fills.

**Done when**

- Migrations create 27 tables on a fresh PGlite, and drizzle-kit reports no drift.
- Isolation tests pass for every table of schema `app`: user A cannot select, update or delete user B's rows, and cannot insert rows for B.
- A test reads the table list from the catalog and fails if a table lacks `user_id`, a policy, or forced row level security.
- Without the role switch, `app_api` reads nothing from schema `app`.
- `loadContent` loads a small inline content set, and a second load changes nothing.

**Not in scope:** queries of feature modules, the mini dataset, the Supabase projects.

### F4 Language and review core

**Goal.** The pure Slovak helpers and the scheduler wrapper that the client and the server share.

- **Depends on:** F2
- **Unblocks:** F5, C1, M2, M4
- **Owns:** `packages/ling/**`, `packages/srs/**`
- **Read first:** Declension engine, Review engine, Shared vocabulary, Shared data shapes, and the ts-fsrs 6 documentation

**Build**

- `packages/ling`: parse and format form tags, turn tags into case, number and gender, build a `formMap` from a table of forms, find the stem of a word for its pattern, `diagnoseForm` in the specified order, the mapping from diagnosis to error type, and the bucket of a set of features.
- Also in `packages/ling`: a sentence splitter that knows Slovak abbreviations and ordinals, and a tokenizer that keeps character offsets. The analyzer and the pipeline both use them.
- `packages/srs`: the four functions over ts-fsrs. Learning steps of 1 and 10 minutes, a relearning step of 10 minutes, and the scheduler state as opaque JSON with a version label.
- `gradeAnswer`, which uses `diagnoseForm`. Correct gives the rating good, close gives hard, and wrong gives again. With strict accents on, close counts as wrong.
- Small tables of forms inside the tests, for *mesto*, *žena*, *ulica* and *pekný*. Neither package reads the mini dataset.

**Done when**

- `diagnoseForm` tests cover all five results, with *do meste*, *zenam*, *z ulicy*, and the pair *mesta* and *mestá*.
- For every token, the slice of the text from its start to its end equals the token. A property test proves it on tricky strings.
- Scheduler tests pass with a fixed clock: a new card through its steps into review, a lapse, and replay equal to step by step scheduling.
- Grading tests pass: *mesta* for *mestá* is wrong, *zenam* for *ženám* is close, and wrong when strict accents are on.
- Both packages run unchanged in a browser and in Node, and do no input or output. `ling` imports only `contracts`, and `srs` imports only `contracts`, `ling` and ts-fsrs.

**Not in scope:** database access, endpoints, screens, the mini dataset, tuning of scheduler parameters.

### F5 API skeleton

**Goal.** A running API in local mode in which every endpoint answers with its contract example and every port has a stand in.

- **Depends on:** F3, F4, F9
- **Unblocks:** B1 to B9, F8
- **Owns:** `apps/api/src/app.ts`, `platform/`, `ports.ts`, `container.ts`, `testing/`, the first version of every folder under `modules/`, and the first version of `packages/ai/src/` and of the six prompt folders
- **Read first:** Auth and security, API, and the Contracts tab from API conventions to the end

**Build**

- The Hono app with its middleware: request id, body limit, error mapping to the error shape, the token check, and creation of the profile row on a learner's first call.
- The token check in two modes: public keys of the Supabase project through jose, or the dev login.
- A route helper that binds a handler to an endpoint entry of `contracts`. It validates path, query and body, and validates responses in tests and in local mode.
- Every endpoint registered in its module's `routes.ts`, answering with the contract example.
- `ports.ts` with all interfaces, `container.ts`, and a `port.ts` factory in each provider module that returns the stand in. The gateway's types live in `packages/ai`, and `ports.ts` exports them again.
- The stand ins in `testing/`: a lexicon read from the mini dataset, recorders for notes and attempts, and a simple analyzer. One shared test suite per port.
- The first version of `packages/ai/src`: the gateway types, a mock gateway with scripted answers, the gateway's own test suite, and `createGateway(config)`. The factory returns the mock until B8 adds the real gateway.
- The config of the gateway carries two functions, which `platform/` implements on `app.ai_call`: one reads a learner's spend of the day, and one writes a usage row.
- Under `packages/ai/prompts`, one folder per route with an `index.ts` and a placeholder version 1. The owner of the route replaces it.
- `runInBackground`, `Clock`, `IdGenerator`, and a config loader with the start up guards.
- Local mode: PGlite in `.local/pgdata`, migrations, the mini dataset, the dev login. One entry for a plain Node server and one for Vercel.
- `createTestApp()`, which gives tests the app with a test database, stand ins and a request helper that signs in as a user.

**Done when**

- `pnpm dev` starts the API, and `GET /api/v1/health` reports the version and the content version.
- A contract test calls all 45 endpoints as a dev user, and every response parses with its schema.
- A call without a token gets 401 in the error shape. An invalid body gets 400 with the fields named.
- The token check passes tests with a locally made key set: valid, expired, wrong issuer, wrong signature.
- The process refuses to start with the dev login when `APP_ENV` is `production`.
- `createTestDb({ content: "mini" })` loads the mini dataset, and each stand in passes its port suite.
- The two usage functions pass their tests: a written row counts toward that learner's spend, and the spend starts again at the learner's day start.

**Not in scope:** the logic of any module, the real gateway, the Supabase projects.

### F6 Client skeleton

**Goal.** An installable shell in which every route shows a placeholder, data flows through one typed client, and the offline plumbing is ready for the features.

- **Depends on:** F2
- **Unblocks:** M1 to M6, F8
- **Owns:** `apps/web/**` except `src/ui/` and the contents of `src/features/`
- **Read first:** Mobile client, API conventions, API endpoints, Environment and run modes

**Build**

- The route table of the Mobile client section. Each route loads a placeholder screen from its feature folder. A bottom tab bar, a guard that sends signed out visitors to the login, and a guard for the first run.
- The API client, generated from the endpoint table: one typed function per endpoint, a typed error, the bearer token, and a reader for the tutor stream that yields typed events.
- The mock server: one default handler per endpoint that replays the contract example. `VITE_MOCK_API=true` starts it in the browser, and tests start it in Node.
- Login plumbing without screens: a provider with a Supabase mode for sign up, sign in, code check, reset and refresh, and a dev mode with a fixed user.
- The local database with its five tables, the outbox with its five send triggers, and the rule that a server answer replaces local state.
- The web app manifest, the service worker that caches the shell, a hook for the update prompt and a hook for the iOS install hint.
- The messages file with a small lookup helper.
- Test setup: Vitest with Testing Library and an IndexedDB stand in, and a Playwright project at 390 by 844 with one smoke test.

**Done when**

- With the mock server on, every route shows its placeholder under the tab bar at 390 by 844.
- A test calls the typed function of each of the 45 endpoints against the mock server and parses the response.
- Outbox tests pass: items wait while offline, go out in order once online, a repeated send is harmless, and a failing item is retried without blocking the others.
- The stream reader parses the example event sequence.
- The app is installable, and the shell loads offline after one visit.
- A CI check keeps the first load under 200 KB of compressed JavaScript.

**Not in scope:** design system components, feature screens.

### F7 Design system

**Goal.** One look and one set of touch friendly components, so that six feature packages produce screens that match.

- **Depends on:** F1
- **Unblocks:** M1 to M6
- **Owns:** `apps/web/src/ui/**`, `apps/web/src/styles/**`, `apps/web/gallery.html`
- **Read first:** Mobile client

**Build**

- Colour, spacing, radius and type tokens as CSS variables for a light and a dark theme, mapped into the Tailwind theme. One colour per case, each always shown together with the case name.
- The 13 components, with their props described in a README. `AnswerInput` carries the accent bar and the states idle, correct, close and wrong. `TokenText` renders a sentence from tokens with status colours and tap targets. `Sheet` is the bottom sheet.
- A gallery page that shows every component in every state and in both themes.
- Accessibility: visible focus, labels, reduced motion, and contrast at level AA.

**Done when**

- Component tests cover the states and the keyboard behaviour. The accent bar inserts a letter at the caret and keeps the focus in the field.
- Playwright opens the gallery in both themes at 390 by 844 with no console error and no sideways scroll.
- A test computes the contrast of text and case colours from the tokens and finds level AA.
- No component imports from `features/` or `lib/`.

**Not in scope:** screens, data fetching.

### F8 Cloud setup and deploy path

**Goal.** A pull request gets a working preview on real infrastructure, and production is one approved step away.

- **Depends on:** F5, F6, and your Supabase and Vercel accounts
- **Unblocks:** I2, I5
- **Owns:** `vercel.json`, `.github/workflows/migrate.yml`, `docs/deploy.md`, the smoke script
- **Read first:** Auth and security, Environment and run modes, Risks

**Build**

- The Vercel configuration: the client as static files, the API as one function under `/api` on Node 24 in region `fra1`, with a maximum duration of 300 seconds.
- Both Supabase projects set up alike: schemas `app` and `ling` kept out of the data API, the email template that sends a six digit code, the sign up switch, and a password for `app_api` that never enters the repository.
- A workflow that applies migrations to the development project on every merge to `main`, and to production only after a manual approval.
- The environment variables for preview and production, documented by name in `docs/deploy.md`.
- The mini dataset loaded into the development project as a first check.
- `pnpm smoke <url>`: health, sign in with a test account, `GET /me`, and a review queue call.

**Done when**

- A pull request shows a preview in which sign up with a real email works and the health endpoint reports the content version.
- The isolation tests of F3 pass against the development project.
- The API connects through the pooler as `app_api`, and the function runs in Frankfurt.
- Another person can repeat the setup from `docs/deploy.md` alone.

**Not in scope:** the production launch checks of I5, and the full content of I2.

The agent uses the Supabase and Vercel command line tools when their tokens are present as secrets. Without them it prepares every file and hands you a checklist of the dashboard steps.

### F9 Mini Slovak dataset

**Goal.** A small hand checked content set that every test and local mode run on.

- **Depends on:** F2
- **Unblocks:** F5, C1
- **Owns:** `packages/testkit/mini/**`
- **Read first:** Declension engine, Shared vocabulary, Shared data shapes (Content files), and the `ling` schema

**Build**

- A complete content set of all 11 files, with the 72 lemmas below and every form of each, tagged.
- A gloss, a rank and the most used forms for every lemma. The 16 patterns with their endings.
- About 20 triggers: the twelve prepositions with their cases, *pomáhať* with the dative, *päť* with the genitive plural, and the question words.
- Two full lessons, `acc-sg` and `loc-sg`, with all five steps. At least 80 exercises: every bucket of those two lessons, and two or more for each other lesson so that placement works.
- 40 example sentences linked to their lemmas, two scenarios (one of each mode), and one library text of about 80 words.
- A small module that exports the set as typed data, so that stand ins and tests can read it from memory.

| Ids | Lemmas |
|---|---|
| 1 to 10 | chlap, kamarát, brat, hrdina, dub, dom, obchod, stroj, počítač, kuli |
| 11 to 19 | žena, kniha, káva, ulica, práca, dlaň, kosť, miestnosť, gazdiná |
| 20 to 26 | mesto, kino, srdce, vysvedčenie, námestie, dievča, múzeum |
| 27 to 31 | človek, ľudia, rodič, deň, Bratislava |
| 32 to 36 | pekný, nový, dobrý, cudzí, slovenský |
| 37 to 44 | ja, ty, on, ona, môj, ten, kto, čo |
| 45 to 56 | do, z, od, bez, k, v, na, o, pri, po, s, pre |
| 57 to 59 | jeden, dva, päť |
| 60 to 67 | byť, mať, ísť, vidieť, bývať, pomáhať, pracovať, kúpiť |
| 68 to 72 | a, nie, veľmi, dnes, kde |

**Done when**

- A dataset test parses every row with its content schema and resolves every link between files.
- Every exercise answer is a form of its target lemma with the tag the exercise claims.
- A test pins the 72 lemma ids of the table, so that no id changes unnoticed.

**Not in scope:** code that uses the data, real frequency data, the import of the full morphology. Package C1 later replaces the hand written forms with real data for the same ids.

## Phase 1: Content track

The content track builds the pipeline stages and proves each one on small samples. The full run with real spend happens once, in package I2.

Every stage lives in its own folder under `tools/pipeline/src/stages/`, reads files and writes files. Stages that call the model keep their prompts in their own folder and send them through the batch runner that C2 builds. In tests they run in mock mode, and a dry run prints a request count and a cost estimate.

The cloud container must be allowed to reach the data sources. Where a host is blocked, the raw file can be placed in `content/raw/` by hand, and the stage continues from there.

### C1 Morphology import

**Goal.** Real Slovak morphology in the content file format, with lemma ids that never change.

- **Depends on:** F3, F4, F9
- **Unblocks:** C2, I2, I3
- **Owns:** `tools/pipeline/src/cli.ts`, `lib/`, and the stages `fetch`, `morph`, `validate` and `load`. Also `content/SOURCES.md` and `content/registry/`.
- **Read first:** Content pipeline, Shared vocabulary, the `ling` schema, and the tagset description linked from the source page

**Build**

- The command `pnpm pipeline <stage>` with a stage runner. Each stage declares its inputs and outputs, and a stage whose inputs did not change is skipped.
- `fetch`: downloads a source into `content/raw/` with a checksum, and records URL, date and licence in `content/SOURCES.md`.
- `morph`: reads the SNK file as a stream of lemma, form and tag. It maps word classes to `Pos`, maps gender, number and case to form tags, drops entries marked as misspellings, and flags proper names.
- The lemma registry: a key per lemma, a number per key, append only. The 72 lemmas of the mini dataset keep the ids they have.
- For prepositions, the cases they govern, kept in the lemma's flags. Package C4 checks its triggers against them.
- Pattern assignment by rule for nouns and adjectives, from gender, animacy and the endings of the nominative and genitive. Irregular words get a flag instead.
- `validate` as a framework: content schemas, links between files, and checks that later stages can add to.
- `load`, which calls `loadContent` and takes an optional rank limit.
- A quality report: counts per part of speech, tags that failed to parse, the spread of patterns, 50 random nouns with their pattern, and the measured size of the forms table with its indexes.

**Done when**

- The stage processes the full file as a stream and writes lemma and form files that pass `validate`.
- Golden tests match hand checked tables for *mesto*, *žena*, *chlap*, *stroj*, *ulica*, *dievča*, *ľudia*, *múzeum*, *pekný* and *ja*.
- At least 95% of nouns get a pattern or the irregular flag, and the rest are listed in the report.
- A second run writes identical files and leaves the registry unchanged.
- The forms of the mini dataset are compared with the real data. Differences are fixed in the mini dataset and listed in the handoff note, and every test in the repository still passes.

**Not in scope:** ranks, glosses, sentences.

### C2 Frequency ranks and dictionary

**Goal.** Every lemma worth teaching has a rank, its most used forms and an English gloss.

- **Depends on:** C1
- **Unblocks:** C3, C4, C5, I2
- **Owns:** the stages `freq` and `dict`, `tools/pipeline/src/model/`, and `content/generated/glosses.jsonl`
- **Read first:** Content pipeline, AI integration, the batch section of the Claude API documentation

**Build**

- `freq`: reads the Araneum list of lemmas and the list of word forms with tags. It reads the subtitle word list and maps its forms to lemmas through the morphology.
- One documented formula that blends the web rank and the subtitle rank, and a rank for the 5,000 most common lemmas.
- For each ranked lemma, its four most used forms with their share.
- `dict`: matches the Wiktionary extract by lemma and part of speech and keeps up to three short senses per lemma.
- A model fill through the route `content.glosses` for ranked lemmas without an entry. Those rows are flagged as generated.
- The batch runner in `model/`: it builds requests from a prompt and a zod schema, submits a batch, polls it, validates the answers and caches them on disk by request hash.
- Safety switches on the runner: a dry run that prints request count and estimated cost, a mock mode for tests, and a refusal to spend more than $5 without an explicit flag.

**Done when**

- The 30 highest ranked lemmas are common function and core words. A snapshot test holds the list, and the handoff note shows it.
- After the fill on a sample, every lemma of the sample has a gloss, and every generated gloss carries its flag.
- The shares of the top forms of a lemma sum to at most 1, and each form exists in the forms file.
- Runner tests pass in mock mode: a cached request is not sent again, and an answer that breaks the schema is rejected and reported.

**Not in scope:** sentences, exercises, and the full paid run.

### C3 Example sentences

**Goal.** Two or three short, correct and easy sentences for each of the 3,000 most common lemmas, each showing a frequent form.

- **Depends on:** C2
- **Unblocks:** I2
- **Owns:** the stage `sentences`, and `content/generated/sentences.jsonl`
- **Read first:** Content pipeline, the `ling` schema

**Build**

- A harvest of Tatoeba sentences that have an English translation, and of the UD treebank's sentences, which come with checked lemmas.
- Tokens with lemma and tag for every sentence, split by the tokenizer of `packages/ling`. A sentence whose target word stays ambiguous is skipped.
- The filter: 4 to 12 words, the other words within the 3,000 most common lemmas, and the target word in one of its most used forms.
- A difficulty score from length and word ranks, and a choice of up to three sentences per lemma that prefers different forms.
- Generation through `content.sentences` for lemmas that are still short of sentences. The request names the lemma, the form, its tag and the allowed vocabulary.
- Two checks for generated sentences: the rules above, then a second model pass for naturalness and for the translation.
- English translations through the model for treebank sentences that are kept.

**Done when**

- On the mini dataset in mock mode, the stage yields at least two sentences per noun, and the result passes `validate`.
- Every row carries its source, its licence and the source's own id.
- Tests prove that a sentence with a rare word, a wrong length or a missing target form is rejected.
- A dry run for the full list prints the request count and the cost estimate.

**Not in scope:** exercises, audio.

### C4 Declension content

**Goal.** The whole declension course as data: triggers, pattern notes, nine lessons and a verified exercise bank.

- **Depends on:** C2
- **Unblocks:** I2
- **Owns:** the stages `triggers`, `lessons` and `exercises`, `content/authored/triggers/`, `patterns/` and `lessons/`, and `content/generated/exercises.jsonl`
- **Read first:** Declension engine, Shared data shapes, the research report's section on declension

**Build**

- About 200 triggers in YAML: every primary preposition with its cases, about 80 common verbs with the case they demand, numerals and quantity words, and the question words of each case.
- A preposition that takes two cases as two rows with one contrast group.
- The pattern files: endings taken from the real forms of the model word, a note in English, and an everyday model word.
- Nine lessons with five steps each, in plain English for level A2. Each lesson's bucket weights come from the frequency of case, number and gender in the corpus list.
- The exercise generator, bucket by bucket, through `content.exercises`. It receives the bucket, the allowed triggers and a vocabulary limit.
- Rule checks on every generated exercise: the answer is a real form with the claimed tag, every word is a known form, and the trigger stands where it governs the gap.
- Wrong options for choice items built by rule from the word's other case forms, never by the model.
- Phrase exercises where the gap spans an adjective and its noun.
- A second model pass that reviews each exercise, a difficulty score, a lesson for each exercise, and ids made from a hash.

**Done when**

- `validate` passes for triggers, patterns and lessons, and for exercises in mock mode on the mini dataset.
- Every preposition trigger agrees with the cases in the morphology data. A mismatch fails the build.
- A test rebuilds the real forms of each model word from the pattern's endings.
- Every lesson has its five steps in order, and each checkpoint lists at least 8 exercises.
- Tests prove that an exercise with an answer in the wrong case, or with an option that is no real form, is rejected.

**Not in scope:** trainer logic, screens, and the full paid run.

### C5 Scenarios and starter library

**Goal.** Twelve tutor scenarios and twelve graded texts, so the learner has something to talk and read about on the first day.

- **Depends on:** C2
- **Unblocks:** I2
- **Owns:** the stages `scenarios` and `library`, `content/authored/scenarios/` and `content/authored/library/`
- **Read first:** AI integration, the `ling` schema, the research report's section on the tutor

**Build**

- Eight goal based scenarios: a café, asking the way, the doctor, groceries, renting a flat, the train station, a neighbour, the weekend.
- Four case coach sets: the accusative, *na* and *v* with locative against accusative, the genitive after *do*, *z* and *od*, and the instrumental after *s*.
- For each scenario every field of `ling.scenario`: goal, setting, the tutor's role, target cases and triggers, the opening line, three or four success criteria, and vocabulary hints.
- Twelve texts of 150 to 400 words on everyday topics, from A2 to B1, written for this project.
- The `library` stage: it splits each text with the tokenizer of `packages/ling`, checks that every word is a known form, counts tokens and lemmas, and checks the vocabulary profile. The analysis stays empty until I2 fills it.

**Done when**

- `validate` passes for both files.
- Every target trigger follows the id convention and exists in the mini dataset or in C4's list.
- In each A2 text, at least 90% of the words lie within the 2,000 most common lemmas.
- Each text is marked as reviewed by a second model pass, or as unreviewed.

**Not in scope:** tutor prompts, reader screens.

## Phase 1: Backend track

All nine backend packages start when F5 has merged, and none waits for another. Each one replaces the stubs in its own module folders and tests against PGlite, the mini dataset and the stand ins.

Three checks apply to every backend package and are not repeated below:

- Every response of the module parses with its contract schema.
- An isolation test shows that user B gets `not_found` for user A's rows on every endpoint of the module.
- A port the package provides passes the shared suite for that port.

### B1 Review engine and notes

**Goal.** The learner's deck: notes, cards, scheduling, and a batch sync that survives offline use and two devices.

- **Depends on:** F5
- **Unblocks:** I1
- **Owns:** `apps/api/src/modules/review/`, `apps/api/src/modules/notes/`
- **Read first:** Review engine, Shared data shapes, the tables `note`, `card` and `review`, and the code of `packages/srs`

**Build**

- All grading and scheduling through `packages/srs`, which F4 built. The module adds no scheduler logic of its own, and a revealed answer is rated again.
- The notes endpoints and the real `NotesPort`. A word note takes up to three sentences that cover the lemma's most used forms, and falls back to the sentence it was captured in.
- One word note per lemma and one case sentence note per exercise. A new note gets its card at once, and reader captures queue before common words.
- `GET /review/queue`: learning cards that are due, then due reviews with the oldest first, then new cards up to the daily cap. Each item carries its `formMap` and the next sentence of its note.
- `POST /review/answers`: skip ids already stored, grade again on the server, let the learner's own rating win when it was changed, schedule, and store review and card in one transaction.
- Replay of a card's whole log when an answer arrives that is older than the card's last review.
- An attempt logged through `AttemptsPort` for each case sentence review. A lemma is set to known once its card's stability passes 21 days.
- Daily counts that follow the learner's day and time zone.

**Done when**

- A fixed clock test walks one card through the endpoints: new, both learning steps, review and a lapse.
- A property test delivers the same answers in any order and always reaches the same card state.
- Sending a batch twice changes nothing and returns the same results.
- The daily caps hold across the day boundary for a learner outside UTC.
- An answer the phone marked correct but the server grades as wrong is stored as wrong. A rating the learner changed is kept.

**Not in scope:** review screens, the scheduler package itself.

### B2 Lexicon services

**Goal.** Fast and correct answers to two questions: which words can this form be, and what does this word mean.

- **Depends on:** F5
- **Unblocks:** I1, I2, I3
- **Owns:** `apps/api/src/modules/lexicon/`, `packages/ai/prompts/reader.gloss/`
- **Read first:** Internal ports, the tables `lemma`, `form` and `sense`, Shared vocabulary

**Build**

- The real `MorphologyPort`. `lookupForms` answers a whole batch with one query on the folded form, prefers exact matches, and handles the capital letter at the start of a sentence.
- `getParadigm`, and a builder that arranges forms as a table: cases as rows, singular and plural as columns, and one table per gender for adjectives.
- `verifyForm`, `getLemma` and `findLemma`.
- A small cache in the process for frequent forms and tables.
- The real `DictionaryPort`. `ensureGlosses` asks the route `reader.gloss` once for all missing lemmas of a call, stores the answers with the source `runtime`, and returns them.

**Done when**

- A test counts queries: `lookupForms` for 1,000 words runs as one query and uses the index on the folded form.
- *mesta* and *mestá* return different tags. A capitalised first word finds its lower case lemma. *Ľudia* resolves. An unknown form returns an empty list.
- With the mock gateway, `ensureGlosses` stores a gloss once and reuses it on the next call.

**Not in scope:** analysis of sentences, the word page endpoint.

### B3 Text analyzer

**Goal.** Any pasted Slovak text becomes words with a lemma, a case, a trigger and a gloss, and the model is asked only where rules cannot decide.

- **Depends on:** F5
- **Unblocks:** I1, I2, I3
- **Owns:** `apps/api/src/modules/analyzer/`, `packages/ai/prompts/reader.disambiguate/`
- **Read first:** Content pipeline (text analysis at import), Shared data shapes, Auth and security

**Build**

- Sentences and tokens from the splitter and the tokenizer of `packages/ling`, with offsets into the body as it was given.
- One lookup of all distinct forms through `MorphologyPort`.
- Pruning rules that never remove the last reading: a single candidate, the cases a preposition allows, agreement of adjective and noun, the genitive plural after numerals from five up.
- The model step for words that are still ambiguous. The prompt lists the candidate readings of each word by index, and the schema accepts only an index.
- A fallback when the model's answer is unusable: the most frequent reading, marked as a guess.
- Trigger detection: the preposition before a phrase, and verbs and numerals of the trigger list in the same clause.
- Glosses through `DictionaryPort`, the lemma map, and counts of tokens and lemmas.
- Chunking, so that a text of 20,000 characters stays inside the limits of a single call.

**Done when**

- For every token, the slice of the body from its start to its end equals the token. A property test proves it on tricky strings.
- Rule tests pass without the model: *v meste* is locative, *do mesta* is genitive, *päť žien* is genitive plural.
- With the mock gateway, the model is asked only about words the rules left open.
- A text of 20,000 characters stays within a fixed number of model calls.
- A text that contains instructions for the model still yields a valid `TextAnalysis`.

**Not in scope:** storing texts, reader screens, tuning on real data.

### B4 Reader module

**Goal.** Import, open and read texts, and know how much of a text the learner already understands.

- **Depends on:** F5
- **Unblocks:** I1
- **Owns:** `apps/api/src/modules/reader/`, `packages/ai/prompts/reader.translate/`
- **Read first:** Content pipeline (text analysis at import), API endpoints (Reader), the table `text`

**Build**

- `POST /texts`: check the length, store the text as `processing`, answer 202, and analyse in the background through `AnalyzerPort`. A failed analysis sets `failed` with a message and keeps the text.
- `GET /texts/:id`: body, analysis, the status of each lemma in the text, saved phrases with their positions, and the reading position.
- Coverage: the share of word tokens whose lemma is known or ignored. Names and numbers count as known. It is computed again on opening when word statuses changed.
- List, rename, archive, delete, and saving the reading position.
- Sentence translation through `reader.translate`, stored in the analysis so that a second request costs nothing.
- The library list with coverage per text for this learner. Adding a text copies it with its analysis, or runs the import when the library text has none.
- The rate limit of 10 imports an hour.

**Done when**

- With the stand in analyzer, an import moves from `processing` to `ready`. With a failing analyzer it ends as `failed` and the text is still there.
- Marking a lemma known raises the coverage on the next opening.
- The mock gateway is called once per translated sentence, however often it is requested.
- A body of 20,001 characters gets `validation_failed`, and the eleventh import of an hour gets `rate_limited`.

**Not in scope:** the analysis itself, the notes endpoints.

### B5 Declension module

**Goal.** The course, the trainer and the record of every case attempt, with a selection that follows the learner's weak spots.

- **Depends on:** F5
- **Unblocks:** I1
- **Owns:** `apps/api/src/modules/declension/`
- **Read first:** Declension engine, Shared data shapes, the tables `lesson`, `lesson_step`, `exercise`, `attempt` and `lesson_progress`

**Build**

- The course endpoint with lesson status. The first lesson is available, the next opens when one is completed or tested out, and any lesson can be started early.
- Lesson detail: steps with their exercises as `ExerciseItem`, each with its `formMap` and the endings of sibling patterns.
- The progress endpoint. A checkpoint score of 75% completes the lesson, creates about ten case sentence notes through `NotesPort` with wrong items first, and opens the next lesson.
- The session builder: three modes, bucket weights from the lessons, mastery, the 30% rule, a seeded random source, and a preference for exercises the learner has not seen lately.
- The attempts endpoint: a batch that is safe to repeat, a second diagnosis on the server, rows in `attempt` with features and error type, and wrong items promoted to cards up to 5 a day.
- The real `AttemptsPort` with the mastery formula.
- The pattern endpoint.

**Done when**

- Mastery tests reproduce hand computed values, including retries and the rule for unseen buckets.
- The same seed and history give the same session. In `weak` mode most items come from the weakest buckets, and at least 30% from strong ones.
- Completing a lesson creates its cards once, even when the request repeats.
- The three examples of the Declension engine section give the stated diagnoses and error types.

**Not in scope:** course content, screens.

### B6 Words track and placement

**Goal.** The common words track and the placement check that sets the learner's starting point.

- **Depends on:** F5
- **Unblocks:** I1
- **Owns:** `apps/api/src/modules/words/`, `apps/api/src/modules/placement/`
- **Read first:** API endpoints (Words and placement), Shared data shapes (Placement), the tables `user_lemma` and `placement`

**Build**

- Three bands of 1,000 ranks with counts per status, and the paged list of a band with filters.
- Sorting many words in one call, and the status of a single word. Every write goes through `NotesPort`: known and ignored set the status, and learn creates a word note.
- The word page data: senses, the table of forms, sentences, the status and the learner's note.
- Placement rounds as specified. Wrong options of a vocabulary item are glosses of other lemmas with the same part of speech and a similar rank.
- The case round: 16 exercises, two per teaching lesson, of medium difficulty.
- The result and its application in one transaction: word statuses through `NotesPort`, `tested_out` rows for lessons that have no row yet, and the start lesson and the placement date on the profile. Case answers are logged through `AttemptsPort`.
- Rounds that are safe to repeat: the same answers return the same next round.

**Done when**

- Three simulated learners get the expected results: one who knows the first 1,000 words, one who knows nothing, one who knows everything.
- Applying a result twice changes nothing more.
- Sorting 200 words runs in one transaction and creates notes only for the words to learn.
- The word page of *mesto* returns a table of six cases by two numbers.

**Not in scope:** screens, content.

### B7 Profile, today, stats and reports

**Goal.** Settings, the plan for the day and the numbers behind the home screen, plus the learner's right to export and delete.

- **Depends on:** F5
- **Unblocks:** I1
- **Owns:** `apps/api/src/modules/profile/`, `apps/api/src/modules/reports/`
- **Read first:** API endpoints (System and profile), the table `profile`, Auth and security

**Build**

- `GET /me` and `PATCH /me` with validation of time zone names and of the ranges of the caps.
- `DELETE /me`: delete the profile row, which cascades to every learner table, then delete the login through the Supabase admin interface. In dev mode only the rows go.
- `GET /me/export`: every learner row as one JSON file.
- `GET /today`: review counts, the text to continue, the next lesson, the weakest buckets through `AttemptsPort`, a tutor scenario that targets the weakest case, and progress in the word bands.
- A first run state in `Today` for a learner who has not finished placement.
- `GET /stats/summary` and `POST /reports`, the latter with a limit of 30 a day.
- The module reads the tables of other modules. Writes go only to `profile` and `content_report`.

**Done when**

- `Today` matches hand built expectations for a fresh account and for a seeded learner in the middle of the course.
- After a deletion, a test finds no row of that user in any table of schema `app`.
- The export holds rows from every table for that user, and nothing of another user.
- Counts in `Today` agree with the review queue for the same moment and time zone.

**Not in scope:** screens.

### B8 AI gateway

**Goal.** One guarded door to the Claude API: routes, schema checked output, streaming, caching, budgets and a usage log.

- **Depends on:** F5
- **Unblocks:** I1, I2, I3
- **Owns:** `packages/ai/src/**`, taken over from the first version that F5 wrote
- **Read first:** AI integration, Internal ports, and the current Claude API documentation on structured output, streaming, prompt caching and stop reasons

**Build**

- `createGateway(config)`: it returns the real gateway when `AI_MODE` is `anthropic` and the mock otherwise. The types and the config stay as F5 wrote them, because the API already builds on them.
- The route table: for each route its default model `claude-opus-5-5`, effort, token limit and timeout, with the overrides from the environment.
- `structured`: a request for JSON that matches the zod schema, with handling of the stop reasons for refusal and for cut off output.
- `stream`: forwards text as it arrives, can be aborted, and returns the final text with its usage.
- The prompt registry: it imports the `index.ts` of each prompt folder, which names the versions and the one in use, and marks the end of the stable part for caching. A test fails when a prompt contains a date or a random value.
- The budget check before a call, with the spend function from the config. A learner over the budget gets `budget_exceeded` with the time it resets.
- The usage row after a call: input, output and cache tokens, cost from one price table, latency, status and request id. It goes to the usage function from the config.
- Error mapping from the SDK to the codes `upstream_failed` and `budget_exceeded`, and to typed results for refusal and cut off output.
- Record and replay for the mock gateway, and a helper with which tests script answers and assert calls.

**Done when**

- With a stubbed SDK client, tests show the right request per route: model, effort, schema and the position of the cache marker.
- Stop reasons and SDK errors map as specified. The real gateway passes the gateway test suite with a stubbed SDK client.
- Calls stop at the daily budget and resume on the next learner day.
- The cost in a usage row equals a hand calculation from the stubbed token counts.
- A smoke script runs one schema checked call and one streamed call when a key is present. It is not part of CI.

**Not in scope:** the prompts of the tutor and reader routes, the batch runner of the pipeline.

### B9 Tutor module

**Goal.** Goal based conversations and the case coach, in which every case error is prompted, verified and turned into practice.

- **Depends on:** F5
- **Unblocks:** I1, I3
- **Owns:** `apps/api/src/modules/tutor/`, and the prompt folders `tutor.analyze`, `tutor.reply` and `tutor.summary`
- **Read first:** AI integration, Shared data shapes (Tutor stream), the tables `conversation`, `message` and `tutor_error`, the research report's section on the tutor

**Build**

- The scenario list, and creating, listing and opening conversations. A new conversation starts with the scenario's opening line.
- The turn pipeline as described under AI integration: load, analyze, verify, decide, reply, store. Each step is a function of its own, so the evals can call analyze and verify directly.
- Verification through `MorphologyPort`: the expected form must exist with the claimed case, and an error whose given form is valid for that case is dropped.
- The decision table: at most two prompts per message, a fixed retry becomes `self_corrected`, a second miss becomes `corrected`.
- Storage in the second transaction: the tutor's message, the errors, case sentence notes through `NotesPort` with the corrected words blanked, attempts through `AttemptsPort`, and the goal state.
- The event stream with its four events and a keep alive every 15 seconds. Storage still completes when the client disconnects.
- Peek with its three kinds. Revealing an answer sets the error to `corrected` and logs a wrong attempt.
- Ending a conversation through `tutor.summary`, and the dispute endpoint, which suspends the note through `NotesPort` and inserts a content report.
- Version 1 of the three prompts: the tutor's role, the level rules, the error checklist of the research report, and the format of the directive.
- Limits: 1,000 characters a message, 20 messages a minute, 40 turns a conversation.

**Done when**

All of these run with the mock gateway and the mini dataset.

- Script one: an error is prompted, the learner fixes it, the status is `self_corrected`, and no card exists.
- Script two: the learner misses twice, the status is `corrected`, and exactly one case sentence note exists with the right gap.
- A reported error whose given form is in fact correct is dropped. An expected form that does not exist is never shown and never becomes a card.
- The events arrive in the specified order. A repeated `clientId` returns the stored result without a new model call.
- A test proves that no model call starts while a transaction is open.
- A dispute suspends the note and stores a content report.

**Not in scope:** tuning prompts on real data, chat screens, the gateway itself.

## Phase 1: Client track

All six client packages start when F6 and F7 have merged, and none waits for the backend. Each one fills its own feature folders and develops against the mock server, which replays the contract examples. M2 and M4 also import the shared core from F4, which merges in the same wave as F6.

These rules apply to every client package and are not repeated below:

- Screens use only components of the design system, and all interface text sits in the messages file.
- A feature that needs another mock answer overrides the handler inside its own folder.
- Playwright runs the main flow at 390 by 844 against the mock server, with no sideways scroll and no console error.
- Loading, empty, error and offline states exist for every screen that fetches data.

### M1 Account, onboarding, settings and Today

**Goal.** A learner can sign up, set the app up, and land on a home screen that says what to do today.

- **Depends on:** F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/account/`, `apps/web/src/features/today/`
- **Read first:** Auth and security, Mobile client, API endpoints (System and profile)

**Build**

- Login, sign up, and the code screen: six digits, paste support, and a resend button that waits 60 seconds.
- Password reset with a code and a new password.
- Onboarding: name, minutes per day as a preset for the daily caps, and the detected time zone.
- Settings: caps, strict accents, target retention, theme, export, sign out, and account deletion that asks twice.
- The about screen with app version, content version and the list of sources.
- Today: reviews due with a start button, the text to continue, the next lesson, weak cases, a tutor suggestion and word progress. A first run state leads to the placement check.
- The iOS install hint, the update prompt and the offline indicator.
- In dev mode, a login with one tap.

**Done when**

- Form tests cover validation, a wrong code, a weak password, a network error, and the disabled state while sending.
- Playwright walks from sign up through the code and onboarding to Today.
- A changed setting sends `PATCH /me` with the right body.
- Today renders three mock variants: a fresh account, the middle of the course, and everything done for the day.

**Not in scope:** placement screens, feature screens.

### M2 Review session and deck

**Goal.** The typed review session, which works offline, and the deck in which notes can be inspected and managed.

- **Depends on:** F4, F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/review/`
- **Read first:** Review engine, Mobile client (State and offline), Shared data shapes (Review)

**Build**

- The session: the queue is stored in the local database, and each card shows its sentence with the gap, the cue or gloss, and the English sentence.
- The typed answer through `AnswerInput`, graded on the phone by `gradeAnswer`.
- Feedback: correct, close with the accents shown, or wrong with the case that was typed named in a sentence.
- Rating buttons with the default chosen in advance, and a way to change it. Show answer counts as revealed.
- Scheduling on the phone through `packages/srs`, so learning cards return inside the session when their minutes are up.
- Each answer goes into the outbox. After a sync, the server's card states replace the local ones.
- The deck: a searchable list with a filter by kind, a note page with its sentences, schedule and last reviews, and the actions suspend, delete and edit.
- A report button on every card.

**Done when**

- Reducer tests cover a whole session, the return of learning cards, and the daily cap from the queue counts.
- Feedback tests show the three cases: correct, close for *zenam*, and wrong with the genitive named for *mesta*.
- An offline test in Playwright loads the queue, goes offline, answers five cards and reloads the app. After reconnecting, one batch with five answers is sent, and a second sync sends nothing.
- Enter submits the answer, and Enter again accepts the default rating.

**Not in scope:** scheduling on the server, creation of cards by other features.

### M3 Reader

**Goal.** Reading with help one tap away: gloss, base form, case and trigger, capture into the deck, and visible progress in known words.

- **Depends on:** F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/reader/`
- **Read first:** Mobile client (Reader), Shared data shapes (Text analysis), API endpoints (Reader)

**Build**

- The library and the learner's own texts, each with a coverage bar.
- The import screen: paste, title, a character counter with the limit, the processing state with polling that slows down, and a failure state with retry.
- The reader view, rendered from `TextAnalysis` through `TokenText`. Long texts are virtualised, and a word's colour shows its status.
- The word sheet: gloss, dictionary form, part of speech, case and number, the trigger in words such as "after *do* comes the genitive", and a hint when the reading is a guess.
- The actions Save, Known and Ignore, and a link to the word page.
- Phrase capture: selecting several words of a sentence offers Save phrase, with a meaning the learner can edit.
- Translation of a sentence on request, and the reading position saved with a delay.
- Opened texts kept in the local database. Status changes made offline go through the outbox.
- A report button on a word, which names the token.

**Done when**

- A text of 2,000 tokens renders with a bounded number of DOM nodes.
- The sheet shows the right data for three example tokens: a noun after a preposition, a guessed reading, and a punctuation mark, which opens nothing.
- Save sends `POST /notes` with the sentence as context, and the word changes colour at once and keeps it after a reload.
- An opened text can be read offline, and words marked known offline are sent later.
- Playwright walks from import through processing to a tap and a save.

**Not in scope:** the analysis, deck screens.

### M4 Declension course and trainer

**Goal.** The course map, the lesson player with its five steps, and a fast typed trainer whose feedback names the mistake.

- **Depends on:** F4, F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/cases/`
- **Read first:** Declension engine, Shared data shapes (Exercises, attempts and mastery), API endpoints (Declension)

**Build**

- The course map: nine lessons with their status, and a grid of mastery by case and number that opens into genders.
- The lesson player with one renderer per step kind: explanation with highlighted examples, trigger cards, choice items, typed items, and the checkpoint with its score and a retry.
- Progress saved after each step, and a completion screen that lists the cards that were added.
- The trainer: a start screen with mode and size, a session over the fetched items, and diagnosis on the phone through `diagnoseForm`.
- Feedback sentences for each diagnosis, built from the trigger and the case names.
- One retry after a wrong answer. The second try counts as a retry in the attempt.
- Attempts sent through the outbox, every five items and at the end.
- A summary that shows which buckets improved and which stay weak.
- The pattern screen with the table of endings and the everyday model word.

**Done when**

- A fixture lesson runs from the first step to completion and sends the right progress calls. A failed checkpoint does not complete it.
- Trainer tests show the feedback for *do meste*, *zenam* and *z ulicy*, and the body of the attempts batch matches its schema.
- An offline test fetches a session, goes offline, finishes it and reconnects. The attempts are sent once.
- The mastery grid shows each level with a text label as well as a colour.

**Not in scope:** the selection of items, course content.

### M5 Words track, word page and placement

**Goal.** Sorting the most common words quickly, a page for every word, and the placement check of the first run.

- **Depends on:** F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/words/`, `apps/web/src/features/placement/`
- **Read first:** API endpoints (Words and placement), Shared data shapes (Placement)

**Build**

- The band overview with progress, and the list of a band with filters by status.
- Sorting mode: one word at a time with its gloss hidden, then Known, Learn or Ignore by button or swipe. Decisions go to the outbox in batches of 20, and the last one can be undone.
- The word page: glosses with a mark on machine written ones, the table of forms in case colours with the most used forms highlighted, example sentences, the status control and a link to the note.
- Placement: an introduction, three vocabulary rounds with choices and an "I don't know" option, and one case round with typed answers and no feedback.
- A progress bar across the rounds, and a result screen that says how many words count as known, which lessons were skipped and where the course starts.

**Done when**

- Sorting 45 words produces two full batches and one partial batch on leaving. Undo removes the last decision from the waiting batch.
- The placement flow reaches the result with mock rounds and moves on to Today. A reload in the middle resumes the run.
- The word page renders *mesto* from the example with a table of six cases by two numbers.

**Not in scope:** logic on the server.

### M6 Tutor chat

**Goal.** A chat that feels live, shows where an error is without giving the answer away, and ends with a useful summary.

- **Depends on:** F6, F7
- **Unblocks:** I1
- **Owns:** `apps/web/src/features/tutor/`
- **Read first:** AI integration (One tutor turn), Shared data shapes (Tutor stream), API endpoints (Tutor and reports)

**Build**

- The scenario picker with goal, level, target cases and how often each was done, and a list of conversations to resume.
- The chat view with a composer that carries the accent bar and the character limit.
- Handling of the stream: `analysis` underlines the error in the learner's own message, `delta` grows the tutor's reply, `done` settles it and shows a chip for each card that was added.
- On `error`, a retry that sends the same `clientId`, so nothing is stored twice.
- The states of an error mark: prompted with a hint to try again, fixed by the learner, corrected with the form and its reason, and disputed.
- Peek: translate a tutor message, or ask for a hint or the answer on an open error. "This looks wrong" on a correction files a dispute.
- Ticks for the goal's criteria, and an end screen with the errors by type, the corrections, the cards created and a link to the review.
- Clear states for an exhausted budget and for no connection, with the composer switched off.

**Done when**

- Stream tests pass with scripted event sequences: a normal turn, an error in the middle, and a retry that leaves no duplicate message.
- The underline covers the right characters in a sentence with accented letters.
- Playwright runs a scenario against a mock stream with one error fixed by the learner and one corrected by the tutor. The summary shows one card.
- During a long reply the view stays at the bottom, unless the learner has scrolled up.

**Not in scope:** prompts, the pipeline on the server.

## Phase 2: Integration

Phase 2 joins the three tracks, replaces every stand in with the real part, and proves the result on real content and a real phone. Its packages may fix bugs in any feature folder, each as a small pull request named after the package that owns the folder.

### I1 End to end integration

**Goal.** The real client on the real API in local mode, with the daily loop proven by browser tests.

- **Depends on:** B1 to B9, M1 to M6
- **Unblocks:** I4, I5
- **Owns:** `e2e/**`, the browser test job in CI, the demo seed script
- **Read first:** every handoff note of phase 1, Build phases, Environment and run modes

**Build**

- `pnpm e2e`: it starts the API in local mode with PGlite, the dev login and a mock gateway with scripted tutor answers, and the client without the mock server.
- A check at start up that every port resolves to its real implementation. Only the gateway stays a mock.
- Browser flows for the seven features: the first run with onboarding and placement, a review session with sync, import and reading with a capture that shows up in review, a lesson with its checkpoint and cards, a trainer session that moves mastery, sorting of common words, a tutor scenario with one fixed and one corrected error, and export and deletion.
- Response validation left on during the flows, so any drift between an API response and its contract fails a test.
- Fixes for every mismatch between client and server, each made where the fault lies.
- `pnpm seed:demo`, which creates a learner with a few weeks of history.

**Done when**

- All flows pass in CI at 390 by 844, three runs in a row.
- No port resolves to a stand in outside tests, apart from the gateway in mock mode.
- The handoff note lists each mismatch that was found and where it was fixed.

**Not in scope:** the quality of the real model, cloud deployment.

### I2 Full content build and load

**Goal.** The real content set, generated, verified, reviewed and loaded.

- **Depends on:** C1 to C5, B2, B3, B8, F8, the Claude API key, and your approval of the estimated spend
- **Unblocks:** I5
- **Owns:** the final files in `content/generated/`, the reports in `content/build/`, `docs/content-build.md`
- **Read first:** Content pipeline, the handoff notes of C1 to C5

**Build**

- A dry run of every stage on the full data, with one total of requests and estimated cost. The paid run starts only after you approve that number.
- The paid run through the Batch API, stage by stage, with the on disk cache so that a restart sends nothing twice.
- Review reports: 100 random sentences, 100 exercises and 100 glosses checked by a second model pass, and 30 items picked for you to look at.
- The analysis of the twelve library texts with the real analyzer, imported from `apps/api`, and the real gateway.
- The load into the development database, with the rank limit if the size demands it, and a new content version.
- Fixes to pipeline stages where the full data reveals a bug, each as a small pull request.

**Done when**

- `validate` passes on the full set.
- The counts reach the targets of the Data model section: 3,000 lemmas with a gloss and two sentences, 40 exercises for each bucket, 200 triggers, 12 scenarios and 12 texts. A shortfall is listed with its reason.
- The preview deployment reports the new content version, and the smoke script passes against it.
- The real spend is recorded beside the estimate, and the database size beside the plan's limit.

**Not in scope:** tuning of the tutor prompts.

### I3 Model evals and prompt tuning

**Goal.** Numbers for how well the model finds case errors and reads Slovak forms, and prompts tuned until those numbers can be trusted.

- **Depends on:** B2, B3, B8, B9, C1, the Claude API key, and your approval of the estimated spend
- **Unblocks:** I6
- **Owns:** `tools/evals/**`, `docs/evals.md`. New prompt versions go to the prompt folders as small pull requests.
- **Read first:** AI integration (Evals), the handoff notes of B3, B8 and B9

**Build**

- Runners that import the analyzer and the steps of the tutor turn from `apps/api`, and call the real gateway.
- Three datasets from the UD Slovak treebank: 300 correct sentences, 300 sentences with one injected case error, and 500 sentences with the checked lemma and case of every word.
- The injection: pick a noun phrase, swap its forms into another case of the same lemmas through the morphology data, and keep the agreement inside the phrase. The label holds position, expected form and case.
- The tutor eval: precision and recall of found errors, the share of exact expected forms, and the rate of false corrections on correct sentences, split by case and by kind of trigger.
- A measurement of the verification step: how many false corrections the morphology check removes.
- The analyzer eval: accuracy of lemma and case, split by how the reading was chosen.
- Rule checks on tutor replies: length, a question present when prompting, and no form mentioned that was not verified.
- Cost and delay per route, taken from the usage numbers.
- A comparison with a cheaper model on the routes `tutor.reply` and `reader.disambiguate`. The choice stays with you.

**Done when**

- `docs/evals.md` reports every metric with its dataset size, and each run can be repeated from cached model answers.
- The proposed targets are met, or the shortfall is explained: false corrections on correct sentences at most 2% after verification, at least 85% of injected errors found, and case accuracy of the analyzer at least 95%.
- Each prompt version in use is recorded with its scores.

**Not in scope:** screens, new features.

### I4 Offline, sync and install hardening

**Goal.** The app behaves on a bad connection, on two devices and across updates.

- **Depends on:** I1
- **Unblocks:** I6
- **Owns:** `e2e/offline/**`. From here on it also owns fixes in `apps/web/src/lib/`.
- **Read first:** Mobile client (State and offline), Review engine (Sync), the handoff notes of F6, M2 and B1

**Build**

- Browser tests against the real API for offline use: review, trainer, reader and word sorting done offline and synced later.
- Tests for the hard moments: the app closed in the middle of a sync, a sync sent twice, a login that expired while offline, and one item the server rejects while the others go through.
- A visible state for an item that could not be synced, with a way to retry or discard it.
- Two devices: two browser contexts of the same learner answer the same card offline, and both converge after syncing.
- Storage: a request for persistent storage, a clear message when the local database is unavailable, and local data wiped on sign out.
- Updates: a new service worker prompts, reloads, and keeps the outbox.
- Performance checks: the size budget, virtualised lists, and start up time on a slowed down profile.
- A written checklist of the points that only a real iPhone can show: the install hint, safe areas, the keyboard beside the accent bar, and zoom on input fields.

**Done when**

- Every test of the offline list passes in CI.
- The two device test ends with identical card states on both sides and on the server.
- The checklist for the phone test exists in `docs/acceptance.md`.

**Not in scope:** new features.

### I5 Production readiness

**Goal.** A production deployment that is safe for daily use: secured, backed up, observable and correctly attributed.

- **Depends on:** F8, I1, I2
- **Unblocks:** I6
- **Owns:** `.github/workflows/backup.yml` and `health.yml`, `docs/runbook.md`, `docs/privacy.md`, and the attribution data shown on the about screen
- **Read first:** Auth and security, Risks, `docs/deploy.md`

**Build**

- Production migrations, the production content load, and the production variables. New sign ups are switched off once your account exists.
- A security pass: the isolation tests against production with test users that are removed afterwards, a content security policy without inline scripts, same origin requests only, the rate limits, a secret scan in CI and a dependency audit.
- Backups: a weekly dump of schema `app` through a read only role that may bypass row level security, as Supabase's own guide recommends. The dump is encrypted with a key you hold and kept for 90 days.
- A restore drill into a scratch database, written down step by step.
- Monitoring: logs with request ids, a daily health call that also keeps the free database awake, and a daily look at the model spend from `ai_call`.
- The attribution list built from `content/SOURCES.md`, and a privacy note: what is stored, what is sent to the model provider, and how to export and delete.
- The runbook: deploy, roll back, rotate keys, restore, wake a paused project, and change the model of a route.

**Done when**

- The production address serves the app, and the smoke script passes against it.
- The isolation tests passed on production, and the restore drill succeeded once.
- The health workflow is scheduled, and the runbook covers each task above.

**Not in scope:** a public launch with captcha, an own mail sender and terms of use.

### I6 Acceptance on a real phone

**Goal.** You use the seven features on your own phone and sign off, or hand back a short list of fixes.

- **Depends on:** I3, I4, I5
- **Unblocks:** the first release
- **Owns:** `docs/acceptance.md`
- **Read first:** Scope of the first release, the checklist from I4

**Build**

- A guided checklist: install to the home screen, sign up with a code, placement, ten reviews with some in flight mode, the first lesson, a trainer session, an imported article, sorting of common words, one tutor scenario, export.
- A second look after a week of use: sync between sessions, the cost so far, and anything that felt wrong in a correction.
- Each issue you report becomes a fix in the owning folder, and the affected browser tests run again.

**Done when**

- You have ticked each of the seven features.
- Every open issue is fixed or moved to the list for the next release.

**Not in scope:** new features.
