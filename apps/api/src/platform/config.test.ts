import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, modelVariable } from './config';

const LOCAL = { APP_ENV: 'local', DB_MODE: 'pglite', AUTH_MODE: 'dev', AI_MODE: 'mock' };
const PROD = {
  APP_ENV: 'production',
  DB_MODE: 'postgres',
  DATABASE_URL: 'postgres://app_api@localhost:6543/postgres',
  AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://ref.supabase.co/',
  AI_MODE: 'anthropic',
  ANTHROPIC_API_KEY: 'test-key',
};

describe('loadConfig', () => {
  it('reads local mode and validates responses there', () => {
    const c = loadConfig(LOCAL);
    expect(c).toMatchObject({ appEnv: 'local', dbMode: 'pglite', authMode: 'dev', aiMode: 'mock' });
    expect(c.validateResponses).toBe(true);
    expect(c.aiDailyBudgetUsd).toBe(1);
    expect(c.port).toBe(8787);
  });

  it('reads production, model overrides and the budget', () => {
    const c = loadConfig({ ...PROD, AI_MODEL_TUTOR_REPLY: 'claude-x', AI_DAILY_BUDGET_USD: '2.5' });
    expect(c.supabaseUrl).toBe('https://ref.supabase.co');
    expect(c.aiModels).toEqual({ 'tutor.reply': 'claude-x' });
    expect(c.aiDailyBudgetUsd).toBe(2.5);
    expect(c.validateResponses).toBe(false);
    expect(modelVariable('reader.disambiguate')).toBe('AI_MODEL_READER_DISAMBIGUATE');
  });

  it('refuses the dev login and the mock gateway in production', () => {
    expect(() => loadConfig({ ...PROD, AUTH_MODE: 'dev' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...PROD, AUTH_MODE: 'dev' })).toThrow(/dev login/);
    expect(() => loadConfig({ ...PROD, AI_MODE: 'mock' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...LOCAL, APP_ENV: 'production' })).toThrow(ConfigError);
  });

  it('asks for the values each mode needs', () => {
    expect(() => loadConfig({ ...PROD, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...PROD, SUPABASE_URL: undefined })).toThrow(/SUPABASE_URL/);
    expect(() => loadConfig({ ...PROD, ANTHROPIC_API_KEY: '' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ ...LOCAL, DB_MODE: 'sqlite' })).toThrow(/DB_MODE/);
  });
});

describe('the process', () => {
  it('refuses to start with the dev login when APP_ENV is production', () => {
    const server = fileURLToPath(new URL('../server.ts', import.meta.url));
    const r = spawnSync(process.execPath, ['--import', 'tsx', server, '--local'], {
      env: { PATH: process.env.PATH, APP_ENV: 'production' },
      encoding: 'utf8',
      timeout: 50_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Refusing to start: AUTH_MODE=dev');
  }, 60_000);
});
