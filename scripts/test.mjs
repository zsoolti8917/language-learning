// Runs Vitest across the workspace.
//   pnpm test                      every project
//   pnpm test --filter <package>   one project, by package name (@app/ling or ling)
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const out = ['run'];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--filter' || a === '-F') {
    const name = args[++i] ?? '';
    out.push('--project', name.startsWith('@app/') ? name : `@app/${name}`);
  } else if (a.startsWith('--filter=')) {
    const name = a.slice('--filter='.length);
    out.push('--project', name.startsWith('@app/') ? name : `@app/${name}`);
  } else {
    out.push(a);
  }
}
const r = spawnSync('vitest', out, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
