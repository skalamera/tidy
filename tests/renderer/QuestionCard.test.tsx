// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard } from '../../src/renderer/src/components/QuestionCard';
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

  it('turns long choice lists into a search', async () => {
    const choices = ['Albany', 'Bronx', 'Brooklyn', 'Buffalo', 'Manhattan', 'Queens', 'Rochester', 'Staten Island'].map((name, i) => ({
      value: String(i),
      label: name,
    }));
    const onAnswer = vi.fn(async () => {});
    render(<QuestionCard question={question({ kind: 'choice', choices })} onAnswer={onAnswer} />);
    expect(screen.queryByRole('button', { name: 'Brooklyn' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Search'), 'bro');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Bronx', 'Brooklyn']);
    await userEvent.click(screen.getByRole('button', { name: 'Brooklyn' }));
    expect(onAnswer).toHaveBeenCalledWith('2');
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
});
