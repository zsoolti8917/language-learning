import { readFileSync } from 'node:fs';
import { ENDPOINT_COUNT, endpointList } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { GENERATED_PATH, renderEndpointsFile } from '../../../scripts/endpoints-gen';
import { ENDPOINT_META } from './endpoints.gen';

describe('generated endpoint table', () => {
  it('is up to date with @app/contracts (run `pnpm --filter @app/web gen:endpoints`)', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderEndpointsFile());
  });

  it('holds every endpoint with its method, path and status', () => {
    expect(Object.keys(ENDPOINT_META)).toHaveLength(ENDPOINT_COUNT);
    for (const e of endpointList) {
      const meta = ENDPOINT_META[e.name as keyof typeof ENDPOINT_META];
      expect(meta).toMatchObject({
        method: e.method,
        path: e.path,
        status: e.status,
        auth: e.auth,
      });
    }
    expect(
      Object.entries(ENDPOINT_META)
        .filter(([, m]) => m.stream)
        .map(([n]) => n),
    ).toEqual(['tutor.sendMessage']);
  });
});
