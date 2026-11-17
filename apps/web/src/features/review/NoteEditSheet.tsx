import type { NoteContent } from '@app/contracts';
import { useState } from 'react';
import { Button, Input, Sheet } from '../../ui';
import { splitAnswers } from './format';
import { m } from './messages';

interface Fields {
  glossEn: string;
  sentenceEn: string;
  cue: string;
  answers: string;
}

function fieldsOf(content: NoteContent): Fields {
  return {
    glossEn: content.kind === 'case_sentence' ? '' : content.glossEn,
    sentenceEn: content.kind === 'case_sentence' ? content.sentenceEn : '',
    cue: content.kind === 'case_sentence' ? content.cue : '',
    answers: content.kind === 'case_sentence' ? content.answers.join(', ') : '',
  };
}

/** The edited content, or the names of the fields that are missing. */
export function editedContent(
  content: NoteContent,
  f: Fields,
): { content: NoteContent } | { missing: (keyof Fields)[] } {
  if (content.kind === 'case_sentence') {
    const answers = splitAnswers(f.answers);
    const missing: (keyof Fields)[] = [];
    if (!f.cue.trim()) missing.push('cue');
    if (answers.length === 0) missing.push('answers');
    if (missing.length > 0) return { missing };
    return {
      content: { ...content, sentenceEn: f.sentenceEn.trim(), cue: f.cue.trim(), answers },
    };
  }
  if (!f.glossEn.trim()) return { missing: ['glossEn'] };
  return { content: { ...content, glossEn: f.glossEn.trim() } };
}

/** Edits what a learner may change: the meaning, or a case sentence's translation, cue and answers. */
export function NoteEditSheet({
  content,
  onSave,
}: {
  content: NoteContent;
  onSave: (content: NoteContent) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(content));
  const [missing, setMissing] = useState<(keyof Fields)[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Fields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));
  const err = (k: keyof Fields) => (missing.includes(k) ? m.messages.note.required : undefined);

  async function save() {
    const r = editedContent(content, fields);
    if ('missing' in r) {
      setMissing(r.missing);
      return;
    }
    setSaving(true);
    try {
      await onSave(r.content);
      setOpen(false);
    } catch {
      // The screen shows the failure; the sheet stays open with the learner's text.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setFields(fieldsOf(content));
          setMissing([]);
        }
        setOpen(o);
      }}
      title={m.messages.note.editTitle}
      trigger={<Button variant="secondary">{m.messages.note.edit}</Button>}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={() => setOpen(false)}>
            {m.messages.note.cancel}
          </Button>
          <Button block loading={saving} onClick={() => void save()}>
            {m.messages.note.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {content.kind === 'case_sentence' ? (
          <>
            <Input
              label={m.messages.note.englishField}
              value={fields.sentenceEn}
              onChange={set('sentenceEn')}
            />
            <Input
              label={m.messages.note.cueField}
              lang="sk"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={fields.cue}
              onChange={set('cue')}
              error={err('cue')}
            />
            <Input
              label={m.messages.note.answersField}
              hint={m.messages.note.answersHint}
              lang="sk"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={fields.answers}
              onChange={set('answers')}
              error={err('answers')}
            />
          </>
        ) : (
          <Input
            label={m.messages.note.glossField}
            value={fields.glossEn}
            onChange={set('glossEn')}
            error={err('glossEn')}
          />
        )}
      </div>
    </Sheet>
  );
}
