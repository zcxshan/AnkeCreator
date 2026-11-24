import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HomePage } from './components/pages/HomePage';
import { TitleBar } from './components/common/TitleBar';
import { ToastContainer } from './components/common/Toast';
import { ConfirmDialogHost } from './components/common/confirmPrompt';
import { LocalImageWarningDialog } from './components/common/LocalImageWarningDialog';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useStoryStore } from './store/storyStore';
import { useMetaStore } from './store/metaStore';
import { initDatabase } from './db/index';
import { isCapacitor, isElectron } from './utils/platform';
import { Keyboard } from '@capacitor/keyboard';
import { useSettingStore } from './store/settingStore';
import { useThemeStore } from './store/themeStore';
import { flushDebouncedSave } from './store/editorStore';
import './index.css';

// 路由级代码分割：首屏只加载 HomePage，编辑器（TipTap）/ 资源库 / 收集页等按需加载，
// 显著降低入口包体积与启动解析时间。
const WorksListPage = lazy(() =>
  import('./components/pages/WorksListPage').then((m) => ({ default: m.WorksListPage }))
);
const EditorPage = lazy(() =>
  import('./components/pages/EditorPage').then((m) => ({ default: m.EditorPage }))
);
const ResourceLibraryPage = lazy(() =>
  import('./components/pages/ResourceLibraryPage').then((m) => ({ default: m.ResourceLibraryPage }))
);
const TutorialPage = lazy(() =>
  import('./components/pages/TutorialPage').then((m) => ({ default: m.TutorialPage }))
);
const AnjiaCollectPage = lazy(() =>
  import('./components/pages/AnjiaCollectPage').then((m) => ({ default: m.AnjiaCollectPage }))
);
const AnkeCollectPage = lazy(() =>
  import('./components/pages/AnkeCollectPage').then((m) => ({ default: m.AnkeCollectPage }))
);
const FindAnkePage = lazy(() =>
  import('./components/pages/FindAnkePage').then((m) => ({ default: m.FindAnkePage }))
);
const CreationLogPage = lazy(() =>
  import('./components/pages/CreationLogPage').then((m) => ({ default: m.CreationLogPage }))
);
const ReaderPage = lazy(() =>
  import('./components/pages/ReaderPage').then((m) => ({ default: m.ReaderPage }))
);
const DicePlaygroundPage = lazy(() =>
  import('./components/pages/DicePlaygroundPage').then((m) => ({ default: m.DicePlaygroundPage }))
);
const WheelPage = lazy(() =>
  import('./components/pages/WheelPage').then((m) => ({ default: m.WheelPage }))
);
const DiscoveryHubPage = lazy(() =>
  import('./components/pages/DiscoveryHubPage').then((m) => ({ default: m.DiscoveryHubPage }))
);
const PlaygroundHubPage = lazy(() =>
  import('./components/pages/PlaygroundHubPage').then((m) => ({ default: m.PlaygroundHubPage }))
);
const AuthorInfo = lazy(() =>
  import('./components/common/AuthorInfo').then((m) => ({ default: m.AuthorInfo }))
);

/** 懒加载页面的轻量占位（纯 CSS，避免额外依赖） */
function PageLoading() {
  return (
    <div className="flex-1 min-h-[40vh] flex items-center justify-center text-[var(--text-muted)] text-xs">
      <span className="inline-block w-4 h-4 mr-2 rounded-full border-2 border-[color:var(--accent)] border-t-transparent animate-spin" />
      加载中…
    </div>
  );
}

type Route = 'home' | 'works' | 'editor' | 'reader' | 'resource-library' | 'tutorial' | 'anjia-collect' | 'anke-collect' | 'find-anke' | 'dice-playground' | 'creation-log' | 'wheel-playground' | 'discovery' | 'playground';

// Android 物理返回键的路由回退目标（未列出的 home 视为"根"，再按返回即退出应用）
const BACK_TARGETS: Partial<Record<Route, Route>> = {
  works: 'home',
  'resource-library': 'home',
  tutorial: 'home',
  discovery: 'home',
  playground: 'home',
  'dice-playground': 'playground',
  'wheel-playground': 'playground',
  'anjia-collect': 'discovery',
  'anke-collect': 'discovery',
  'find-anke': 'discovery',
  'creation-log': 'home',
  reader: 'editor',
};

function App() {
  const { activeStoryId } = useStoryStore();
  const loadMetaForStory = useMetaStore((s) => s.loadMetaForStory);
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const [showAuthor, setShowAuthor] = useState(false);

  const [route, setRoute] = useState<Route>('home');
  const [creationLogStoryId, setCreationLogStoryId] = useState<string | null>(null);
  // 记录最新路由，供 Android 返回键监听（只注册一次）读取
  const routeRef = useRef(route);
  routeRef.current = route;

  // 键盘弹出检测（仅 Capacitor 移动端）
  // Android 使用 android:windowSoftInputMode="adjustNothing"，WebView 不会自动缩放，
  // 且 visualViewport.height 不会变化 —— 必须订阅 @capacitor/keyboard 事件，
  // 由前端自行把根容器高度减去键盘高度，编辑区才会让出键盘空间（否则光标会被键盘挡住）。
  // 同时保留 visualViewport 兜底（iOS / 原生 resize 场景）。
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height
      : typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    if (!isCapacitor) return;
    const apply = () => {
      const vvGap = window.visualViewport
        ? window.innerHeight - window.visualViewport.height
        : 0;
      const h = Math.round(Math.max(keyboardHeightRef.current, vvGap));
      const isOpen = h > 100;
      setKeyboardOpen(isOpen);
      setKeyboardHeight(isOpen ? h : 0);
      document.body.classList.toggle('keyboard-open', isOpen);
      document.documentElement.style.setProperty('--keyboard-height', `${isOpen ? h : 0}px`);
      setViewportHeight(window.visualViewport ? window.visualViewport.height : window.innerHeight);
    };
    const listeners = [
      Keyboard.addListener('keyboardWillShow', (info) => {
        keyboardHeightRef.current = info.keyboardHeight;
        apply();
      }),
      Keyboard.addListener('keyboardDidShow', (info) => {
        keyboardHeightRef.current = info.keyboardHeight;
        apply();
      }),
      Keyboard.addListener('keyboardWillHide', () => {
        keyboardHeightRef.current = 0;
        apply();
      }),
      Keyboard.addListener('keyboardDidHide', () => {
        keyboardHeightRef.current = 0;
        apply();
      }),
    ];
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', apply);
      vv.addEventListener('scroll', apply);
    }
    apply();
    return () => {
      listeners.forEach((p) => p.then((l) => l.remove()).catch(() => {}));
      if (vv) {
        vv.removeEventListener('resize', apply);
        vv.removeEventListener('scroll', apply);
      }
      document.body.classList.remove('keyboard-open');
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    };
  }, []);

  // Android 物理返回键 & 后台落盘（仅 Capacitor）：
  // 1) 先派发可取消事件 anke:android-back，让弹窗/抽屉/面板拦截；
  // 2) 未被拦截时按路由栈回退；3) 已在首页则落盘后退出应用；
  // 4) 切到后台（pause）时立即 flush 编辑器未保存内容，避免被系统回收丢稿。
  useEffect(() => {
    if (!isCapacitor) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        if (disposed) return;

        const backListener = await CapApp.addListener('backButton', () => {
          const evt = new CustomEvent('anke:android-back', { cancelable: true });
          if (!window.dispatchEvent(evt)) return; // 已被页面内浮层处理

          const current = routeRef.current;
          if (current === 'editor') {
            // 与编辑页可见的返回按钮保持一致：清空当前作品并回首页
            setActiveStory(null);
            setRoute('home');
            return;
          }
          const target = BACK_TARGETS[current];
          if (target) {
            setRoute(target);
            return;
          }
          void flushDebouncedSave().finally(() => {
            void CapApp.exitApp();
          });
        });

        const pauseListener = await CapApp.addListener('pause', () => {
          void flushDebouncedSave();
        });

        cleanup = () => {
          void backListener.remove();
          void pauseListener.remove();
        };
      } catch {
        // 插件缺失/非原生环境：保持系统默认返回行为
      }
    };
    void setup();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [setActiveStory]);

  useEffect(() => {
    const init = async () => {
      await initDatabase();
    };
    init();
  }, []);

  // 状态栏跟随 App 主题（仅 Capacitor）：暗色→浅色文字 + 深底；亮色→深色文字 + 白底。
  // capacitor.config.ts 里写死的是暗色，用户切到亮色主题时会露出深色状态栏，这里纠正。
  const themeMode = useThemeStore((s) => s.mode);
  useEffect(() => {
    if (!isCapacitor) return;
    void (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        const isLight = themeMode === 'light';
        await StatusBar.setStyle({ style: isLight ? Style.Light : Style.Dark });
        await StatusBar.setBackgroundColor({ color: isLight ? '#ffffff' : '#1e293b' });
      } catch {
        // 插件不可用：保持原生默认
      }
    })();
  }, [themeMode]);

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

  // 启动后的非关键任务（骰子音效扫描 + 预热）延迟到浏览器空闲时执行，
  // 避免与首屏渲染/数据库初始化抢占主线程。
  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;
    let ran = false;
    const run = () => {
      if (cancelled || ran) return;
      ran = true;
      void (async () => {
        try {
          const sounds = await window.electronAPI?.listDiceSounds?.();
          if (sounds && sounds.length > 0) {
            useSettingStore.getState().setAvailableDiceSounds(sounds);
          }
        } catch {
          // 扫描失败保持默认
        }
        try {
          const { preloadDiceSound } = await import('./utils/diceSound');
          void preloadDiceSound();
        } catch {
          // 音效预加载失败不影响使用
        }
      })();
    };
    const hasIdle = typeof window.requestIdleCallback === 'function';
    let idleId: number | undefined;
    let timer: number | undefined;
    if (hasIdle) {
      idleId = window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      timer = window.setTimeout(run, 1200);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
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

  // 编辑/阅读页隐藏全局底部导航：
  // 这两页是"沉浸式"工作区，底部导航既挤压正文纵向空间，又容易误触切走丢上下文。
  // 页面内已有返回/目录按钮，离开路径不受影响。
  const hideBottomNav = route === 'editor' || route === 'reader';

  // TitleBar 位于所有页面顶部（仅 Electron 无边框窗口显示；Capacitor / Web 走系统状态栏沉浸式）
  const renderWithTitleBar = (content: React.ReactNode) => (
    <div
      className="w-full bg-[var(--bg-page)] text-[var(--text-primary)] flex flex-col min-h-screen"
      // 键盘弹出时把根容器高度收缩到键盘上沿，页面内部（编辑区）随之让出空间。
      // 必须同时把 min-height 归零，否则 min-h-screen 会覆盖 height。
      style={
        keyboardOpen && keyboardHeight > 0
          ? { height: `calc(100dvh - ${keyboardHeight}px)`, minHeight: 0 }
          : undefined
      }
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
          className={`anke-app-content flex-1 min-h-0 flex flex-col overflow-x-hidden${hideBottomNav ? ' no-bottom-nav' : ''}`}
        >
          <Suspense fallback={<PageLoading />}>{content}</Suspense>
        </div>
      </ErrorBoundary>
      {/* 移动端底部导航栏（仅 Capacitor 生效，isElectron / isWeb 不渲染） */}
      {!hideBottomNav && (
        <MobileBottomNav
          route={route}
          onChangeRoute={(r) => setRoute(r)}
          onShowAuthor={() => setShowAuthor(true)}
          hasActiveStory={!!activeStoryId}
        />
      )}
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
