// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard } from '../../src/renderer/src/components/QuestionCard';
import { answerText } from '../../src/renderer/src/labels';
import type { Question } from '../../src/shared/state';

const question = (p: Partial<Question>): Question => ({
  id: 'q1',
  sectionId: 'payments',
  kind: 'money',
  prompt: 'How much did you pay?',
  help: null,
  choices: null,
  suggested: null,
  blocking: true,
  origin: 'rule',
  answer: null,
  answeredAt: null,
  ...p,
});

afterEach(cleanup);

describe('QuestionCard', () => {
  it('sends money answers as whole cents', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({})} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText('Amount in dollars'), '$12,500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith('1250050');
  });

  it('explains a bad amount instead of sending it', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({})} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText('Amount in dollars'), '12.345');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a dollar amount');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('answers yes/no in one click', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'yes_no', prompt: 'Did you move?' })} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onAnswer).toHaveBeenCalledWith('no');
  });

  it('turns long choice lists into a search, including unincorporated place keywords', async () => {
    const choices = [
      { value: '0', label: 'Albany' },
      { value: '1', label: 'Bronx' },
      { value: '2', label: 'Brooklyn' },
      { value: '3', label: 'Buffalo' },
      { value: '0500', label: 'Calvert County (not in a town)', keywords: 'Huntingtown Prince Frederick Solomons Lusby' },
      { value: '4', label: 'Manhattan' },
      { value: '5', label: 'Queens' },
      { value: '6', label: 'Rochester' },
    ];
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'choice', choices })} onAnswer={onAnswer} />);
    expect(screen.queryByRole('button', { name: 'Brooklyn' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Search'), 'Huntingtown');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Calvert County (not in a town)']);
    await userEvent.click(screen.getByRole('button', { name: 'Calvert County (not in a town)' }));
    expect(onAnswer).toHaveBeenCalledWith('0500');
  });

  it('confirms an amount we read, or lets the user fix it', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'confirm_amount', suggested: 8_500_000 })} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'No, fix it' }));
    const input = screen.getByLabelText('Amount in dollars') as HTMLInputElement;
    expect(input.value).toBe('85000.00');
    await userEvent.clear(input);
    await userEvent.type(input, '86000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith('8600000');
  });

  it('takes a name in two boxes and sends both', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'name', prompt: 'What’s your name?' })} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText('First name'), ' Pat ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a first and a last name.');
    await userEvent.type(screen.getByLabelText('Last name'), 'Example');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith(JSON.stringify({ first: 'Pat', last: 'Example' }));
  });

  it('takes a Social Security number only with all 9 digits', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'ssn', prompt: 'What’s your Social Security number?' })} onAnswer={onAnswer} />);
    const box = screen.getByLabelText('Social Security number');
    await userEvent.type(box, '078-05-112');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter all 9 digits, like 123-45-6789.');
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.type(box, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith('078051120');
  });

  it('takes the home address in one form', async () => {
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'address', prompt: 'What’s your home address?' })} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText('Street'), '1 Example Lane');
    await userEvent.type(screen.getByLabelText('City'), 'Rockville');
    await userEvent.type(screen.getByLabelText('State'), 'md');
    await userEvent.type(screen.getByLabelText('ZIP code'), '2085');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter the street, city, a 2-letter state and a 5-digit ZIP code.');
    await userEvent.type(screen.getByLabelText('ZIP code'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith(
      JSON.stringify({ street: '1 Example Lane', apt: null, city: 'Rockville', state: 'MD', zip: '20850' }),
    );
  });
});

describe('answerText', () => {
  it('shows identity answers readably and never the whole SSN', () => {
    expect(answerText(question({ kind: 'ssn', answer: '078051120' }))).toBe('•••-••-1120');
    expect(answerText(question({ kind: 'name', answer: JSON.stringify({ first: 'Pat', last: 'Example' }) }))).toBe('Pat Example');
    const home = { street: '1 Example Lane', apt: 'Apt 2', city: 'Rockville', state: 'MD', zip: '20850' };
    expect(answerText(question({ kind: 'address', answer: JSON.stringify(home) }))).toBe('1 Example Lane, Apt 2, Rockville, MD 20850');
    expect(answerText(question({ kind: 'money', answer: '1250050' }))).toBe('$12,500.50');
  });
});
