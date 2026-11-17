// Renders feedback fragments and short markdown: Slovak words in italics with lang="sk".
import { Fragment as ReactFragment, type ReactNode } from 'react';
import type { Fragment, RichVar } from './feedback';
import { m } from './messages';

function fill(template: string, vars: Record<string, RichVar> | undefined): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const i = match.index ?? 0;
    if (i > last) out.push(template.slice(last, i));
    const v = vars?.[match[1] as string];
    if (v === undefined) out.push(match[0]);
    else if (typeof v === 'string') out.push(v);
    else
      out.push(
        <em key={i} lang="sk" className="font-semibold">
          {v.sk}
        </em>,
      );
    last = i + match[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** Feedback sentences from `feedback.ts`, joined by spaces. */
export function RichText({ fragments }: { fragments: readonly Fragment[] }) {
  return (
    <>
      {fragments.map((f, i) => (
        <ReactFragment key={i}>
          {i > 0 && ' '}
          {fill(m.messages.fb[f.key], f.vars)}
        </ReactFragment>
      ))}
    </>
  );
}

/** Inline markdown of lesson texts: *Slovak* in italics. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
      <em key={`${keyBase}-${i}`} lang="sk">
        {part.slice(1, -1)}
      </em>
    ) : (
      part
    ),
  );
}

/** The small markdown of lesson steps: paragraphs, "- " lists and *italics*. */
export function Markdown({ md }: { md: string }) {
  const blocks = md.split(/\n\s*\n/);
  return (
    <div className="space-y-3 text-base leading-relaxed text-fg">
      {blocks.map((block, b) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (lines.length > 0 && lines.every((l) => /^\s*-\s+/.test(l))) {
          return (
            <ul key={b} className="list-disc space-y-2 pl-5">
              {lines.map((l, i) => (
                <li key={i}>{inline(l.replace(/^\s*-\s+/, ''), `${b}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={b}>{inline(lines.join(' '), String(b))}</p>;
      })}
    </div>
  );
}
