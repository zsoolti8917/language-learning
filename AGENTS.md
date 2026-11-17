# Rules for agents

You start with no memory of this project. This repository tells you everything.

## Read first
1. This file.
2. `docs/architecture.md`, the design.
3. `docs/contracts.md`, the reference: folders, tables, endpoints, shared shapes, ports.
4. Your own section in `docs/work-packages.md`. It is your whole task.
5. `docs/handoff/<ID>.md` of every package you depend on.

If the specification and the repository disagree, follow the repository and record the difference in your handoff note.

## Setup
- Node 24 (`nvm use`, or `/opt/node24/bin` in the cloud containers) and pnpm 12 (`corepack enable` or `npm i -g pnpm@12.21.0`).
- `pnpm install`, then `pnpm check`.

## Rules
- **Work only in the paths your package owns** (see your specification). A change anywhere else is a small pull request of its own that merges first.
- **Shared surfaces** are `packages/contracts`, the database schema and migrations in `packages/db`, design tokens in `apps/web/src/ui`, `apps/web/src/lib`, `apps/web/src/routes.tsx`, `apps/api/src/ports.ts`, `apps/api/src/container.ts`, `apps/api/src/platform`, the route table, root files and every dependency list. Do not change them inside a feature package.
- **Dependencies are pinned** in the catalog of `pnpm-workspace.yaml` and referenced as `catalog:`. A new dependency is a shared surface change. A package's owner may add `scripts` to its own `package.json`.
- **Imports point one way** (`docs/contracts.md`, Import rules). `pnpm deps:check` enforces them: `contracts` imports nothing from the repository; `ling` and `srs` do no input or output; only `srs` imports `ts-fsrs`; only `ai` (and the pipeline's batch runner) import `@anthropic-ai/sdk`; API modules reach each other only through `ports.ts`; inside a module only `repo.ts` runs SQL.
- **Read the installed documentation** of every library you touch (`node_modules/<pkg>`). Vite 8, TypeScript 7, Vitest 5, MSW 3, Zod 4, ts-fsrs 6, pnpm 12 and the Anthropic SDK 1.x differ from older versions.
- **Tests never reach the network**: no real model call, no real Supabase. Use the mock gateway, PGlite and the mini dataset.
- **No network call while a database transaction is open.**
- **Secrets never enter the repository**, a log or a handoff note.
- **Interface text** goes into the messages file. A Slovak form you are unsure of is checked against the dataset, never guessed.
- **Tests sit beside the code** (`*.test.ts`). Import `describe`, `it`, `expect` from `vitest`; there are no globals.

## Commands
| Command | Does |
|---|---|
| `pnpm check` | Type check (`tsc -b`), lint (Biome), unit tests (Vitest), dependency check. CI runs exactly this. |
| `pnpm test --filter <package>` | Tests of one package, e.g. `pnpm test --filter ling` |
| `pnpm format` | Biome format and safe fixes |
| `pnpm dev` | API and client in local mode (F5, F6) |
| `pnpm run pipeline <stage>` | One content pipeline stage. Use `run`: pnpm 12 has a built-in `pipeline` command that hides the bare form. |

## Finish
- Branch `wp/<id>-<slug>`, one pull request, CI green.
- Write `docs/handoff/<ID>.md` from `docs/handoff/TEMPLATE.md`.
- If a piece from another package is missing, stop and report it. Do not build that piece yourself.
