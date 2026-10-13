// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileQuestions } from '../../src/core/reconcile';
import { buildView, type AppView } from '../../src/core/view';
import type { TidyApi } from '../../src/shared/ipc';
import { emptyState } from '../../src/shared/state';
import App from '../../src/renderer/src/App';
import { doc, NOW, priorYear, stateWith, w2Extraction } from '../fixtures/state';

vi.mock('../../src/renderer/src/pdf', () => ({ openPdf: vi.fn(), drawPage: vi.fn() }));

/** window.tidy that serves one view; every other method is a spy resolving to { ok: true }. */
function install(view: AppView, overrides: Partial<TidyApi> = {}) {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Partial<TidyApi> = {
    getView: async () => view,
    onView: () => () => undefined,
    onChatDelta: () => () => undefined,
    onNavigate: () => () => undefined,
    ...overrides,
  };
  window.tidy = new Proxy(base, {
    get: (target, key: string) => target[key as keyof TidyApi] ?? (spies[key] ??= vi.fn(async () => ({ ok: true }))),
  }) as TidyApi;
  return spies;
}

function workingView(): AppView {
  const s = stateWith({ documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction()])] });
  s.onboarding.welcomed = true;
  s.questions = reconcileQuestions(s);
  return buildView(s, { aiProvider: 'anthropic' });
}

function keyScreenView(): AppView {
  const s = emptyState(NOW);
  s.onboarding.welcomed = true;
  return buildView(s, { aiProvider: null });
}

afterEach(cleanup);

describe('App', () => {
  it('starts with the welcome screen', async () => {
    const spies = install(buildView(emptyState(NOW), { aiProvider: null }));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Let’s start/ }));
    expect(spies.completeWelcome).toHaveBeenCalled();
  });

  it('asks for a Claude key and shows why a key was refused', async () => {
    install(keyScreenView(), { setApiKey: async () => ({ ok: false, error: 'Anthropic didn’t accept that key.' }) });
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Anthropic API key'), 'sk-ant-nope');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Anthropic didn’t accept that key.');
  });

  it('lets the user pick Gemini, warns about the free tier, and sends the key with that choice', async () => {
    const setApiKey = vi.fn(async () => ({ ok: true as const }));
    install(keyScreenView(), { setApiKey });
    render(<App />);
    await userEvent.click(await screen.findByRole('radio', { name: /Gemini/ }));
    expect(screen.getByText(/free tier/).textContent).toContain('billing');
    await userEvent.type(screen.getByLabelText('Gemini API key'), 'AIza-test-key');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(setApiKey).toHaveBeenCalledWith('gemini', 'AIza-test-key');
  });

  it('can switch AI later, or go back without changing anything', async () => {
    install(workingView());
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change AI' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Connect Tidy to an AI' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Claude/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Keep using Claude/ }));
    expect(await screen.findByRole('button', { name: 'Change AI' })).toBeTruthy();
  });

  it('names the next step and its button opens that step', async () => {
    const view = workingView();
    const setScreen = vi.fn();
    install(view, { setScreen });
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: view.now.title })).toBeTruthy();
    const intent = view.now.cta!.intent;
    expect(intent.type).toBe('open_section');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(view.now.cta!.label) }));
    const target = intent.type === 'open_section' ? intent.sectionId : null;
    const title = view.sections.find((x) => x.id === target)!.title;
    expect(await screen.findByRole('heading', { level: 2, name: title })).toBeTruthy();
    await waitFor(() => expect(setScreen).toHaveBeenLastCalledWith({ view: 'section', sectionId: target, documentId: null, page: null }));
  });

  it('keeps locked steps out of reach and shows the running result', async () => {
    install(workingView());
    render(<App />);
    const file = await screen.findByRole('button', { name: /Print & file/ });
    expect((file as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Federal')).toBeTruthy();
  });
});
