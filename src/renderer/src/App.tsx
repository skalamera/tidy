import { MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Intent } from '../../core/nextAction';
import type { ScreenContext } from '../../shared/ipc';
import type { SectionId } from '../../shared/state';
import { tidy } from './api';
import { celebrate } from './celebrate';
import { ApiKeyScreen } from './components/ApiKeyScreen';
import { ChatPanel } from './components/ChatPanel';
import { DocViewer } from './components/DocViewer';
import { NowBar } from './components/NowBar';
import { SectionPage } from './components/SectionPage';
import { Sidebar } from './components/Sidebar';
import { Welcome } from './components/Welcome';
import { useView } from './useView';

export default function App() {
  const view = useView();
  const [sectionId, setSectionId] = useState<SectionId>('profile');
  const [doc, setDoc] = useState<{ id: string; page: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [changingAi, setChangingAi] = useState(false);

  const openSection = useCallback((id: SectionId) => {
    setSectionId(id);
    setDoc(null);
  }, []);
  useEffect(() => tidy().onNavigate(openSection), [openSection]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const screen: ScreenContext['view'] | null = !view
    ? null
    : view.now.cta?.intent.type === 'welcome'
      ? 'welcome'
      : !view.aiProvider || changingAi
        ? 'api_key'
        : 'section';
  useEffect(() => {
    if (screen)
      tidy().setScreen({
        view: screen,
        sectionId: screen === 'section' ? sectionId : null,
        documentId: doc?.id ?? null,
        page: doc?.page ?? null,
      });
  }, [screen, sectionId, doc]);

  if (!view) return <div className="loading" aria-busy="true" />;
  if (screen === 'welcome') return <Welcome onStart={() => void tidy().completeWelcome()} />;
  if (screen === 'api_key') return <ApiKeyScreen current={view.aiProvider} onClose={() => setChangingAi(false)} />;

  const exportReturn = async () => {
    const r = await tidy().exportPackage();
    if (r.ok) {
      celebrate('big');
      setToast(`Saved to ${r.path}`);
    } else setToast(r.error);
  };
  const run = (intent: Intent) => {
    switch (intent.type) {
      case 'welcome':
        void tidy().completeWelcome();
        break;
      case 'open_settings':
        break; // the key screen shows by itself while there is no key
      case 'upload':
        openSection('documents');
        void tidy().pickFiles();
        break;
      case 'open_section':
        openSection(intent.sectionId);
        break;
      case 'export':
        openSection('file');
        void exportReturn();
        break;
    }
  };
  const approved = (id: SectionId) => {
    celebrate('small');
    const next = view.sections[view.sections.findIndex((s) => s.id === id) + 1];
    if (next) openSection(next.id);
  };
  const openDoc = doc ? view.documents.find((d) => d.id === doc.id) : undefined;

  return (
    <div className={`app${chatOpen ? ' with-chat' : ''}`}>
      <div className="titlebar" />
      <Sidebar view={view} current={sectionId} onOpen={openSection} onChangeAi={() => setChangingAi(true)} />
      <main className="main">
        <NowBar now={view.now} onIntent={run} />
        <SectionPage
          key={sectionId}
          view={view}
          sectionId={sectionId}
          onOpenDoc={(id, page) => setDoc({ id, page })}
          onApproved={approved}
          onExport={() => void exportReturn()}
          onToast={setToast}
        />
      </main>
      {chatOpen ? (
        <ChatPanel view={view} sectionId={sectionId} onClose={() => setChatOpen(false)} onToast={setToast} />
      ) : (
        <button className="btn primary chat-fab" onClick={() => setChatOpen(true)}>
          <MessageCircle size={18} aria-hidden /> Ask Tidy
        </button>
      )}
      {openDoc && doc && (
        <DocViewer doc={openDoc} page={doc.page} onPage={(page) => setDoc({ id: doc.id, page })} onClose={() => setDoc(null)} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
