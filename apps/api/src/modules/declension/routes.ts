// HTTP handlers of the declension module. Owner: B5.
import { route } from '../../platform/route';
import * as service from './service';

/** The largest seed a session takes (the contract accepts any non negative integer). */
const MAX_SEED = 2 ** 31 - 1;

export const routes = [
  route('declension.course', ({ userId, withUser }) =>
    withUser((tx) => service.getCourse(tx, userId)),
  ),
  route('declension.lesson', ({ params, userId, withUser }) =>
    withUser((tx) => service.getLesson(tx, userId, params.id)),
  ),
  route('declension.saveProgress', ({ params, body, userId, withUser, ports, deps }) =>
    withUser((tx) =>
      service.saveProgress(tx, { userId, now: deps.clock.now(), ports }, params.id, body),
    ),
  ),
  route('declension.createSession', ({ body, userId, withUser, ports, deps }) => {
    const seed = body.seed ?? Math.floor(Math.random() * MAX_SEED);
    const sessionId = deps.ids.uuid();
    return withUser((tx) =>
      service.createSession(tx, { userId, now: deps.clock.now(), ports }, body, sessionId, seed),
    );
  }),
  route('declension.submitAttempts', ({ body, userId, withUser, ports, deps }) =>
    withUser((tx) => service.submitAttempts(tx, { userId, now: deps.clock.now(), ports }, body)),
  ),
  route('declension.pattern', ({ params, withUser }) =>
    withUser((tx) => service.getPattern(tx, params.id)),
  ),
];
