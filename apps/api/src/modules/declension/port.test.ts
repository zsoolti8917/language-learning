// The real AttemptsPort passes the shared suite of its port.
import { runAttemptsSuite } from '../../testing/suites/attempts';
import { createAttemptsPort } from './port';

runAttemptsSuite('real', (ctx) => createAttemptsPort(ctx));
