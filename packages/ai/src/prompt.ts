// The shape of a prompt folder (`packages/ai/prompts/<route>/`). Each folder's `index.ts`
// exports `prompt`, which names its versions and the one in use. The route owner replaces
// the placeholder version 1; B8's registry reads these folders.
import type { AiRoute } from '@app/contracts';
import type { Responder } from './mock';
import type { PromptBlock } from './types';

export interface PromptVersion {
  version: number;
  /** The stable system blocks; the last block with `cache: true` ends the cached part. */
  system: readonly PromptBlock[];
  /** True for the placeholder that F5 wrote; the route owner removes it. */
  placeholder?: boolean;
}

export interface PromptFolder {
  route: AiRoute;
  /** The version in use. */
  current: number;
  versions: Readonly<Record<number, PromptVersion>>;
  /** What the mock gateway answers for this route in local mode when nothing is scripted. */
  mock?: Responder;
}

/** The version a folder has in use. Throws when `current` names no version. */
export function currentVersion(folder: PromptFolder): PromptVersion {
  const v = folder.versions[folder.current];
  if (!v) throw new Error(`prompt ${folder.route}: no version ${folder.current}`);
  return v;
}
