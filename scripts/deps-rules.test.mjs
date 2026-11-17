import { describe, expect, it } from 'vitest';
import { checkFile, checkManifest, importsOf } from './deps-rules.mjs';

describe('dependency rules', () => {
  it('finds static, type, dynamic and re-export imports', () => {
    const src = `import a from 'x';\nimport type { B } from "@app/db";\nexport * from './y';\nconst c = await import('z');`;
    expect(importsOf(src)).toEqual(['x', '@app/db', './y', 'z']);
  });

  it('rejects a deliberately wrong import', () => {
    expect(
      checkFile('@app/contracts', 'src/index.ts', `import { x } from '@app/db';`),
    ).toHaveLength(1);
    expect(checkFile('@app/web', 'src/a.ts', `import { x } from '@app/api';`)).toHaveLength(1);
    expect(
      checkFile('@app/ling', 'src/a.ts', `import { readFileSync } from 'node:fs';`),
    ).toHaveLength(1);
    expect(
      checkFile('@app/api', 'src/a.ts', `import { Anthropic } from '@anthropic-ai/sdk';`),
    ).toHaveLength(1);
    expect(checkFile('@app/web', 'src/a.ts', `import { fsrs } from 'ts-fsrs';`)).toHaveLength(1);
    expect(
      checkFile(
        '@app/api',
        'src/modules/review/service.ts',
        `import { x } from '../tutor/service';`,
      ),
    ).toHaveLength(1);
    expect(checkFile('@app/api', 'src/app.ts', `import { x } from '@app/testkit';`)).toHaveLength(
      1,
    );
    expect(
      checkFile('@app/db', 'src/a.ts', `import x from '../../../apps/api/src/app';`),
    ).toHaveLength(1);
  });

  it('accepts allowed imports', () => {
    expect(
      checkFile(
        '@app/srs',
        'src/a.ts',
        `import { x } from '@app/ling';\nimport { fsrs } from 'ts-fsrs';`,
      ),
    ).toEqual([]);
    expect(
      checkFile(
        '@app/api',
        'src/modules/review/routes.ts',
        `import { s } from './service';\nimport { p } from '../../ports';`,
      ),
    ).toEqual([]);
    expect(
      checkFile('@app/api', 'src/modules/review/a.test.ts', `import { t } from '@app/testkit';`),
    ).toEqual([]);
  });

  it('checks declared workspace dependencies', () => {
    expect(
      checkManifest('@app/contracts', { dependencies: { '@app/db': 'workspace:*' } }),
    ).toHaveLength(1);
    expect(checkManifest('@app/srs', { dependencies: { '@app/ling': 'workspace:*' } })).toEqual([]);
  });
});
