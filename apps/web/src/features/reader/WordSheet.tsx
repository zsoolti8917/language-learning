// The word sheet: built from the stored analysis alone, with no network call. It shows the
// meaning, the dictionary form, case and number, why this case, and the actions.
import type { LemmaStatus } from '@app/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, CaseBadge, Input, Sheet } from '../../ui';
import type { WordInfo } from './analysis';
import { m } from './messages';

/** The trigger in words, for example "After “do” comes the genitive." */
export function triggerText(info: WordInfo): string | null {
  if (!info.trigger || !info.case) return null;
  const c = m.t(`caseLower.${info.case}`);
  if (info.trigger.kind === 'function') return m.t('trigger.function', { case: c });
  if (!info.trigger.word) return m.t('trigger.noWord', { case: c });
  return m.t(`trigger.${info.trigger.kind}`, { word: info.trigger.word, case: c });
}

function dictionaryLine(info: WordInfo): string {
  const parts = [info.pos ? m.t(`pos.${info.pos}`) : null];
  if (info.gender && (info.pos === 'noun' || info.pos === null)) {
    parts.push(m.t(`gender.${info.gender}`));
  }
  return parts.filter(Boolean).join(', ');
}

export interface WordSheetProps {
  info: WordInfo | null;
  status: LemmaStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onStatus: (status: 'known' | 'ignored') => void;
  onSelectPhrase: () => void;
  onTranslate: () => void;
  translation: string | null;
  translating: boolean;
  translateFailed: boolean;
  onReport: (comment: string) => void;
}

export function WordSheet({
  info,
  status,
  open,
  onOpenChange,
  onSave,
  onStatus,
  onSelectPhrase,
  onTranslate,
  translation,
  translating,
  translateFailed,
  onReport,
}: WordSheetProps) {
  const [reporting, setReporting] = useState(false);
  const [comment, setComment] = useState('');
  const trigger = info ? triggerText(info) : null;
  const saved = status === 'learning';

  const change = (next: boolean) => {
    if (!next) {
      setReporting(false);
      setComment('');
    }
    onOpenChange(next);
  };

  return (
    <Sheet
      open={open && info !== null}
      onOpenChange={change}
      title={<span lang="sk">{info?.surface ?? ''}</span>}
      footer={
        info && (
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={onSave} disabled={saved} aria-pressed={saved}>
              {saved ? m.t('sheet.saved') : m.t('sheet.save')}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={status === 'known'}
              onClick={() => onStatus('known')}
            >
              {m.t('sheet.known')}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={status === 'ignored'}
              onClick={() => onStatus('ignored')}
            >
              {m.t('sheet.ignore')}
            </Button>
          </div>
        )
      }
    >
      {info && (
        <div className="space-y-4" data-testid="word-sheet">
          <p className="text-lg text-fg" data-testid="gloss">
            {info.gloss.length > 0 ? info.gloss.join('; ') : m.t('sheet.noGloss')}
          </p>
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-base">
            <dt className="text-sm text-fg-muted">{m.t('sheet.dictionaryForm')}</dt>
            <dd>
              <span lang="sk" className="font-semibold" data-testid="lemma">
                {info.lemma}
              </span>
              {dictionaryLine(info) && (
                <span className="text-fg-muted" data-testid="pos">
                  {' '}
                  {m.t('sheet.posLine', { text: dictionaryLine(info) })}
                </span>
              )}
            </dd>
            {info.case && (
              <>
                <dt className="text-sm text-fg-muted">{m.t('sheet.form')}</dt>
                <dd className="flex flex-wrap items-center gap-2" data-testid="form">
                  <CaseBadge case={info.case} label={m.t(`caseName.${info.case}`)} />
                  {info.number && <span>{m.t(`number.${info.number}`)}</span>}
                </dd>
              </>
            )}
            {trigger && (
              <>
                <dt className="text-sm text-fg-muted">{m.t('sheet.why')}</dt>
                <dd data-testid="trigger">{trigger}</dd>
              </>
            )}
          </dl>
          {info.method === 'guess' && (
            <p className="rounded-control bg-close-soft px-3 py-2 text-sm text-fg" role="note">
              {m.t('sheet.guess')}
            </p>
          )}

          {translation ? (
            <div>
              <p className="text-sm text-fg-muted">{m.t('sheet.translation')}</p>
              <p className="text-base text-fg" data-testid="translation">
                {translation}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Button variant="ghost" onClick={onTranslate} loading={translating}>
                {translating ? m.t('sheet.translating') : m.t('sheet.translate')}
              </Button>
              {translateFailed && (
                <p role="alert" className="text-sm text-wrong">
                  {m.t('sheet.translateFailed')}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/lemma/$lemmaId" params={{ lemmaId: String(info.lemmaId) }}>
                {m.t('sheet.wordPage')}
              </Link>
            </Button>
            <Button variant="secondary" onClick={onSelectPhrase}>
              {m.t('sheet.selectPhrase')}
            </Button>
            {!reporting && (
              <Button variant="ghost" onClick={() => setReporting(true)}>
                {m.t('sheet.report')}
              </Button>
            )}
          </div>

          {reporting && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                onReport(comment);
                setReporting(false);
                setComment('');
              }}
            >
              <Input
                label={m.t('sheet.reportLabel')}
                value={comment}
                maxLength={1000}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button type="submit" variant="secondary">
                {m.t('sheet.reportSend')}
              </Button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}
