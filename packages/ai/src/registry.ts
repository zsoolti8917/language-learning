// The prompt registry. It reads the prompt folders (`packages/ai/prompts/<route>/index.ts`
// through `prompts/index.ts`), gives each route the version in use, and builds the system
// blocks of a call: the stable blocks of the version, which end with the cache mark, then the
// per request blocks, which are never cached.
import type { AiRoute } from '@app/contracts';
import { PROMPTS } from '../prompts';
import { currentVersion, type PromptFolder, type PromptVersion } from './prompt';
import type { PromptBlock } from './types';

export interface RegisteredPrompt {
  route: AiRoute;
  version: number;
  /** The stable blocks; the last one carries `cache: true`. */
  system: readonly PromptBlock[];
  placeholder: boolean;
}

/** The version a route has in use, with the cache mark set on its last stable block. */
export function promptFor(
  route: AiRoute,
  folders: Readonly<Record<AiRoute, PromptFolder>> = PROMPTS,
): RegisteredPrompt {
  const folder = folders[route];
  if (!folder) throw new Error(`no prompt folder for route ${route}`);
  const v = currentVersion(folder);
  return {
    route,
    version: v.version,
    system: withCacheMark(v),
    placeholder: v.placeholder === true,
  };
}

/** Every stable block of a version; the last block marked `cache` (or else the last) ends it. */
function withCacheMark(v: PromptVersion): PromptBlock[] {
  const blocks = v.system.map((b) => ({ ...b }));
  let last = -1;
  blocks.forEach((b, i) => {
    if (b.cache) last = i;
  });
  if (last === -1) last = blocks.length - 1;
  return blocks.map((b, i) => (i === last ? { text: b.text, cache: true } : { text: b.text }));
}

/**
 * The system blocks of a call: the route's stable prompt, then `tail` (the scenario, the
 * directive and other per request text), which comes after the cache mark.
 *
 * ```ts
 * const system = systemFor('tutor.reply', [`Scenario: ${scenario.brief}`]);
 * ```
 */
export function systemFor(route: AiRoute, tail: readonly string[] = []): PromptBlock[] {
  return [...promptFor(route).system, ...tail.map((text) => ({ text }))];
}

/** Each route with the version in use, for logs and evals. */
export function promptVersions(): Record<AiRoute, number> {
  const out = {} as Record<AiRoute, number>;
  for (const route of Object.keys(PROMPTS) as AiRoute[]) out[route] = promptFor(route).version;
  return out;
}

const VOLATILE: readonly { what: string; re: RegExp }[] = [
  { what: 'an ISO date', re: /\b\d{4}-\d{2}-\d{2}\b/ },
  { what: 'a numeric date', re: /\b\d{1,2}[./]\s?\d{1,2}[./]\s?\d{2,4}\b/ },
  {
    what: 'a written date',
    re: /\b(january|february|march|april|may|june|july|august|september|october|november|december|janu[aá]r|febru[aá]r|marec|apr[ií]l|m[aá]j|j[uú]n|j[uú]l|august|september|okt[oó]ber|november|december)\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b|\b\d{1,2}\.?\s+(january|february|march|april|may|june|july|august|september|october|november|december|janu[aá]ra|febru[aá]ra|marca|apr[ií]la|m[aá]ja|j[uú]na|j[uú]la|augusta|septembra|okt[oó]bra|novembra|decembra)\s+\d{4}\b/i,
  },
  { what: 'a time of day', re: /\b\d{1,2}:\d{2}(:\d{2})?\b/ },
  { what: 'a uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { what: 'a long random looking number', re: /\d\.\d{8,}|\b\d{10,}\b/ },
];

/**
 * Problems that make a stable prompt change between requests and break the cache: dates,
 * times, ids or random numbers. Returns one line per problem; empty means clean.
 */
export function volatileValues(text: string): string[] {
  const out: string[] = [];
  for (const { what, re } of VOLATILE) {
    const m = re.exec(text);
    if (m) out.push(`${what}: "${m[0]}"`);
  }
  return out;
}
