// A pattern: its label, the traditional and the everyday model word, the table of endings and
// notes. Only endings are shown: full forms would need the stem rules, so none are built here.
import type { Case, Gender, GrammaticalNumber, PatternDetail } from '@app/contracts';
import { tryParseTag } from '@app/ling';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { apiQuery } from '../../lib/api';
import { t } from '../../messages';
import { Card, CaseBadge, cn } from '../../ui';
import { ALL_CASES, GENDERS, NUMBERS } from './grammar';
import { m } from './messages';
import { QueryState } from './QueryState';

type Cell = { case: Case; number: GrammaticalNumber; gender?: Gender; ending: string };

function readEndings(endings: Record<string, string>): Cell[] {
  const out: Cell[] = [];
  for (const [tag, ending] of Object.entries(endings)) {
    const p = tryParseTag(tag);
    if (p?.kind === 'noun') out.push({ case: p.case, number: p.number, ending });
    else if (p?.kind === 'agree')
      out.push({ case: p.case, number: p.number, gender: p.gender, ending });
  }
  return out;
}

function Ending({ ending }: { ending: string | undefined }) {
  if (ending === undefined) return <span className="text-fg-muted">·</span>;
  if (ending === '')
    return (
      <span className="text-fg-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{m.t('pattern.noEnding')}</span>
      </span>
    );
  return (
    <span lang="sk" className="font-semibold">
      -{ending}
    </span>
  );
}

function EndingsTable({
  cells,
  columns,
  caption,
  compact = false,
}: {
  compact?: boolean;
  cells: Cell[];
  columns: { key: string; label: string; match: (c: Cell) => boolean }[];
  caption: string;
}) {
  const cases = ALL_CASES.filter((c) => cells.some((x) => x.case === c));
  return (
    <table className="w-full table-fixed border-collapse text-base" data-testid="endings">
      <caption className="mb-2 text-left text-sm font-medium text-fg-muted">{caption}</caption>
      <thead>
        <tr>
          <th
            scope="col"
            className={cn(
              compact ? 'w-[24%]' : 'w-[40%]',
              'py-2 text-left text-sm font-medium text-fg-muted',
            )}
          >
            {m.t('pattern.caseCol')}
          </th>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              className="py-2 text-left text-sm font-medium text-fg-muted"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c} className="border-t border-border">
            <th scope="row" className="py-2 text-left">
              {compact ? (
                <CaseBadge case={c} variant="short" label={m.t(`caseShort.${c}`)} />
              ) : (
                <CaseBadge case={c} label={m.t(`caseTitle.${c}`)} />
              )}
            </th>
            {columns.map((col) => (
              <td key={col.key} className="py-2">
                <Ending ending={cells.find((x) => x.case === c && col.match(x))?.ending} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Pattern({ p }: { p: PatternDetail }) {
  const cells = readEndings(p.endings);
  const agrees = cells.some((c) => c.gender !== undefined);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-fg" lang="sk">
          {p.labelSk}
        </h2>
        <p className="text-sm text-fg-muted">
          {m.t(`pattern.pos.${p.pos}`)}
          {p.gender ? ` · ${m.t(`genderName.${p.gender}`)}` : ''}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {p.model && (
          <Card compact>
            <dt className="text-sm text-fg-muted">{m.t('pattern.model')}</dt>
            <dd className="text-lg font-semibold" lang="sk">
              {p.model.lemma}
            </dd>
          </Card>
        )}
        {p.everydayModel && (
          <Card compact>
            <dt className="text-sm text-fg-muted">{m.t('pattern.everyday')}</dt>
            <dd className="text-lg font-semibold" lang="sk" data-testid="everyday">
              {p.everydayModel.lemma}
            </dd>
          </Card>
        )}
      </dl>
      <section aria-labelledby="pattern-endings" className="space-y-4">
        <h3 id="pattern-endings" className="text-lg font-semibold text-fg">
          {m.t('pattern.endings')}
        </h3>
        {agrees ? (
          NUMBERS.map((n) => (
            <EndingsTable
              key={n}
              compact
              caption={m.t(`numberTitle.${n}`)}
              cells={cells.filter((c) => c.number === n)}
              columns={GENDERS.filter((g) => cells.some((c) => c.gender === g)).map((g) => ({
                key: g,
                label: m.t(`genderShort.${g}`),
                match: (c) => c.gender === g,
              }))}
            />
          ))
        ) : (
          <EndingsTable
            caption={m.t('pattern.endings')}
            cells={cells}
            columns={NUMBERS.map((n) => ({
              key: n,
              label: m.t(`numberTitle.${n}`),
              match: (c) => c.number === n,
            }))}
          />
        )}
      </section>
      {p.notesEn && (
        <Card title={m.t('pattern.notes')}>
          <p className="text-base text-fg">{p.notesEn}</p>
        </Card>
      )}
    </div>
  );
}

export function PatternScreen() {
  const { patternId } = useParams({ strict: false });
  const id = String(patternId);
  const query = useQuery(apiQuery('declension.pattern', { params: { id } }));
  return (
    <section className="space-y-4 px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{t('screens.pattern')}</h1>
      <QueryState query={query} notFound={m.t('pattern.notFound')}>
        {(p) => <Pattern p={p} />}
      </QueryState>
    </section>
  );
}
