// Import rules of the repository (docs/contracts.md, "Import rules").
// Pure functions, so the rules can be tested without touching the file system.

/** Which workspace packages each workspace package may import. */
export const ALLOWED = {
  '@app/contracts': [],
  '@app/ling': ['@app/contracts'],
  '@app/srs': ['@app/contracts', '@app/ling'],
  '@app/db': ['@app/contracts'],
  '@app/ai': ['@app/contracts'],
  '@app/testkit': ['@app/contracts', '@app/db'],
  '@app/api': ['@app/contracts', '@app/db', '@app/srs', '@app/ling', '@app/ai', '@app/testkit'],
  '@app/web': ['@app/contracts', '@app/srs', '@app/ling'],
  '@app/pipeline': [
    '@app/contracts',
    '@app/db',
    '@app/ling',
    '@app/ai',
    '@app/srs',
    '@app/testkit',
    '@app/api',
  ],
  '@app/evals': [
    '@app/contracts',
    '@app/db',
    '@app/ling',
    '@app/ai',
    '@app/srs',
    '@app/testkit',
    '@app/api',
  ],
  '@app/e2e': ['@app/contracts', '@app/testkit'],
};

/** Packages that must do no input or output: no node built-ins. */
export const PURE = new Set(['@app/contracts', '@app/ling', '@app/srs']);

/** Third party packages only one package may import. */
export const EXCLUSIVE = {
  'ts-fsrs': ['@app/srs'],
  '@anthropic-ai/sdk': ['@app/ai', '@app/pipeline'],
};

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Extracts every module specifier from source text. */
export function importsOf(source) {
  const out = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function packageOf(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Checks one file. `pkg` is the owning package name, `file` its path relative
 * to the package root (posix), `source` the text.
 * Returns a list of human readable violations.
 */
export function checkFile(pkg, file, source) {
  const errors = [];
  const allowed = ALLOWED[pkg];
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes('/testing/');
  for (const spec of importsOf(source)) {
    if (spec.startsWith('.')) {
      const depth = file.split('/').length - 1;
      const ups = spec.split('/').filter((s) => s === '..').length;
      if (ups > depth) errors.push(`${pkg}/${file}: relative import "${spec}" leaves the package`);
      // An API module reaches another module only through ports.ts.
      const mod = file.match(/^src\/modules\/([^/]+)\//);
      if (mod) {
        const target = new URL(spec, `file:///${file}`).pathname.slice(1);
        const tmod = target.match(/^src\/modules\/([^/]+)\//);
        if (tmod && tmod[1] !== mod[1])
          errors.push(
            `${pkg}/${file}: module "${mod[1]}" imports module "${tmod[1]}" directly. Use ports.ts.`,
          );
      }
      continue;
    }
    const name = packageOf(spec);
    if (name.startsWith('@app/')) {
      if (name === pkg) errors.push(`${pkg}/${file}: imports itself by name ("${spec}")`);
      else if (!allowed) errors.push(`${pkg}/${file}: unknown package`);
      else if (!allowed.includes(name)) {
        // testkit is allowed in api only for tests
        errors.push(`${pkg}/${file}: may not import ${name}`);
      } else if (name === '@app/testkit' && pkg === '@app/api' && !isTest) {
        errors.push(`${pkg}/${file}: @app/testkit may be imported only by tests`);
      }
      continue;
    }
    if (
      PURE.has(pkg) &&
      (spec.startsWith('node:') ||
        ['fs', 'path', 'http', 'https', 'net', 'child_process', 'os'].includes(name)) &&
      !isTest
    )
      errors.push(
        `${pkg}/${file}: does input or output through "${spec}", which this package must not do`,
      );
    const only = EXCLUSIVE[name];
    if (only && !only.includes(pkg))
      errors.push(`${pkg}/${file}: only ${only.join(', ')} may import ${name}`);
  }
  return errors;
}

/** Checks the workspace dependencies declared in a package.json. */
export function checkManifest(pkg, manifest) {
  const errors = [];
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const d of Object.keys(deps)) {
    if (d.startsWith('@app/') && !(ALLOWED[pkg] ?? []).includes(d))
      errors.push(`${pkg}/package.json: may not depend on ${d}`);
  }
  return errors;
}
