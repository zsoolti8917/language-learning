// /read/$textId: the reader. Words show their status by colour and underline; a tap opens the
// word sheet built from the stored analysis. Opened texts are kept for offline reading.
import type { LemmaStatus, TextDetail } from '@app/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { Button, Card, EmptyState, Input, Sheet, Skeleton, useToast } from '../../ui';
import {
  isTappable,
  type PhraseSelection,
  phraseOf,
  selectedTokens,
  statusOf,
  wordInfo,
} from './analysis';
import {
  type LoadedText,
  OfflineMissingError,
  reportToken,
  SAVED_STATUS,
  savePhrase,
  saveProgress,
  saveWord,
  setWordStatus,
  textKey,
  translateSentence,
} from './data';
import { useReimport, useText } from './hooks';
import { m } from './messages';
import { CoverageRing, TextFailed, TextProcessing } from './TextStatusViews';
import { VirtualText } from './VirtualText';
import { WordSheet } from './WordSheet';

/** Delay before the reading position is saved, after scrolling stops. */
export const PROGRESS_DELAY_MS = 2_000;

export function ReaderScreen() {
  const textId = useParams({ strict: false }).textId ?? '';
  const query = useText(textId);
  const reimport = useReimport();
  const [retrying, setRetrying] = useState(false);

  let content: ReactNode;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="space-y-3">
        <Skeleton height={28} width="60%" />
        <Skeleton lines={8} />
      </div>
    );
  } else if (query.isError) {
    const e = query.error;
    const title =
      e instanceof OfflineMissingError
        ? m.t('reader.offlineMissing')
        : isApiError(e) && e.code === 'not_found'
          ? m.t('reader.notFound')
          : m.t('reader.loadError');
    content = (
      <EmptyState
        title={title}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {m.t('reader.retry')}
          </Button>
        }
      />
    );
  } else if (query.data.text.status === 'processing') {
    content = <TextProcessing />;
  } else if (query.data.text.status === 'failed' || !query.data.text.analysis) {
    const text = query.data.text;
    content = (
      <TextFailed
        error={text.error}
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          reimport({ id: text.id, body: text.body, title: text.title })
            .catch(() => {})
            .finally(() => setRetrying(false));
        }}
      />
    );
  } else {
    content = <ReaderView key={textId} loaded={query.data} />;
  }

  return (
    <section className="px-gutter py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link to="/read" className="min-h-tap content-center text-base text-primary underline">
          {m.t('reader.back')}
        </Link>
        <h1 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {m.t('reader.eyebrow')}
        </h1>
      </div>
      {content}
    </section>
  );
}

function ReaderView({ loaded }: { loaded: LoadedText }) {
  const { text, offline } = loaded;
  const analysis = text.analysis as NonNullable<TextDetail['analysis']>;
  const toast = useToast();
  const online = useOnline();
  const queryClient = useQueryClient();

  const [overrides, setOverrides] = useState<Record<string, LemmaStatus>>({});
  const statuses = useMemo(
    () => ({ ...loaded.statuses, ...overrides }),
    [loaded.statuses, overrides],
  );
  const [open, setOpen] = useState<{ sentence: number; token: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phrase, setPhrase] = useState<PhraseSelection | null>(null);
  const [phraseSheet, setPhraseSheet] = useState(false);
  const [meaning, setMeaning] = useState('');
  const [meaningTouched, setMeaningTouched] = useState(false);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translating, setTranslating] = useState(false);
  const [translateFailed, setTranslateFailed] = useState(false);

  const info = open ? wordInfo(analysis, text.body, open.sentence, open.token) : null;
  const status = info ? statusOf(statuses, info.lemmaId) : 'unknown';
  const sentence = open ? analysis.sentences[open.sentence] : undefined;
  const translation = open ? (translations[open.sentence] ?? sentence?.en ?? null) : null;

  const queued = !online ? m.t('sheet.queuedNote') : undefined;

  const phraseRef = useRef(phrase);
  phraseRef.current = phrase;
  const onTokenTap = useCallback((n: number, i: number) => {
    const current = phraseRef.current;
    if (current) {
      setPhrase(
        current.sentence === n ? { ...current, focus: i } : { sentence: n, anchor: i, focus: i },
      );
      return;
    }
    setOpen({ sentence: n, token: i });
    setSheetOpen(true);
    setTranslateFailed(false);
  }, []);

  const setLocal = (lemmaId: number, s: LemmaStatus) =>
    setOverrides((o) => ({ ...o, [String(lemmaId)]: s }));

  const onSave = async () => {
    if (!info || !sentence) return;
    setLocal(info.lemmaId, SAVED_STATUS);
    setSheetOpen(false);
    await saveWord(text.id, info, {
      sk: text.body.slice(sentence.s, sentence.e),
      en: translations[info.sentence] ?? sentence.en,
    });
    toast({
      title: m.t('sheet.savedToast', { lemma: info.lemma }),
      tone: 'success',
      ...(queued ? { description: queued } : {}),
    });
  };

  const onStatus = async (next: 'known' | 'ignored') => {
    if (!info) return;
    setLocal(info.lemmaId, next);
    setSheetOpen(false);
    await setWordStatus(info.lemmaId, next);
    toast({
      title: m.t(next === 'known' ? 'sheet.knownToast' : 'sheet.ignoredToast', {
        lemma: info.lemma,
      }),
      ...(queued ? { description: queued } : {}),
    });
  };

  const onTranslate = async () => {
    if (!open) return;
    const n = open.sentence;
    setTranslating(true);
    setTranslateFailed(false);
    try {
      const en = await translateSentence(text.id, n);
      setTranslations((t) => ({ ...t, [n]: en }));
    } catch {
      setTranslateFailed(true);
    } finally {
      setTranslating(false);
    }
  };

  const onReport = async (comment: string) => {
    if (!info) return;
    await reportToken(text.id, info, comment);
    toast({ title: m.t('sheet.reportSent', { word: info.surface }), tone: 'success' });
  };

  const startPhrase = () => {
    if (!open) return;
    setPhrase({ sentence: open.sentence, anchor: open.token, focus: open.token });
    setSheetOpen(false);
  };

  const currentPhrase = phrase ? phraseOf(analysis, text.body, phrase) : null;
  const selection = useMemo(
    () =>
      phrase
        ? {
            sentence: phrase.sentence,
            tokens: selectedTokens(phrase).filter((i) => {
              const t = analysis.sentences[phrase.sentence]?.tokens[i];
              return t ? isTappable(t) : false;
            }),
          }
        : null,
    [phrase, analysis],
  );

  const openPhraseSheet = () => {
    setMeaning(currentPhrase?.glossDraft ?? '');
    setMeaningTouched(false);
    setPhraseSheet(true);
  };

  const onSavePhrase = async () => {
    setMeaningTouched(true);
    if (!currentPhrase || meaning.trim() === '') return;
    setPhraseSheet(false);
    setPhrase(null);
    await savePhrase(text.id, currentPhrase, meaning.trim());
    toast({
      title: m.t('phrase.savedToast', { text: currentPhrase.textSk }),
      tone: 'success',
      ...(queued ? { description: queued } : {}),
    });
  };

  // Reading position: saved after scrolling stops for a moment, only when it changed.
  const lastSaved = useRef(text.progress.sentence ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPosition = useCallback(
    (n: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (n === lastSaved.current) return;
        lastSaved.current = n;
        void saveProgress(text.id, n);
        queryClient.setQueryData<LoadedText>(textKey(text.id), (d) =>
          d ? { ...d, text: { ...d.text, progress: { ...d.text.progress, sentence: n } } } : d,
        );
      }, PROGRESS_DELAY_MS);
    },
    [text.id, queryClient],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <article className={phrase ? 'pb-40' : undefined}>
      <header className="mb-4 flex items-center gap-3">
        <CoverageRing share={text.coverage} size={48} />
        <div className="min-w-0 flex-1">
          <h2 lang="sk" className="text-2xl font-semibold text-fg">
            {text.title}
          </h2>
          <p className="text-sm text-fg-muted">
            {m.t('reader.stats', {
              tokens: text.tokenCount ?? 0,
              lemmas: text.uniqueLemmaCount ?? 0,
            })}
            {offline && (
              <span data-testid="offline-note" className="ml-2 font-semibold text-fg">
                {m.t('reader.offlineNote')}
              </span>
            )}
          </p>
        </div>
      </header>

      <VirtualText
        body={text.body}
        analysis={analysis}
        statuses={statuses}
        selection={selection}
        onTokenTap={onTokenTap}
        initialSentence={text.progress.sentence ?? 0}
        onPosition={onPosition}
        statusLabels={m.messages.reader.statusLabels}
        label={m.t('reader.textLabel')}
      />

      <WordSheet
        info={info}
        status={status}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSave={() => void onSave()}
        onStatus={(s) => void onStatus(s)}
        onSelectPhrase={startPhrase}
        onTranslate={() => void onTranslate()}
        translation={translation}
        translating={translating}
        translateFailed={translateFailed}
        onReport={(c) => void onReport(c)}
      />

      {phrase && currentPhrase && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl px-gutter pb-2">
          <Card compact className="space-y-2 shadow-lg" data-testid="phrase-bar">
            <p className="text-base text-fg" aria-live="polite">
              {currentPhrase.words < 2 ? (
                m.t('phrase.hint')
              ) : (
                <span lang="sk">
                  {m.t('phrase.selected', {
                    count: currentPhrase.words,
                    text: currentPhrase.textSk,
                  })}
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button disabled={currentPhrase.words < 2} onClick={openPhraseSheet}>
                {m.t('phrase.save')}
              </Button>
              <Button variant="ghost" onClick={() => setPhrase(null)}>
                {m.t('phrase.cancel')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <Sheet
        open={phraseSheet && currentPhrase !== null}
        onOpenChange={setPhraseSheet}
        title={m.t('phrase.sheetTitle')}
        description={<span lang="sk">{currentPhrase?.textSk}</span>}
        repositionInputs={false}
        footer={
          <Button block onClick={() => void onSavePhrase()}>
            {m.t('phrase.save')}
          </Button>
        }
      >
        <Input
          label={m.t('phrase.meaning')}
          hint={m.t('phrase.meaningHint')}
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          error={meaningTouched && meaning.trim() === '' ? m.t('phrase.meaningEmpty') : undefined}
        />
      </Sheet>
    </article>
  );
}
