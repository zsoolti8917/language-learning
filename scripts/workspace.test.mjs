import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const dirs = ['apps', 'packages', 'tools']
  .flatMap((d) => readdirSync(join(ROOT, d)).map((e) => join(ROOT, d, e)))
  .concat(join(ROOT, 'e2e'))
  .filter((d) => existsSync(join(d, 'package.json')));

describe('workspace', () => {
  for (const dir of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
      d.startsWith('@app/'),
    );
    it(`${pkg.name} resolves its workspace dependencies by name`, () => {
      const req = createRequire(join(dir, 'package.json'));
      for (const d of deps) {
        const resolved = req.resolve(d);
        expect(resolved).toMatch(/src\/index\.ts$/);
      }
    });
  }
});
