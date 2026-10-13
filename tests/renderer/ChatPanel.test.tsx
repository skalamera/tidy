// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildView } from '../../src/core/view';
import { NO_CHAT, type ChatMessage, type ChatView } from '../../src/shared/chat';
import type { TidyApi } from '../../src/shared/ipc';
import { ChatPanel } from '../../src/renderer/src/components/ChatPanel';
import { stateWith } from '../fixtures/state';

const TODAY = new Date('2026-10-13T16:00:00.000Z'); // a Tuesday, midday in every US time zone

/** window.tidy with chat streaming stubbed; every other method is a spy. */
function install(overrides: Partial<TidyApi> = {}) {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Partial<TidyApi> = { onChatDelta: () => () => undefined, ...overrides };
  window.tidy = new Proxy(base, {
    get: (target, key: string) => target[key as keyof TidyApi] ?? (spies[key] ??= vi.fn(async () => undefined)),
  }) as TidyApi;
  return spies;
}

const SAVED: ChatView['conversations'] = [
  {
    id: 'c3',
    title: 'Why is my refund smaller?',
    createdAt: '2026-10-13T14:00:00.000Z',
    updatedAt: '2026-10-13T14:05:00.000Z',
    messageCount: 4,
  },
  { id: 'c2', title: 'What is box 12?', createdAt: '2026-10-12T15:00:00.000Z', updatedAt: '2026-10-12T15:02:00.000Z', messageCount: 2 },
  { id: 'c1', title: 'Should I itemize?', createdAt: '2026-09-28T16:00:00.000Z', updatedAt: '2026-09-28T16:01:00.000Z', messageCount: 2 },
];

const msg = (text: string, role: ChatMessage['role'] = 'user', extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: text,
  role,
  text,
  at: '2026-10-13T14:00:00.000Z',
  proposalIds: [],
  ...extra,
});

function panel(chat: Partial<ChatView> = {}) {
  const onChangeAi = vi.fn();
  const view = buildView(stateWith(), { aiProvider: 'anthropic', chat: { ...NO_CHAT, conversations: SAVED, ...chat } });
  render(<ChatPanel view={view} sectionId="profile" onClose={() => undefined} onToast={() => undefined} onChangeAi={onChangeAi} />);
  return { onChangeAi };
}

const openHistory = () => userEvent.click(screen.getByRole('button', { name: 'All chats' }));

beforeEach(() => void vi.useFakeTimers({ now: TODAY, toFake: ['Date'] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatPanel', () => {
  it('lists saved chats by day, newest first, and opens the one picked', async () => {
    const spies = install();
    panel({ currentId: 'c3', messages: [msg('Why is my refund smaller?')] });
    await openHistory();
    const list = screen.getByRole('region', { name: 'Your chats' });
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Today', 'Yesterday', 'Monday, September 28']);
    await userEvent.click(within(list).getByRole('button', { name: /^What is box 12\?/ }));
    expect(spies.openChat).toHaveBeenCalledWith('c2');
    expect(screen.queryByRole('region', { name: 'Your chats' })).toBeNull();
  });

  it('starts a new chat, and offers nothing to start while the chat is already new', async () => {
    const spies = install();
    panel({ currentId: 'c3', messages: [msg('Why is my refund smaller?')] });
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(spies.newChat).toHaveBeenCalled();
    cleanup();
    panel();
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before deleting a chat', async () => {
    const spies = install();
    panel();
    await openHistory();
    await userEvent.click(screen.getByRole('button', { name: 'Delete “What is box 12?”' }));
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    expect(spies.deleteChat?.mock.calls.length ?? 0).toBe(0); // the spy only exists once deleteChat is called
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(spies.deleteChat).toHaveBeenCalledWith('c2');
  });

  it('searches by words and dates, and shows where the words were found', async () => {
    const searchChats = vi.fn(async () => [{ id: 'c1', snippet: '…the SALT cap is $40,000 for 2025…' }]);
    install({ searchChats });
    panel();
    await openHistory();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'salt');
    await waitFor(() => expect(searchChats).toHaveBeenLastCalledWith({ words: 'salt', from: null, to: null }));
    const list = screen.getByRole('region', { name: 'Your chats' });
    await waitFor(() => expect(within(list).queryByText('What is box 12?')).toBeNull());
    expect(within(list).getByRole('button', { name: /^Should I itemize\?/ })).toBeTruthy();
    expect(within(list).getByText('SALT', { selector: 'mark' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    await waitFor(() => expect(searchChats).toHaveBeenLastCalledWith({ words: 'salt', from: '2026-09-01', to: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(within(list).getByText('What is box 12?')).toBeTruthy();
    expect(within(list).queryByText(/the SALT cap is/)).toBeNull(); // no leftover passage once the search is cleared
  });

  it('says when no chat matches', async () => {
    install({ searchChats: async () => [] });
    panel();
    await openHistory();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'mortgage');
    expect(await screen.findByText('No chats match. Try fewer words or wider dates.')).toBeTruthy();
  });

  it('shows a failed reply as a problem, with a button to change AI', async () => {
    install();
    const { onChangeAi } = panel({
      currentId: 'c3',
      messages: [
        msg('Hi'),
        msg('Your Anthropic account is out of credits, so Claude can’t answer.', 'assistant', { error: { changeAi: true } }),
      ],
    });
    expect(screen.getByText('Your Anthropic account is out of credits, so Claude can’t answer.').closest('.msg')?.className).toContain(
      'error',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change AI' }));
    expect(onChangeAi).toHaveBeenCalled();
  });

  it('shows Tidy answering only in the chat it is answering, and holds new questions until it is done', () => {
    install();
    panel({ currentId: 'c3', busyId: 'c3', messages: [msg('Hi')] });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    cleanup();
    panel({ currentId: 'c2', busyId: 'c3', messages: [msg('What is box 12?')] });
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(screen.getByText('Tidy is still answering in another chat.')).toBeTruthy();
  });
});
