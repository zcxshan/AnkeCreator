import { useEffect, useState } from 'react';
import { HomePage } from './components/pages/HomePage';
import { WorksListPage } from './components/pages/WorksListPage';
import { EditorPage } from './components/pages/EditorPage';
import { ResourceLibraryPage } from './components/pages/ResourceLibraryPage';
import { TutorialPage } from './components/pages/TutorialPage';
import { AnjiaCollectPage } from './components/pages/AnjiaCollectPage';
import { AnkeCollectPage } from './components/pages/AnkeCollectPage';
import { FindAnkePage } from './components/pages/FindAnkePage';
import { CreationLogPage } from './components/pages/CreationLogPage';
import { ReaderPage } from './components/pages/ReaderPage';
import { DicePlaygroundPage } from './components/pages/DicePlaygroundPage';
import { WheelPage } from './components/pages/WheelPage';
import { DiscoveryHubPage } from './components/pages/DiscoveryHubPage';
import { PlaygroundHubPage } from './components/pages/PlaygroundHubPage';
import { TitleBar } from './components/common/TitleBar';
import { AuthorInfo } from './components/common/AuthorInfo';
import { ToastContainer } from './components/common/Toast';
import { ConfirmDialogHost } from './components/common/confirmPrompt';
import { LocalImageWarningDialog } from './components/common/LocalImageWarningDialog';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useStoryStore } from './store/storyStore';
import { useMetaStore } from './store/metaStore';
import { initDatabase } from './db/index';
import { isCapacitor, isElectron } from './utils/platform';
import { useSettingStore } from './store/settingStore';
import { flushDebouncedSave } from './store/editorStore';
import './index.css';

type Route = 'home' | 'works' | 'editor' | 'reader' | 'resource-library' | 'tutorial' | 'anjia-collect' | 'anke-collect' | 'find-anke' | 'dice-playground' | 'creation-log' | 'wheel-playground' | 'discovery' | 'playground';

function App() {
  const { activeStoryId } = useStoryStore();
  const loadMetaForStory = useMetaStore((s) => s.loadMetaForStory);
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const [showAuthor, setShowAuthor] = useState(false);

  const [route, setRoute] = useState<Route>('home');
  const [creationLogStoryId, setCreationLogStoryId] = useState<string | null>(null);

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

  // 关闭窗口前把未保存的编辑器内容 flush 到磁盘，完成后再通知主进程关闭
  useEffect(() => {
    if (!isElectron) return;
    const unsubscribe = window.electronAPI?.onAppBeforeClose?.(async () => {
      try {
        await flushDebouncedSave();
      } finally {
        window.electronAPI?.confirmAppClose?.();
      }
    });
    return () => unsubscribe?.();
  }, []);

  // 启动时扫描可用骰子音效（仅 Electron）
  useEffect(() => {
    if (!isElectron) return;
    const scan = async () => {
      try {
        const sounds = await window.electronAPI?.listDiceSounds?.();
        if (sounds && sounds.length > 0) {
          useSettingStore.getState().setAvailableDiceSounds(sounds);
        }
      } catch {
        // 扫描失败保持默认
      }
    };
    scan();
  }, []);

  // 预热骰子音效（提前加载 Audio 对象，减少首次播放延迟）（#4）
  useEffect(() => {
    import('./utils/diceSound').then(({ preloadDiceSound }) => {
      void preloadDiceSound()
    })
  }, []);

  // 注意:节加载由 EditorPage 内的 useSectionEditor 负责,这里不再重复触发
  // (旧 useEffect 会与 useSectionEditor 同时触发 loadSection,导致节内容被加载两次)

  useEffect(() => {
    if (route === 'editor') {
      loadMetaForStory(activeStoryId ?? '');
    }
  }, [activeStoryId, loadMetaForStory, route]);

  const handleOpenStory = (storyId: string) => {
    // 调用方（HomePage/WorksListPage）通常已 await setActiveStory 完成加载，
    // 这里仅在作品确实未激活时兜底加载，避免重复清空 + 重新加载造成闪屏与数据竞态
    if (useStoryStore.getState().activeStoryId !== storyId) {
      void setActiveStory(storyId);
    }
    setRoute('editor');
  };

  const handleBackToHome = () => {
    setActiveStory(null);
    setRoute('home');
  };

  // TitleBar 位于所有页面顶部（仅 Electron 无边框窗口显示；Capacitor / Web 走系统状态栏沉浸式）
  const renderWithTitleBar = (content: React.ReactNode) => (
    <div
      className="w-full bg-[var(--bg-page)] text-[var(--text-primary)] flex flex-col min-h-screen"
    >
      {/* TitleBar 始终固定在窗口顶部（sticky），
          包裹 div 加 flex-shrink: 0 防止 flex 容器压缩 TitleBar 32px 高度 */}
      {isElectron && (
        <div className="shrink-0 sticky top-0 z-50">
          <TitleBar />
        </div>
      )}
      {/* ErrorBoundary 包裹页面内容，捕获子组件渲染错误并以红色面板展示，
          避免整个 React 树卸载导致白屏看不到原因 */}
      <ErrorBoundary>
        <div
          className="flex-1 min-h-0 flex flex-col overflow-x-hidden"
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
      {/* 全局命令式确认框宿主（askConfirm），统一替代原生 window.confirm */}
      <ConfirmDialogHost />
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
          onShowResourceLibrary={() => setRoute('resource-library')}
          onShowTutorial={() => setRoute('tutorial')}
          onShowAuthor={() => setShowAuthor(true)}
          onShowDiscovery={() => setRoute('discovery')}
          onShowPlayground={() => setRoute('playground')}
          onShowCreationLog={(storyId) => {
            setCreationLogStoryId(storyId);
            setRoute('creation-log');
          }}
        />
        {authorModal}
      </>,
    );
  }

  if (route === 'discovery') {
    return renderWithTitleBar(
      <DiscoveryHubPage
        onBack={() => setRoute('home')}
        onOpenAnjiaCollect={() => setRoute('anjia-collect')}
        onOpenAnkeCollect={() => setRoute('anke-collect')}
        onOpenFindAnke={() => setRoute('find-anke')}
      />,
    );
  }

  if (route === 'playground') {
    return renderWithTitleBar(
      <PlaygroundHubPage
        onBack={() => setRoute('home')}
        onOpenDice={() => setRoute('dice-playground')}
        onOpenWheel={() => setRoute('wheel-playground')}
      />,
    );
  }

  if (route === 'dice-playground') {
    return renderWithTitleBar(
      <DicePlaygroundPage onBack={() => setRoute('playground')} />,
    );
  }

  if (route === 'wheel-playground') {
    return renderWithTitleBar(
      <WheelPage onBack={() => setRoute('playground')} />,
    );
  }

  if (route === 'resource-library') {
    return renderWithTitleBar(
      <>
        <ResourceLibraryPage
          onBack={() => setRoute('home')}
          onShowAuthor={() => setShowAuthor(true)}
        />
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

  if (route === 'anjia-collect') {
    return renderWithTitleBar(
      <AnjiaCollectPage onBack={() => setRoute('discovery')} />,
    );
  }

  if (route === 'anke-collect') {
    return renderWithTitleBar(
      <AnkeCollectPage onBack={() => setRoute('discovery')} />,
    );
  }

  if (route === 'find-anke') {
    return renderWithTitleBar(
      <FindAnkePage onBack={() => setRoute('discovery')} />,
    );
  }

  if (route === 'creation-log' && creationLogStoryId) {
    return renderWithTitleBar(
      <CreationLogPage
        storyId={creationLogStoryId}
        onBack={() => setRoute('home')}
      />,
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
