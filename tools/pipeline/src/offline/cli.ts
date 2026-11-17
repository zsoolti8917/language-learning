// Helpers for an offline fill (`--fill offline`): read the open requests of a stage and check
// the answer files before the stage reads them. Nothing here calls a model.
//
//   pnpm --filter @app/pipeline run offline list <stage> [route]
//   pnpm --filter @app/pipeline run offline show <stage> <route> [hash...]
//   pnpm --filter @app/pipeline run offline lint <stage> <route> [hash...]
//   pnpm --filter @app/pipeline run offline hints <stage> <route> [hash...]
//   pnpm --filter @app/pipeline run offline slots <bucket>
//   pnpm --filter @app/pipeline run offline put <stage> <route> <items.jsonl>
//   pnpm --filter @app/pipeline run offline skip <stage> <route> [hash...]
//   pnpm --filter @app/pipeline run offline word <form...>
//   pnpm --filter @app/pipeline run offline forms <lemma...>
//
// A hash may be shortened to a prefix, or be a job id or a bucket (`acc.sg.f`); without
// hashes every open request is meant. `lint` exits with 1 when an answer is missing, refused
// whole or has a rejected item. `slots` shows the open exercise slots of a bucket in one
// table; `put` turns a writer's list of items (one JSON object per line) into the answer
// files of the requests that ask for them, with SKIP for the rest; `skip` answers requests
// nobody wrote with SKIPs. `word` shows what the morphology knows of written forms, `forms`
// every form of a common lemma.
import { resolve } from 'node:path';
import { existsSync } from '../lib/files';
import { findRoot, pathsFor } from '../lib/paths';
import {
  answerPath,
  describeForms,
  describeWords,
  lintRequests,
  OFFLINE_ROUTES,
  openRequests,
  pick,
  putItems,
  renderLint,
  reviewHints,
  showBucket,
  showRequest,
  skipRequests,
  specOf,
  tally,
} from './lint';

const USAGE = `Usage: offline <list|show|lint|hints|skip> <stage> [route] [hash...]
       offline slots <bucket>
       offline put <stage> <route> <items.jsonl>
       offline word <form...>
       offline forms <lemma...>
Stages and routes: ${Object.entries(OFFLINE_ROUTES)
  .map(([s, r]) => `${s} (${Object.keys(r).join(', ')})`)
  .join('; ')}`;

/** Where a relative file argument starts: the folder the command was called from. */
const base = () => process.env.INIT_CWD ?? process.cwd();

export async function main(argv: string[]): Promise<number> {
  const [command, stage, route, ...hashes] = argv;
  const paths = pathsFor(findRoot());
  if ((command === 'word' || command === 'forms') && argv.length > 1) {
    const describe = command === 'word' ? describeWords : describeForms;
    console.log((await describe(paths, argv.slice(1))).join('\n'));
    return 0;
  }
  if (command === 'slots' && stage) {
    console.log((await showBucket(paths, stage)).join('\n'));
    return 0;
  }
  if (!command || !stage || !OFFLINE_ROUTES[stage]) {
    console.log(USAGE);
    return 1;
  }
  if (command === 'list') {
    for (const r of route ? [route] : Object.keys(OFFLINE_ROUTES[stage] ?? {})) {
      const open = await openRequests(paths, stage, r);
      const answered = open.filter((q) => existsSync(answerPath(paths, stage, r, q.hash)));
      console.log(
        `${stage} ${r}: ${open.length} open requests, ${answered.length} with an answer file`,
      );
      for (const q of open)
        console.log(
          `${q.hash}\t${existsSync(answerPath(paths, stage, r, q.hash)) ? 'answered' : 'open'}\t${q.jobs.join(',')}`,
        );
    }
    return 0;
  }
  if (!route) {
    console.log(USAGE);
    return 1;
  }
  specOf(stage, route);
  if (command === 'put') {
    const file = hashes[0];
    if (!file) {
      console.log(USAGE);
      return 1;
    }
    const written = await putItems(paths, stage, route, resolve(base(), file));
    console.log(`${written.length} answer files written`);
    return 0;
  }
  const requests = pick(await openRequests(paths, stage, route), hashes);
  if (command === 'skip') {
    const written = await skipRequests(paths, stage, route, requests);
    console.log(`${written.length} requests answered with SKIPs`);
    return 0;
  }
  if (command === 'show') {
    console.log(requests.map((r) => showRequest(paths, stage, r)).join('\n\n'));
    return 0;
  }
  if (command === 'lint') {
    const reports = await lintRequests(paths, stage, route, requests);
    console.log(renderLint(reports));
    const bad = reports.filter(
      (r) => r.state !== 'checked' || r.items.some((i) => i.errors.length > 0),
    );
    const t = tally(reports);
    console.log(
      `${reports.length} requests checked: ${reports.length - bad.length} clean, ${bad.length} with problems; items: ${t.pass} pass, ${t.rejected} rejected, ${t.skipped} left out`,
    );
    return bad.length > 0 ? 1 : 0;
  }
  if (command === 'hints') {
    for (const r of requests) {
      console.log(`# request ${r.hash}`);
      console.log((await reviewHints(paths, stage, r)).join('\n') || '(no hints)');
    }
    return 0;
  }
  console.log(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
