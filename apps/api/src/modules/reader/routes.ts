// HTTP handlers of the reader module. Owner: B4. Each handler opens the learner's transaction
// and passes it to the service; the analysis and the translation run their model or analyzer
// call between transactions (service.ts, ReaderEnv).

import type { AppDeps } from '../../platform/deps';
import { route } from '../../platform/route';
import * as service from './service';

function envOf(deps: AppDeps): service.ReaderEnv {
  return {
    database: deps.database,
    clock: deps.clock,
    analyzer: deps.ports.analyzer,
    ai: deps.ai,
    background: deps.background,
  };
}

export const routes = [
  route('texts.create', async ({ body, userId, withUser, deps, c }) => {
    const out = await withUser((tx) => service.createText(tx, userId, body, deps.clock.now()));
    // A repeated id answers with the stored status and 200, as every create does.
    if (out.repeated) return c.json(out.result, 200);
    service.analyseInBackground(envOf(deps), userId, out.result.id, body.body);
    return out.result;
  }),
  route('texts.list', ({ query, withUser }) => withUser((tx) => service.listTexts(tx, query))),
  route('texts.get', ({ params, withUser, deps }) =>
    withUser((tx) => service.getText(tx, params.id, deps.clock.now())),
  ),
  route('texts.update', ({ params, body, withUser, deps }) =>
    withUser((tx) => service.updateText(tx, params.id, body, deps.clock.now())),
  ),
  route('texts.delete', async ({ params, withUser }) => {
    await withUser((tx) => service.deleteText(tx, params.id));
    return undefined;
  }),
  route('texts.translateSentence', ({ params, userId, deps }) =>
    service.translateSentence(envOf(deps), userId, params.id, params.n),
  ),
  route('library.list', ({ withUser }) => withUser((tx) => service.listLibrary(tx))),
  route('library.add', async ({ params, body, userId, withUser, deps }) => {
    const out = await withUser((tx) =>
      service.addLibraryText(tx, userId, params.id, body.id, deps.clock.now()),
    );
    if (out.analyse) service.analyseInBackground(envOf(deps), userId, body.id, out.body);
    return out.result;
  }),
];
