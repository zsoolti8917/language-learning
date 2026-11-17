import { GRADES } from '@app/contracts';
import { buildFormMap } from '@app/ling';
import { describe, expect, it } from 'vitest';
import { gradeAnswer, ratingForGrade } from './grade';

// From the SNK morphology file, in the app's form tags.
const mesto = buildFormMap([
  { form: 'mesto', tags: 's1 s4 s5' },
  { form: 'mesta', tags: 's2' },
  { form: 'mestu', tags: 's3' },
  { form: 'meste', tags: 's6' },
  { form: 'mestom', tags: 's7' },
  { form: 'mestá', tags: 'p1 p4 p5' },
  { form: 'miest', tags: 'p2' },
  { form: 'mestám', tags: 'p3' },
  { form: 'mestách', tags: 'p6' },
  { form: 'mestami', tags: 'p7' },
]);
const zena = buildFormMap([
  { form: 'žena', tags: 's1 s5' },
  { form: 'ženy', tags: 's2 p1 p4 p5' },
  { form: 'žene', tags: 's3 s6' },
  { form: 'ženu', tags: 's4' },
  { form: 'ženou', tags: 's7' },
  { form: 'žien', tags: 'p2' },
  { form: 'ženám', tags: 'p3' },
  { form: 'ženách', tags: 'p6' },
  { form: 'ženami', tags: 'p7' },
]);

const lenient = { strictDiacritics: false };
const strict = { strictDiacritics: true };

describe('gradeAnswer', () => {
  it('correct gives good', () => {
    expect(gradeAnswer('mestá', ['mestá'], mesto, lenient)).toEqual({
      grade: 'correct',
      rating: 3,
      diagnosis: 'correct',
    });
    expect(gradeAnswer(' Mestá! ', ['mestá'], mesto, strict).grade).toBe('correct');
  });

  it('mesta for mestá is wrong: another form of the word, not an accent slip', () => {
    for (const o of [lenient, strict]) {
      expect(gradeAnswer('mesta', ['mestá'], mesto, o)).toEqual({
        grade: 'wrong',
        rating: 1,
        diagnosis: 'other_case',
      });
    }
  });

  it('zenam for ženám is close, and wrong with strict accents', () => {
    expect(gradeAnswer('zenam', ['ženám'], zena, lenient)).toEqual({
      grade: 'close',
      rating: 2,
      diagnosis: 'diacritics',
    });
    expect(gradeAnswer('zenam', ['ženám'], zena, strict)).toEqual({
      grade: 'wrong',
      rating: 1,
      diagnosis: 'diacritics',
    });
  });

  it('anything else is wrong and gives again', () => {
    expect(gradeAnswer('dom', ['ženám'], zena, lenient)).toEqual({
      grade: 'wrong',
      rating: 1,
      diagnosis: 'not_a_form',
    });
    expect(gradeAnswer('', ['ženám'], zena, lenient).grade).toBe('wrong');
  });

  it('works for a phrase with an empty form map', () => {
    expect(gradeAnswer('dobrú chuť', ['dobrú chuť'], {}, lenient).grade).toBe('correct');
    expect(gradeAnswer('dobru chut', ['dobrú chuť'], {}, lenient).grade).toBe('close');
  });
});

describe('ratingForGrade', () => {
  it('maps every grade to its default rating', () => {
    expect(GRADES.map(ratingForGrade)).toEqual([3, 2, 1, 1]);
  });
});
