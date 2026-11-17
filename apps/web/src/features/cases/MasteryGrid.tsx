// The grid of mastery by case and number. Each cell shows its level as a word and a tint;
// tapping it opens the four genders in a sheet.
import type { BucketMastery, Case, GrammaticalNumber, MasteryLevel } from '@app/contracts';
import { useState } from 'react';
import { CaseBadge, cn, Sheet } from '../../ui';
import { GRID_CASES, NUMBERS } from './grammar';
import { type CellMastery, cellMastery } from './mastery';
import { m } from './messages';

/** Tint and marker per level. The level word is always shown too. */
const LEVEL_STYLE: Record<MasteryLevel, { cell: string; mark: string }> = {
  unseen: { cell: 'bg-surface-2 border-border', mark: '○' },
  weak: { cell: 'bg-wrong-soft border-wrong', mark: '▽' },
  ok: { cell: 'bg-close-soft border-close', mark: '◇' },
  strong: { cell: 'bg-correct-soft border-correct', mark: '★' },
};

export function LevelLabel({ level }: { level: MasteryLevel }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-semibold text-fg"
      data-level={level}
    >
      <span aria-hidden="true">{LEVEL_STYLE[level].mark}</span>
      {m.t(`level.${level}`)}
    </span>
  );
}

function Cell({ cell, onOpen }: { cell: CellMastery; onOpen: () => void }) {
  const caseName = m.t(`caseTitle.${cell.case}`);
  const numberName = m.t(`numberName.${cell.number}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={m.t('course.masteryCell', {
        case: caseName,
        number: numberName,
        level: m.t(`level.${cell.level}`),
      })}
      className={cn(
        'flex min-h-tap w-full items-center justify-center rounded-control border px-2 py-2',
        LEVEL_STYLE[cell.level].cell,
      )}
      data-cell={`${cell.case}.${cell.number}`}
    >
      <LevelLabel level={cell.level} />
    </button>
  );
}

export function MasteryGrid({ mastery }: { mastery: readonly BucketMastery[] }) {
  const [open, setOpen] = useState<{ c: Case; n: GrammaticalNumber } | null>(null);
  const selected = open ? cellMastery(mastery, open.c, open.n) : null;
  return (
    <div>
      <p className="mb-2 text-sm text-fg-muted">{m.t('course.masteryHint')}</p>
      <table className="w-full table-fixed border-separate border-spacing-1">
        <thead>
          <tr>
            <th scope="col" className="w-[38%] text-left text-sm font-medium text-fg-muted">
              <span className="sr-only">{m.t('pattern.caseCol')}</span>
            </th>
            {NUMBERS.map((n) => (
              <th key={n} scope="col" className="text-sm font-medium text-fg-muted">
                {m.t(`numberTitle.${n}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRID_CASES.map((c) => (
            <tr key={c}>
              <th scope="row" className="text-left">
                <CaseBadge case={c} label={m.t(`caseTitle.${c}`)} />
              </th>
              {NUMBERS.map((n) => (
                <td key={n}>
                  <Cell cell={cellMastery(mastery, c, n)} onOpen={() => setOpen({ c, n })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Sheet
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        title={
          selected
            ? m.t('course.masterySheet', {
                case: m.t(`caseTitle.${selected.case}`),
                number: m.t(`numberName.${selected.number}`),
              })
            : ''
        }
      >
        {selected && (
          <ul className="space-y-2">
            {selected.genders.map((g) => (
              <li
                key={g.gender}
                className={cn(
                  'flex min-h-tap items-center justify-between rounded-control border px-3 py-2',
                  LEVEL_STYLE[g.level].cell,
                )}
                data-gender={g.gender}
              >
                <span className="text-base text-fg">
                  {m.t(`genderTitle.${g.gender}`)}
                  <span className="block text-sm text-fg-muted">
                    {m.t('course.attempts', { count: g.attempts })}
                  </span>
                </span>
                <LevelLabel level={g.level} />
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
