import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes a migration from the schema. Roles, grants and forced row
// level security live in the custom migrations around the generated one.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['app', 'ling'],
  strict: true,
  verbose: true,
});
