import type { ReviewItem } from '@app/contracts';
import { gradeAnswer } from '@app/srs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Feedback } from './Feedback';
import { accentLetters, feedbackFor } from './feedback';

// Forms from the mini dataset (packages/testkit/mini/forms.jsonl), lemmas 20 mesto and 11 žena.
const FORMS_MESTO = {
  mesto: ['s1', 's4', 's5'],
  mesta: ['s2'],
  mestu: ['s3'],
  meste: ['s6'],
  mestom: ['s7'],
  mestá: ['p1', 'p4', 'p5'],
  miest: ['p2'],
  mestám: ['p3'],
  mestách: ['p6'],
  mestami: ['p7'],
};
const FORMS_ZENA = {
  žena: ['s1', 's5'],
  ženy: ['s2', 'p1', 'p4', 'p5'],
  žene: ['s3', 's6'],
  ženu: ['s4'],
  ženou: ['s7'],
  žien: ['p2'],
  ženám: ['p3'],
  ženách: ['p6'],
  ženami: ['p7'],
};

function item(
  over: Partial<ReviewItem> & Pick<ReviewItem, 'answers' | 'formMap' | 'prompt'>,
): ReviewItem {
  return {
    cardId: '0193a1b2-c3d4-7e5f-8a6b-000000000101',
    noteId: '0193a1b2-c3d4-7e5f-8a6b-000000000102',
    kind: 'case_sentence',
    state: 'review',
    dueAt: '2026-11-16T19:05:00.000Z',
    variant: 0,
    scheduler: null,
    ...over,
  };
}

// "Bratislava je pekné mesto." is sentence gen-51bd71b9 of the mini dataset.
const MESTO = item({
  prompt: {
    sentenceSk: 'Bratislava je pekné mesto.',
    blank: { start: 20, end: 25 },
    sentenceEn: 'Bratislava is a nice town.',
    cue: 'mesto',
  },
  answers: ['mesto'],
  formMap: FORMS_MESTO,
  explain: { case: 'nom', number: 'sg' },
});

const ZENAM = item({
  prompt: {
    sentenceSk: 'Pomáham ženám.',
    blank: { start: 8, end: 13 },
    sentenceEn: 'I help women.',
    cue: 'žena',
  },
  answers: ['ženám'],
  formMap: FORMS_ZENA,
  explain: { case: 'dat', number: 'pl', triggerLabel: 'pomáhať + dative' },
});

function show(card: ReviewItem, typed: string, strict = false) {
  const { grade } = gradeAnswer(typed, card.answers, card.formMap, { strictDiacritics: strict });
  const model = feedbackFor(card, typed, grade);
  const view = render(<Feedback model={model} typed={typed} />);
  return { grade, model, ...view };
}

describe('feedback', () => {
  it('correct: nothing more to say', () => {
    const { grade, model, container } = show(MESTO, 'Mesto');
    expect(grade).toBe('correct');
    expect(model).toEqual({ kind: 'correct', answer: 'mesto' });
    expect(container).toBeEmptyDOMElement();
  });

  it('close for zenam: the answer with the missing accents marked', () => {
    const { grade, model, container } = show(ZENAM, 'zenam');
    expect(grade).toBe('close');
    expect(model.kind).toBe('close');
    expect(container).toHaveTextContent('Mind the accents: ženám.');
    const marked = [...container.querySelectorAll('[data-accent]')].map((e) => e.textContent);
    expect(marked).toEqual(['ž', 'á']);
  });

  it('close becomes wrong with strict accents, still showing the accents', () => {
    const { grade, container } = show(ZENAM, 'zenam', true);
    expect(grade).toBe('wrong');
    expect(container).toHaveTextContent('The answer is ženám.');
    expect(container.querySelectorAll('[data-accent]')).toHaveLength(2);
  });

  it('wrong for mesta: names the genitive that was typed and the case the sentence needs', () => {
    const { grade, model, container } = show(MESTO, 'mesta');
    expect(grade).toBe('wrong');
    expect(model).toMatchObject({
      kind: 'wrong',
      answer: 'mesto',
      typedForms: [{ case: 'gen', number: 'sg' }],
      expected: { case: 'nom', number: 'sg' },
    });
    expect(container).toHaveTextContent('mesta is the genitive singular.');
    expect(container).toHaveTextContent('The answer is mesto.');
    expect(container).toHaveTextContent('This sentence needs the nominative singular.');
    expect(container.querySelector('[data-case="gen"]')).toHaveTextContent('Genitive');
    expect(container.querySelector('[data-case="nom"]')).toHaveTextContent('Nominative');
  });

  it('wrong for mestá where mesta is needed: lists every reading of the typed form', () => {
    const card = {
      ...MESTO,
      answers: ['mesta'],
      explain: { case: 'gen' as const, number: 'sg' as const },
    };
    const { container } = show(card, 'mestá');
    expect(container).toHaveTextContent(
      'mestá is the nominative plural or accusative plural or vocative plural.',
    );
  });

  it('wrong for a string that is no form of the word: only the answer', () => {
    render(<Feedback model={feedbackFor(MESTO, 'dom', 'wrong')} typed="dom" />);
    expect(screen.getByText(/The answer is/)).toHaveTextContent('The answer is mesto.');
    expect(screen.queryByText(/is the/)).toBeNull();
  });

  it('revealed: the answer', () => {
    const { container } = render(<Feedback model={feedbackFor(MESTO, '', 'revealed')} typed="" />);
    expect(container).toHaveTextContent('The answer is mesto.');
  });

  it('marks accent differences letter by letter', () => {
    expect(
      accentLetters('mesta', 'mestá')
        .filter((l) => l.differs)
        .map((l) => l.ch),
    ).toEqual(['á']);
  });
});
