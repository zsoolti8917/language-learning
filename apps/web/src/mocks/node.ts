// The mock server in Node, for Vitest. `src/test/setup.ts` starts it for every test file.
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
