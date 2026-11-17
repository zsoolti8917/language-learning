// Message lookup. `t('tabs.today')`, `t('placeholder.param', { name: 'id', value: 3 })`.
import { en, type Messages } from './en';

export { en, type Messages } from './en';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of a messages object, dotted: 'tabs.today'. */
export type MessageKey<T = Messages> = Leaves<T>;

export type MessageVars = Record<string, string | number>;

/** Fills `{name}` placeholders. A missing variable stays as written, so it shows in review. */
export function format(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    vars[k] === undefined ? m : String(vars[k]),
  );
}

function lookup(table: object, key: string): string | undefined {
  let node: unknown = table;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Builds a typed lookup over one messages object. */
export function createT<T extends object>(table: T) {
  return (key: MessageKey<T>, vars?: MessageVars): string => {
    const s = lookup(table, key);
    if (s === undefined) {
      if (import.meta.env?.DEV) console.warn(`missing message "${key}"`);
      return key;
    }
    return format(s, vars);
  };
}

/** The shell's messages. */
export const t = createT(en);

/**
 * A feature's own messages, in `features/<feature>/messages.ts`:
 * `export const m = defineMessages({ title: 'Review', due: '{count} due' });`
 * then `m.t('due', { count: 3 })` and `m.messages.title`.
 */
export function defineMessages<const T extends object>(messages: T) {
  return { messages, t: createT(messages) };
}
