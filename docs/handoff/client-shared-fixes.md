# Client shared fixes (F6, F7 follow ups for M1 to M6)
Status: done

Branch `wp/client-shared-fixes`. The shared client changes that M1 to M6 asked for in their handoff notes, made by the F6 and F7 owner, plus two contract example fixes.

## What was built
| # | Change | Where |
|---|---|---|
| 1 | Mock helpers moved out of the module that globs the feature mocks: `mockEndpoint`, `mockError`, `mockNetworkError`, `sseResponse`, `endpointPattern`, `exampleHandler`, `defaultHandlers` live in `src/mocks/endpoint.ts`; `src/mocks/handlers.ts` re-exports them and adds the glob. A feature's `mocks.ts` imports `../../mocks/endpoint` and may call `mockEndpoint` at module load. `src/test/utils` re-exports from `endpoint`. | `apps/web/src/mocks/` |
| 1 | Local workarounds replaced by the shared helper: `words/mockHttp.ts` (now `featureMock` = `mockEndpoint`, plus `errorResponse`), the local copies in `cases/mocks.ts` and `reader/mocks.ts`, the plain MSW handlers in `review/mocks.ts` and `tutor/mocks.ts`. The fall through handlers (reader `library.add` and `notes.create`, cases `notes.list`) stay plain `http.*` on the shared `endpointPattern`, because `mockEndpoint` always answers. | `features/{words,cases,reader,review,tutor}/mocks.ts` |
| 2 | `src/lib/api/client.test.ts` puts `defaultHandlers` first (`server.use`) before each endpoint check, so it tests the contract examples only. The "mocks off under Vitest" switches are gone: review (`MODE === 'test'`), cases (`handlers = []`), words and placement (`enableFeatureMocks`, removed with its calls in `words.test.tsx` and `placement.test.tsx`). All web tests stay green with every feature mock on. | |
| 3 | Saved theme before the first paint: an inline script in `index.html` reads `localStorage['app.theme']` (M1's key) in try/catch and sets `data-theme` for `light` or `dark`. Tested by running the script from `index.html` (`src/app/themeBoot.test.ts`). | `apps/web/index.html` |
| 4 | `VITE_APP_VERSION` set in `vite.config.ts`: web `package.json` version plus the short git sha (`0.0.0+4d9c14b`); `VERCEL_GIT_COMMIT_SHA` when there is no `.git`; an environment value wins. About shows it. | `apps/web/vite.config.ts` |
| 5 | Offline indicator and update prompt in the tab layout for every tab screen: `lib/pwa/notices.tsx` (`OfflineIndicator`, `UpdatePrompt`, `PwaNotices`), texts in the shell's `messages/en.ts` (`notices.*`, same English as M1's). M1's `AppNotices` now renders only the iOS install hint (re-exports the two others), so Today and Settings show no duplicate. M1's notice tests and `today.e2e.ts` use the shell texts; the moved keys left `features/today/messages.ts`. | `src/app/layouts.tsx` |
| 6 | `/verify` takes an optional `email` search param (trimmed, must contain `@`, ≤ 320 chars, else dropped). M1 still uses its sessionStorage hand over; it can read `useSearch({ strict: false }).email` later. | `src/routes.tsx` |
| 7 | Playwright: every config (shell, gallery, the six feature configs) reads its port from the environment and never reuses an existing server (`reuseExistingServer: false`). Shell: `E2E_MOCK_PORT`, `E2E_PWA_PORT`, `E2E_MOCK_DIST_DIR`, `E2E_PWA_DIST_DIR`; others `E2E_PORT` and, when they build, `E2E_DIST_DIR`. `pnpm --filter @app/web e2e:all` (`scripts/e2e-all.mjs`) runs shell, gallery, account, review, reader, cases, words, tutor one after another, each on free ports with its own build folder under `apps/web/node_modules/.cache/e2e/<suite>`; names select suites, args after `--` go to Playwright. CI: new job `e2e` after `check` (`playwright install --with-deps chromium`, then `e2e:all`, results uploaded on failure). | `apps/web/e2e-*/`, `features/*/e2e/playwright.config.ts`, `.github/workflows/ci.yml` |
| 8 | Async test timeouts: the web Vitest setup sets Testing Library's `asyncUtilTimeout` to 5 s (was 1 s), `testTimeout` 30 s (was 15 s); `routes.test.tsx` route checks wait up to 10 s. New route tests: `/verify` email param, offline indicator on a tab screen. | `src/test/setup.ts`, `vite.config.ts`, `src/routes.test.tsx` |
| 9 | Contracts: the example scheduler states are real `@app/srs` states (`v: 'fsrs7.1'`, Good, Good, Hard, Good on their due dates, retention 0.9, computed with `replay`). `CARD_MESTO` (last answer at `NOW`, the `review.submitAnswers` example) now has the snapshot of that state: due `2026-12-26T14:18:07.362Z`, stability 26.6, difficulty 6.04, reps 4. The `review.queue` case card has its own state (`SCHEDULER_CASE_CARD`, due at `EARLIER`). `docs/openapi.json` regenerated; `endpoints.gen.ts` unchanged. `src/mocks/examples.test.ts` parses and schedules every scheduler state in the examples. M2's `DeckScreen.test.tsx` expected the old stability ("4.9 days"); it now expects "26.6 days". | `packages/contracts/src/fixtures/` |
| 10 | Design system: `Textarea` (Input's look and API plus textarea props, at least 3 rows, optional counter against `maxLength` read out through `aria-describedby`, `countLabel`) and `ProgressBar` (linear `role="progressbar"`, clamped, `valueText`, optional visible label, `size` sm or md, `color`). Exported from `ui/index.ts`, documented in `ui/README.md`, in the gallery (sections Textarea and ProgressBar, also in `gallery.e2e.ts`), tests in `ui/fields.test.tsx`. No existing component changed; no feature rewired. | `apps/web/src/ui/` |

## How to run and test it
- `pnpm check`: passes (see the final report for the counts).
- `pnpm --filter @app/web e2e:all`: results below.
- One suite: `pnpm --filter @app/web e2e:all reader`.

Playwright on 2026-11-17 (`e2e:all`, cloud container, Chromium from /opt/pw-browsers): 69 passed, 0 failed. Shell 28, gallery 16 (now with the Textarea and ProgressBar sections), account and Today 8, review 2, reader 2, cases 5, words and placement 4, tutor 4.

## Differences from the specification, and why
- Feature Playwright configs are feature files, but the port and reuse change is mechanical and needed for `e2e:all`; their defaults (ports, folders, `M1_E2E_PORT`, `READER_E2E_PORT`) still work.
- The shell's offline text is M1's English sentence, now in `messages/en.ts`; it says reviews, the trainer and opened texts still work, which fits every tab.
- The theme boot is an inline script in `index.html`, not code in `main.tsx`: the module script runs after the first paint could happen.

## Known gaps and follow ups
- `account/mocks.ts` and `today/mocks.ts` keep their plain MSW handlers (they need fall through to the examples, which `mockEndpoint` cannot do); nothing to fix there.
- `cases/test-helpers.ts` and the review tests still add their handlers with `server.use(...)`; harmless now that the handlers are on anyway.
- With feature mocks on under Vitest, a test that wants the bare contract example for an endpoint a feature overrides must `server.use(exampleHandler(name))`.
- Reader and words both mock `lemmas.setStatus`; the reader's wins (glob order), as in the browser.
- M3's import textarea, M5's placement bar and M6's single line composer can move to `Textarea` / `ProgressBar` in their own packages.

## Notes for packages that depend on this one
- Backend (B packages): `CARD_MESTO` and the `review.queue` example changed values (see 9). A test that compares with the example object is unaffected; one that hard coded `4.93` or `TOMORROW` for the mesto card must follow.
- I1: the scheduler states in the examples are what `@app/srs` writes; the server must store and return `ReviewItem.scheduler` in that shape.
- Every feature: import mock helpers from `src/mocks/endpoint` in `mocks.ts`; your handlers are live in every web test.
