import { useEffect, useState } from 'react';
import { HomePage } from './components/pages/HomePage';
import { WorksListPage } from './components/pages/WorksListPage';
import { EditorPage } from './components/pages/EditorPage';
import { TemplatesPage } from './components/pages/TemplatesPage';
import { TutorialPage } from './components/pages/TutorialPage';
import { AnjiaPage } from './components/pages/AnjiaPage';
import { FindAnkePage } from './components/pages/FindAnkePage';
import { ReaderPage } from './components/pages/ReaderPage';
import { TitleBar } from './components/common/TitleBar';
import { AuthorInfo } from './components/common/AuthorInfo';
import { ToastContainer } from './components/common/Toast';
import { LocalImageWarningDialog } from './components/common/LocalImageWarningDialog';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useStoryStore } from './store/storyStore';
import { useEditorStore } from './store/editorStore';
import { useMetaStore } from './store/metaStore';
import { initDatabase } from './db/index';
import { isCapacitor, isElectron } from './utils/platform';
import './index.css';

type Route = 'home' | 'works' | 'editor' | 'reader' | 'templates' | 'tutorial' | 'anjia' | 'find-anke';

function App() {
  const { activeSectionId, activeStoryId } = useStoryStore();
  const loadSection = useEditorStore((s) => s.loadSection);
  const loadMetaForStory = useMetaStore((s) => s.loadMetaForStory);
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const [showAuthor, setShowAuthor] = useState(false);

  const [route, setRoute] = useState<Route>('home');

  // 键盘弹出检测（仅 Capacitor 移动端）：用 visualViewport 判断键盘是否打开，
  // 弹出时移除底部导航预留空间并加 body.keyboard-open class（供 CSS 隐藏底部导航）
  // 同时跟踪 visualViewport.height，让根容器跟随可视区域高度（避免键盘挤压布局）
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height
      : typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    if (!isCapacitor) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const isOpen = window.innerHeight - vv.height > 100;
      setKeyboardOpen(isOpen);
      document.body.classList.toggle('keyboard-open', isOpen);
      setViewportHeight(vv.height);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.body.classList.remove('keyboard-open');
    };
  }, []);

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

  const handleOpenStory = (storyId: string) => {
    // 兜底：调用方（HomePage/WorksListPage）通常已自行 setActiveStory，
    // 这里再调一次保证所有入口（包括 MobileBottomNav 等未来路径）都设置 activeStoryId
    void setActiveStory(storyId);
    setRoute('editor');
  };

  const handleBackToHome = () => {
    setActiveStory(null);
    setRoute('home');
  };

  // TitleBar 位于所有页面顶部（仅 Electron 无边框窗口显示；Capacitor / Web 走系统状态栏沉浸式）
  const renderWithTitleBar = (content: React.ReactNode) => (
    <div
      className="w-screen flex flex-col overflow-hidden"
      style={{
        height: viewportHeight,
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
      }}
    >
      {isElectron && <TitleBar />}
      {/* ErrorBoundary 包裹页面内容，捕获子组件渲染错误并以红色面板展示，
          避免整个 React 树卸载导致白屏看不到原因 */}
      <ErrorBoundary>
        <div
          className="flex-1 overflow-hidden"
          style={isCapacitor && !keyboardOpen ? { paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' } : undefined}
        >{content}</div>
      </ErrorBoundary>
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
        <WorksListPage
          onOpenStory={handleOpenStory}
          onBack={() => setRoute('home')}
          onShowAuthor={() => setShowAuthor(true)}
          onOpenReader={(storyId) => {
            void setActiveStory(storyId);
            setRoute('reader');
          }}
        />
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

  if (route === 'reader') {
    return renderWithTitleBar(
      <ReaderPage onBack={() => setRoute('editor')} />,
    );
  }

  return renderWithTitleBar(
    <>
      <EditorPage onBack={handleBackToHome} onOpenReader={() => setRoute('reader')} />
      {authorModal}
    </>,
  );
}

export default App;
