import { useEffect, useState } from 'react';
import { HomePage } from './components/pages/HomePage';
import { WorksListPage } from './components/pages/WorksListPage';
import { EditorPage } from './components/pages/EditorPage';
import { TemplatesPage } from './components/pages/TemplatesPage';
import { TutorialPage } from './components/pages/TutorialPage';
import { AnjiaPage } from './components/pages/AnjiaPage';
import { FindAnkePage } from './components/pages/FindAnkePage';
import { TitleBar } from './components/common/TitleBar';
import { AuthorInfo } from './components/common/AuthorInfo';
import { ExportDialog } from './components/common/ExportDialog';
import { ToastContainer } from './components/common/Toast';
import { LocalImageWarningDialog } from './components/common/LocalImageWarningDialog';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { useStoryStore } from './store/storyStore';
import { useEditorStore } from './store/editorStore';
import { useMetaStore } from './store/metaStore';
import { initDatabase } from './db/database';
import { isCapacitor, isElectron } from './utils/platform';
import './index.css';

type Route = 'home' | 'works' | 'editor' | 'templates' | 'tutorial' | 'anjia' | 'find-anke';

function App() {
  const { activeSectionId, activeStoryId } = useStoryStore();
  const loadSection = useEditorStore((s) => s.loadSection);
  const loadMetaForStory = useMetaStore((s) => s.loadMetaForStory);
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const [showExport, setShowExport] = useState(false);
  const [showAuthor, setShowAuthor] = useState(false);
  // 打开导出弹窗时记录当时的 activeSectionId（避免后续 active 变化影响）
  const [exportSectionId, setExportSectionId] = useState<string | null>(null);

  const [route, setRoute] = useState<Route>('home');

  useEffect(() => {
    const init = async () => {
      await initDatabase();
    };
    init();
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

  // TitleBar 位于所有页面顶部（仅 Electron 无边框窗口显示；Capacitor / Web 走系统状态栏沉浸式）
  const renderWithTitleBar = (content: React.ReactNode) => (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}
    >
      {isElectron && <TitleBar />}
      <div className={`flex-1 overflow-hidden ${isCapacitor ? 'pb-14' : ''}`}>{content}</div>
      {/* 移动端底部导航栏（仅 Capacitor 生效，isElectron / isWeb 不渲染） */}
      <MobileBottomNav
        route={route}
        onChangeRoute={(r) => setRoute(r)}
        onShowAuthor={() => setShowAuthor(true)}
        hasActiveStory={!!activeStoryId}
      />
      <ToastContainer />
      {/* 全局唯一的本地上传警告弹窗（订阅 imageWarningStore.open） */}
      <LocalImageWarningDialog />
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
          onShowAnjia={() => setRoute('anjia')}
          onShowFindAnke={() => setRoute('find-anke')}
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

  if (route === 'anjia') {
    return renderWithTitleBar(
      <AnjiaPage onBack={() => setRoute('home')} />,
    );
  }

  if (route === 'find-anke') {
    return renderWithTitleBar(
      <FindAnkePage onBack={() => setRoute('home')} />,
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
