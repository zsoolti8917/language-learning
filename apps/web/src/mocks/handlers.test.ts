import { ENDPOINT_COUNT, examples } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { api } from '../lib/api';
import { server } from '../test/utils';
import {
  defaultHandlers,
  endpointPattern,
  featureHandlers,
  handlers,
  mockEndpoint,
} from './handlers';

describe('mock server', () => {
  it('has one default handler per endpoint, after the feature handlers', () => {
    expect(defaultHandlers).toHaveLength(ENDPOINT_COUNT);
    expect(handlers).toEqual([...featureHandlers, ...defaultHandlers]);
  });

  it('matches paths under the API base, relative or absolute', () => {
    expect(endpointPattern('notes.get')).toBe('*/api/v1/notes/:id');
    expect(endpointPattern('notes.get', 'https://api.example.test/api/v1/')).toBe(
      'https://api.example.test/api/v1/notes/:id',
    );
  });

  it('lets a test override one endpoint and passes the parsed request', async () => {
    server.use(
      mockEndpoint('library.add', ({ params, body }) => ({
        id: body.id,
        status: `${params.id}` as never,
      })),
    );
    await expect(api.library.add({ params: { id: 'lib-1' }, body: { id: 'x' } })).resolves.toEqual({
      id: 'x',
      status: 'lib-1',
    });
    server.resetHandlers();
    await expect(api.library.add({ params: { id: 'lib-1' }, body: { id: 'x' } })).resolves.toEqual(
      examples['library.add'].ok[0]?.response.body,
    );
  });
});
