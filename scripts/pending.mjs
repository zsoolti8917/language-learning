// Placeholder for a script whose owning work package has not been built yet.
// Usage: node scripts/pending.mjs <package id> <script name>
const [id = '?', name = 'this script'] = process.argv.slice(2);
console.error(
  `"${name}" is not built yet. Work package ${id} provides it (see docs/work-packages.md).`,
);
process.exit(1);
