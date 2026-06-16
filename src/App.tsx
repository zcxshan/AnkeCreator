import { useEffect, useState } from 'react';
import { HomePage } from './components/pages/HomePage';
import { WorksListPage } from './components/pages/WorksListPage';
import { EditorPage } from './components/pages/EditorPage';
import { TemplatesPage } from './components/pages/TemplatesPage';
import { TutorialPage } from './components/pages/TutorialPage';
import { TitleBar } from './components/common/TitleBar';
import { AuthorInfo } from './components/common/AuthorInfo';
import { ExportDialog } from './components/common/ExportDialog';
import { useStoryStore } from './store/storyStore';
import { useEditorStore } from './store/editorStore';
import { useMetaStore } from './store/metaStore';
import { initDatabase } from './db/database';
import './index.css';

type Route = 'home' | 'works' | 'editor' | 'templates' | 'tutorial';

function App() {
  const { activeSectionId, activeStoryId } = useStoryStore();
  const loadSection = useEditorStore((s) => s.loadSection);
  const loadMetaForStory = useMetaStore((s) => s.loadMetaForStory);
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const [showExport, setShowExport] = useState(false);
  const [showAuthor, setShowAuthor] = useState(false);
  // 打开导出弹窗时记录当时的 activeSectionId（避免后续 active 变化影响）
  const [exportSectionId, setExportSectionId] = useState<string | null>(null);

  const [route, setRoute] = useState<Route>(activeStoryId ? 'editor' : 'home');

  useEffect(() => {
    initDatabase();
  }, []);

  useEffect(() => {
    if (route === 'editor' && activeSectionId) {
      loadSection(activeSectionId);
    }
  }, [activeSectionId, loadSection, route]);

  useEffect(() => {
    if (route === 'editor') {
      loadMetaForStory(activeStoryId ?? '');
    }
  }, [activeStoryId, loadMetaForStory, route]);

  const handleOpenStory = (_storyId: string) => {
    setRoute('editor');
  };

  const handleBackToHome = () => {
    setActiveStory(null);
    setRoute('home');
  };

  // TitleBar 位于所有页面顶部（Electron 无边框窗口的自定义控制栏）
  const renderWithTitleBar = (content: React.ReactNode) => (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}
    >
      <TitleBar />
      <div className="flex-1 overflow-hidden">{content}</div>
    </div>
  );

  const authorModal = showAuthor ? <AuthorInfo onClose={() => setShowAuthor(false)} /> : null;

  if (route === 'home') {
    return renderWithTitleBar(
      <>
        <HomePage
          onOpenStory={handleOpenStory}
          onShowWorks={() => setRoute('works')}
          onShowTemplates={() => setRoute('templates')}
          onShowTutorial={() => setRoute('tutorial')}
          onShowAuthor={() => setShowAuthor(true)}
        />
        {authorModal}
      </>,
    );
  }

  if (route === 'templates') {
    return renderWithTitleBar(
      <>
        <TemplatesPage onBack={() => setRoute('home')} onShowAuthor={() => setShowAuthor(true)} />
        {authorModal}
      </>,
    );
  }

  if (route === 'tutorial') {
    return renderWithTitleBar(
      <>
        <TutorialPage onBack={() => setRoute('home')} onShowAuthor={() => setShowAuthor(true)} />
        {authorModal}
      </>,
    );
  }

  if (route === 'works') {
    return renderWithTitleBar(
      <>
        <WorksListPage onOpenStory={handleOpenStory} onBack={() => setRoute('home')} onShowAuthor={() => setShowAuthor(true)} />
        {authorModal}
      </>,
    );
  }

  return renderWithTitleBar(
    <>
      <EditorPage
        onBack={handleBackToHome}
        onExport={() => {
          setExportSectionId(activeSectionId);
          setShowExport(true);
        }}
      />
      {showExport && (
        <ExportDialog
          onClose={() => setShowExport(false)}
          activeSectionId={exportSectionId}
        />
      )}
      {authorModal}
    </>,
  );
}

export default App;
