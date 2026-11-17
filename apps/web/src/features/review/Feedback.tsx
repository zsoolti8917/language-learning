import { CaseBadge } from '../../ui';
import type { CaseForm, FeedbackModel, Letter } from './feedback';
import { m } from './messages';

function formName(f: CaseForm): string {
  return f.number
    ? m.t('feedback.form', { case: m.messages.cases[f.case], number: m.messages.numbers[f.number] })
    : m.messages.cases[f.case];
}

function Letters({ letters }: { letters: Letter[] }) {
  return (
    <span lang="sk" className="font-semibold">
      {letters.map((l, i) =>
        l.differs ? (
          <strong
            key={i}
            data-accent=""
            className="text-close underline decoration-2 underline-offset-4"
          >
            {l.ch}
          </strong>
        ) : (
          <span key={i}>{l.ch}</span>
        ),
      )}
    </span>
  );
}

function Badge({ form }: { form: CaseForm }) {
  return (
    <CaseBadge
      case={form.case}
      label={m.messages.caseTitles[form.case]}
      {...(form.number ? { suffix: m.messages.numbers[form.number] } : {})}
    />
  );
}

/** The sentence under the answer field after grading. */
export function Feedback({ model, typed }: { model: FeedbackModel; typed: string }) {
  if (model.kind === 'correct') return null;
  if (model.kind === 'close') {
    const [before, after] = m.messages.feedback.close.split('{answer}');
    return (
      <span data-feedback="close">
        {before}
        <Letters letters={model.letters} />
        {after}
      </span>
    );
  }
  const [answerBefore, answerAfter] = m.messages.feedback.answer.split('{answer}');
  return (
    <span data-feedback={model.kind} className="inline-flex flex-col gap-2">
      {model.typedForms.length > 0 && (
        <span data-typed-case="">
          {m.t('feedback.otherCase', {
            typed: typed.trim(),
            forms: model.typedForms.map(formName).join(m.messages.feedback.or),
          })}{' '}
          <span className="inline-flex flex-wrap gap-1 align-middle">
            {model.typedForms.map((f) => (
              <Badge key={`${f.case}-${f.number}`} form={f} />
            ))}
          </span>
        </span>
      )}
      <span>
        {answerBefore}
        {model.letters ? (
          <Letters letters={model.letters} />
        ) : (
          <span lang="sk" className="font-semibold">
            {model.answer}
          </span>
        )}
        {answerAfter}
      </span>
      {model.expected && model.typedForms.length > 0 && (
        <span>
          {m.t('feedback.needs', { form: formName(model.expected) })}{' '}
          <Badge form={model.expected} />
        </span>
      )}
      {model.trigger && model.typedForms.length > 0 && (
        <span className="text-fg-muted">{m.t('feedback.trigger', { trigger: model.trigger })}</span>
      )}
    </span>
  );
}
