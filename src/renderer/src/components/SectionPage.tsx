import { CircleCheck, Download, Pencil } from 'lucide-react';
import { useState } from 'react';
import type { AppView } from '../../../core/view';
import type { Evidence } from '../../../shared/facts';
import type { SectionId } from '../../../shared/state';
import { tidy } from '../api';
import { answerText, STATUS_LABEL } from '../labels';
import { CardView } from './CardView';
import { ChangeList } from './ChangeList';
import { Documents } from './Documents';
import { FlagList } from './FlagList';
import { Icon } from './Icon';
import { QuestionCard } from './QuestionCard';

interface Props {
  view: AppView;
  sectionId: SectionId;
  onOpenDoc: (docId: string, page: number) => void;
  onApproved: (id: SectionId) => void;
  onExport: () => void;
  /** Opens the backup dialog (File > Back Up My Return does too). */
  onBackup?: () => void;
  onToast: (text: string) => void;
}

/** One step of the return: what we found, what we need to ask, and the approve button. */
export function SectionPage({ view, sectionId, onOpenDoc, onApproved, onExport, onBackup, onToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const section = view.sections.find((s) => s.id === sectionId)!;
  const questions = view.questions.filter((q) => q.sectionId === sectionId);
  const open = questions.filter((q) => q.answer === null || q.id === editing);
  const answered = questions.filter((q) => q.answer !== null && q.id !== editing);
  const flags = view.flags.filter((f) => f.sectionId === sectionId);
  const answer = async (id: string, value: string) => {
    await tidy().answer(id, value);
    setEditing(null);
  };
  const approve = async () => {
    setApproving(true);
    const r = await tidy().approve(sectionId);
    setApproving(false);
    if (r.ok) onApproved(sectionId);
    else onToast(r.error);
  };
  const openSource = (e: Evidence) => onOpenDoc(e.docId, e.page ?? 1);

  return (
    <div className="section-page">
      <div className="section-body">
        <header className="section-head">
          <span className="section-icon">
            <Icon name={section.icon} size={22} />
          </span>
          <div>
            <h2>{section.title}</h2>
            <p>{section.blurb}</p>
          </div>
          <span className={`chip status-${section.status}`}>{STATUS_LABEL[section.status]}</span>
        </header>

        <FlagList flags={flags} />

        <ChangeList changes={view.overrides.filter((o) => o.sectionId === sectionId)} onToast={onToast} />

        {open.length > 0 && (
          <div className="questions">
            {open.map((q) => (
              <QuestionCard key={q.id} question={q} onAnswer={(a) => answer(q.id, a)} />
            ))}
          </div>
        )}

        {sectionId === 'documents' && (
          <Documents docs={view.documents} hasApiKey={view.aiProvider !== null} onOpen={(id) => onOpenDoc(id, 1)} onToast={onToast} />
        )}

        <div className="cards">
          {/* On the documents step the list above already shows every document, so skip the summary card. */}
          {view.details[sectionId]
            .filter((c) => !(sectionId === 'documents' && c.id === 'docs'))
            .map((c) => (
              <CardView key={c.id} card={c} onOpenSource={openSource} />
            ))}
        </div>

        {answered.length > 0 && (
          <details className="answered">
            <summary>Your answers ({answered.length})</summary>
            <ul>
              {answered.map((q) => (
                <li key={q.id}>
                  <span>{q.prompt}</span>
                  <strong>{answerText(q)}</strong>
                  <button className="btn ghost small" onClick={() => setEditing(q.id)}>
                    <Pencil size={14} aria-hidden /> Change
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {sectionId === 'file' ? (
        <footer className="approve-bar">
          <p>
            {view.canExport
              ? 'Everything is approved. Your forms are ready to print.'
              : 'Approve every step and fix anything marked “Must fix” to unlock your forms.'}
          </p>
          <button className="btn primary big" disabled={!view.canExport} onClick={onExport}>
            <Download size={18} aria-hidden /> Download my return (PDF)
          </button>
          {onBackup && (
            <p className="file-backup">
              Keep a copy of everything in Tidy, locked with a passphrase:{' '}
              <button className="btn ghost small" onClick={onBackup}>
                Back up my return
              </button>
            </p>
          )}
        </footer>
      ) : (
        <footer className="approve-bar">
          {section.status === 'approved' ? (
            <p className="approved">
              <CircleCheck size={18} aria-hidden /> Approved. If anything here changes, we’ll ask you to look again.
            </p>
          ) : (
            <>
              <p>
                {section.status === 'ready' || section.status === 'needs_reapproval'
                  ? 'Does everything above look right?'
                  : section.status === 'paused'
                    ? 'Tidy can’t check this step until the snag above is sorted out.'
                    : 'Answer the questions above first.'}
              </p>
              <button
                className="btn primary big"
                disabled={approving || (section.status !== 'ready' && section.status !== 'needs_reapproval')}
                onClick={approve}
              >
                <CircleCheck size={18} aria-hidden /> Looks right, approve
              </button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
