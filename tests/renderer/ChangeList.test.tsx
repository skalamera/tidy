// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildView } from '../../src/core/view';
import type { TidyApi } from '../../src/shared/ipc';
import { SectionPage } from '../../src/renderer/src/components/SectionPage';
import { doc, NOW, stateWith, w2Extraction } from '../fixtures/state';

afterEach(cleanup);

describe('Changes you made', () => {
  it('lists the changes accepted on a step, says which one was set aside, and undoes one', async () => {
    const undoOverride = vi.fn(async () => ({ ok: true as const }));
    window.tidy = { undoOverride } as unknown as TidyApi;
    const view = buildView(
      stateWith({
        documents: [doc('d1', [w2Extraction()])],
        overrides: [
          {
            id: 'o1',
            path: ['w2s', 'w2-d1-0', 'box1Wages'],
            value: 8_600_000,
            reason: 'Blurry scan',
            createdAt: NOW,
            createdBy: 'ai_proposal',
            sectionId: 'wages',
          },
          {
            id: 'o2',
            path: ['w2s', 'w2-gone-0', 'box2FedWithheld'],
            value: 100,
            reason: 'Old W-2',
            createdAt: NOW,
            createdBy: 'ai_proposal',
            sectionId: 'wages',
            change: { label: 'W-2 from Old Corp: Box 2 federal withheld', before: '$5', after: '$1' },
          },
          {
            id: 'o3',
            path: ['itemized', 'charityCash'],
            value: 50_000,
            reason: 'Receipt',
            createdAt: NOW,
            createdBy: 'ai_proposal',
            sectionId: 'deductions',
          },
        ],
      }),
      { aiProvider: 'anthropic' },
    );
    render(
      <SectionPage
        view={view}
        sectionId="wages"
        onOpenDoc={() => undefined}
        onApproved={() => undefined}
        onExport={() => undefined}
        onToast={() => undefined}
      />,
    );
    const list = screen.getByRole('region', { name: 'Changes you made' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2); // the charity change shows on the deductions step
    expect(items[0].textContent).toContain('W-2 from Acme Corp: Box 1 wages');
    expect(items[0].textContent).toContain('$85,000');
    expect(items[0].textContent).toContain('$86,000');
    expect(items[1].textContent).toContain('Set aside: this no longer fits your return.');
    expect(screen.getByText('A change you accepted no longer fits your return')).toBeTruthy(); // the blocker on this step
    await userEvent.click(within(items[1]).getByRole('button', { name: /Undo/ }));
    expect(undoOverride).toHaveBeenCalledWith('o2');
  });
});
