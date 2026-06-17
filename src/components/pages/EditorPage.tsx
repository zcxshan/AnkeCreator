import { useState, useMemo, useRef, useEffect } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useEditorStore } from '../../store/editorStore';
import { useDiceStore } from '../../store/diceStore';
import {
  useDiceHistoryStore,
  buildDiceHistoryRecord,
} from '../../store/diceHistoryStore';
import type { Section, WorldSetting, DiceBlockPayloadV2 } from '../../types';
import { NGA_IMAGE_SIZES, NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import * as db from '../../db/database';
import { useMetaStore } from '../../store/metaStore';
import { useSectionEditor } from '../../hooks/useSectionEditor';
import { DirectoryTree } from '../common/DirectoryTree';
import { DiceConfigDialog } from '../dice/DiceConfigDialog';
import { WorldSettingPanel } from '../common/WorldSettingPanel';
import { CharacterPanel } from '../character/CharacterEditor';
import { RichTextEditor, type RichTextEditorCommands } from '../editor/RichTextEditor';
import { RelationshipPanel } from '../editor/RelationshipPanel';
import { OutlineTree } from '../outline/OutlineTree';
import { OutlineEditor } from '../outline/OutlineEditor';
import { SyncDialog } from '../common/SyncDialog';
import {
  computeDiff,
  buildOutlineStructure,
  buildDirectoryStructure,
} from '../../utils/structureSync';
import type { DiffItem } from '../../utils/structureSync';
import { parseOutlineContent } from '../../types';

interface EditorPageProps {
  onBack: () => void;
  onExport: () => void;
}

type EditorView = 'info' | 'directory' | 'outline' | 'character';

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器）。
 * 规则：
 *  - 文本节点按非空白字符计数
 *  - 原子块（image-block / dice-card）各算 1 个"骰子/图片"项（不计入 words）
 *  - 返回 { words, dice }，dice 实际上是 "原子块总数"
 */
function countWordsFromHtml(html: string): { words: number; dice: number } {
  if (!html) return { words: 0, dice: 0 };
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let words = 0;
    let dice = 0;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ALL, {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (
            el.dataset?.type === 'image-block' ||
            el.dataset?.type === 'dice-card'
          ) {
            dice++;
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || '').replace(/\s/g, '');
      words += text.length;
      node = walker.nextNode();
    }
    return { words, dice };
  } catch {
    return { words: 0, dice: 0 };
  }
}

function countWordsAndDice(json: any): { words: number; dice: number } {
  let words = 0;
  let dice = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') {
      words += node.text.replace(/\s/g, '').length;
    }
    if (node.type === 'dice-card' || node.type === 'dice') {
      dice++;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };
  walk(json);
  return { words, dice };
}

/** VS Code 风格的可拖动分隔条 */
function ResizeHandle({ onResize, side }: { onResize: (delta: number) => void; side: 'left' | 'right' }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onResize(side === 'left' ? delta : -delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className="shrink-0 hover:opacity-100 transition-opacity opacity-40"
      style={{
        width: 4,
        cursor: 'col-resize',
        background: 'var(--border-color)',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--border-color)'; e.currentTarget.style.opacity = ''; }}
    />
  );
}

export function EditorPage({ onBack, onExport }: EditorPageProps) {
  const {
    stories,
    activeStoryId,
    volumes,
    chapters,
    sections,
    activeChapterId,
    activeSectionId,
    expandedVolumeIds,
    expandedChapterIds,
    outlines,
    createVolume,
    createChapter,
    createSection,
    renameVolume,
    renameChapter,
    renameSection,
    deleteVolume,
    deleteChapter,
    deleteSection,
    renameStory,
    toggleVolume,
    toggleChapter,
    setActiveChapter,
    setActiveSection,
    reorderVolumes,
    reorderChapters,
    reorderSections,
    createOutlineVolume,
    createOutlineChapter,
    renameOutline,
    deleteOutline,
    updateOutline,
  } = useStoryStore();

  const {
    sectionContent,
    setSectionContent,
    flushSectionContent,
  } = useEditorStore();

  const diceStore = useDiceStore();
  const [view, setView] = useState<EditorView>('directory');
  const [rightPanelTab, setRightPanelTab] = useState<
    'properties' | 'world' | 'character' | 'dice' | 'relation'
  >('properties');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const richTextEditorCommandsRef = useRef<RichTextEditorCommands | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ width: number; height: number; src?: string; dataSize?: string } | null>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(384);

  // 同步对话框状态（支持双向：目录→大纲、大纲→目录）
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDialogSource, setSyncDialogSource] = useState<'directory' | 'outline'>('directory');
  const [volumeDiffs, setVolumeDiffs] = useState<DiffItem[]>([]);
  const [chapterDiffs, setChapterDiffs] = useState<DiffItem[]>([]);

  const handleOpenSyncDialog = (source: 'directory' | 'outline' = 'directory') => {
    if (!activeStoryId) return;
    const outlineStruct = buildOutlineStructure(outlines);
    const dirStruct = buildDirectoryStructure(volumes, chapters, outlines);
    const { volumes: volDiffs, chapters: chDiffs } = computeDiff(
      source,
      outlineStruct,
      dirStruct,
    );
    setSyncDialogSource(source);
    setVolumeDiffs(volDiffs);
    setChapterDiffs(chDiffs);
    setSyncDialogOpen(true);
  };

  const handleApplySync = async (confirmedVolDiffs: DiffItem[], confirmedChDiffs: DiffItem[]) => {
    if (!activeStoryId) return;

    if (syncDialogSource === 'directory') {
      // === 目录 → 大纲：新增缺失的 outline，删除多余的 outline ===
      const outlineVolumeIdByDirId: Record<string, string> = {};
      for (const d of confirmedVolDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const id = await createOutlineVolume(d.title);
          outlineVolumeIdByDirId[d.sourceId || ''] = id;
          if (d.sourceId) {
            updateOutline(id, { target_id: d.sourceId });
          }
        } else if (d.kind === 'remove') {
          if (d.destId) deleteOutline(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameOutline(d.destId, d.title);
          } else {
            if (d.sourceId) renameVolume(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
      for (const d of confirmedChDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const chapter = d.sourceId ? chapters.find((c) => c.id === d.sourceId) : null;
          const parentDirVolumeId = chapter?.volume_id || null;
          let parentOutlineVolumeId: string | null = null;
          if (parentDirVolumeId) {
            const parentOutline = outlines.find((o) => {
              const p = parseOutlineContent(o.content);
              return p.target_type === 'volume' && p.target_id === parentDirVolumeId;
            });
            if (parentOutline) parentOutlineVolumeId = parentOutline.id;
            if (!parentOutlineVolumeId && outlineVolumeIdByDirId[parentDirVolumeId]) {
              parentOutlineVolumeId = outlineVolumeIdByDirId[parentDirVolumeId];
            }
          }
          if (parentOutlineVolumeId) {
            const newId = await createOutlineChapter(parentOutlineVolumeId, d.title);
            if (d.sourceId) {
              updateOutline(newId, { target_id: d.sourceId });
            }
          } else {
            // 没有归属的卷，创建一个卷作为容器
            const containerId = await createOutlineVolume(`未归卷容器`);
            const newId = await createOutlineChapter(containerId, d.title);
            if (d.sourceId) {
              updateOutline(newId, { target_id: d.sourceId });
            }
          }
        } else if (d.kind === 'remove') {
          if (d.destId) deleteOutline(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameOutline(d.destId, d.title);
          } else {
            if (d.sourceId) renameChapter(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
    } else {
      // === 大纲 → 目录：新增缺失的 volume/chapter，删除多余的 volume/chapter ===
      const dirVolumeIdByOutlineId: Record<string, string> = {};
      for (const d of confirmedVolDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const newVolId = await createVolume(activeStoryId, d.title);
          dirVolumeIdByOutlineId[d.sourceId || ''] = newVolId;
          if (d.sourceId) updateOutline(d.sourceId, { target_id: newVolId });
        } else if (d.kind === 'remove') {
          if (d.destId) deleteVolume(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameVolume(d.destId, d.title);
          } else {
            if (d.sourceId) renameOutline(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
      for (const d of confirmedChDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const outline = d.sourceId ? outlines.find((o) => o.id === d.sourceId) : null;
          const payload = outline ? parseOutlineContent(outline.content) : null;
          const parentOutlineId = payload?.parent_outline_id;
          let parentVolumeId: string | null = null;
          if (parentOutlineId) {
            const parentOutline = outlines.find((o) => o.id === parentOutlineId);
            if (parentOutline) {
              const parentPayload = parseOutlineContent(parentOutline.content);
              parentVolumeId = parentPayload.target_id || null;
            }
            if (!parentVolumeId && dirVolumeIdByOutlineId[parentOutlineId]) {
              parentVolumeId = dirVolumeIdByOutlineId[parentOutlineId];
            }
          }
          const newChapterId = await createChapter(activeStoryId, d.title, parentVolumeId);
          if (d.sourceId && outline) updateOutline(d.sourceId, { target_id: newChapterId });
        } else if (d.kind === 'remove') {
          if (d.destId) deleteChapter(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameChapter(d.destId, d.title);
          } else {
            if (d.sourceId) renameOutline(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
    }

    setSyncDialogOpen(false);
  };

  // 节切换自动保存 / 加载逻辑（使用 useSectionEditor hook）
  useSectionEditor(activeSectionId);

  const story = stories.find((s) => s.id === activeStoryId);
  const section = sections.find((s) => s.id === activeSectionId);

  const [sectionStats, setSectionStats] = useState<Record<string, { words: number; dice: number }>>({});

  useEffect(() => {
    const loadStats = async () => {
      const stats: Record<string, { words: number; dice: number }> = {};
      for (const sec of sections) {
        try {
          const content = await db.getSectionContent(sec.id);
          if (!content) {
            stats[sec.id] = { words: 0, dice: 0 };
            continue;
          }
          try {
            const json = JSON.parse(content);
            const { words, dice } = countWordsAndDice(json);
            stats[sec.id] = { words, dice };
          } catch {
            stats[sec.id] = { words: 0, dice: 0 };
          }
        } catch {
          stats[sec.id] = { words: 0, dice: 0 };
        }
      }
      setSectionStats(stats);
    };
    loadStats();
  }, [sections]);

  const sectionWordCount = useMemo(() => {
    if (!sectionContent) return 0;
    // 优先尝试旧版 JSON（旧版可能还在被覆盖的内容）
    try {
      const json = JSON.parse(sectionContent);
      if (json && typeof json === 'object') {
        return countWordsAndDice(json).words;
      }
    } catch {
      // fallthrough
    }
    // 新 contenteditable：HTML 字符串
    return countWordsFromHtml(sectionContent).words;
  }, [sectionContent]);

  const handleTitleEditCommit = () => {
    const trimmed = titleInput.trim();
    if (trimmed && story && trimmed !== story.title) {
      renameStory(story.id, trimmed);
    }
    setIsEditingTitle(false);
  };

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}
    >
      {/* 顶部导航栏 */}
      <header
        className="shrink-0 flex items-center gap-4 px-4 py-2.5"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}
      >
        <button
          onClick={onBack}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="返回"
        >
          ←
        </button>

        <div className="shrink-0 min-w-0 max-w-[280px]">
          {isEditingTitle ? (
            <input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleEditCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleEditCommit();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              className="text-sm font-semibold px-2 py-1 rounded outline-none w-full"
              style={{ border: '1px solid var(--accent)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
            />
          ) : (
            <button
              onClick={() => {
                if (story) {
                  setTitleInput(story.title);
                  setIsEditingTitle(true);
                }
              }}
              className="text-left text-sm font-semibold px-2 py-1 rounded transition-colors truncate block w-full"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              title="点击重命名作品"
            >
              {story?.title || '未命名作品'}
            </button>
          )}
        </div>

        <nav className="flex-1 flex items-center justify-center gap-1">
          {(['世界观', '目录编辑', '大纲', '人物角色'] as const).map((label, idx) => {
            const key: EditorView = ['info', 'directory', 'outline', 'character'][idx] as EditorView;
            const icons = ['🌍', '📑', '📝', '🎭'];
            const active = view === key;
            return (
              <button
                key={label}
                onClick={() => {
                  setView(key);
                }}
                className="relative px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span className="mr-1">{icons[idx]}</span>
                {label}
                {active && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-1.5">
          <span
            className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--accent)' }}
            />
            {sectionWordCount.toLocaleString()} 字
          </span>
          
        </div>
      </header>

      {/* 主体：根据 view 切换不同内容 */}
      {view === 'info' && <WorldSettingPanel />}
      {view === 'character' && <CharacterPanel richTextEditorCommandsRef={richTextEditorCommandsRef} />}

      {view === 'directory' && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: leftSidebarWidth }}>
            <DirectoryTree
              volumes={volumes}
              chapters={chapters}
              sections={sections}
              activeChapterId={activeChapterId}
              activeSectionId={activeSectionId}
              sectionStats={sectionStats}
              expandedVolumeIds={expandedVolumeIds}
              expandedChapterIds={expandedChapterIds}
              onSelectChapter={setActiveChapter}
              onSelectSection={setActiveSection}
              onCreateVolume={() => {
                if (activeStoryId) {
                  const volCount = volumes.length + 1;
                  createVolume(activeStoryId, `第${volCount}卷`);
                }
              }}
              onCreateChapter={(volumeId) => {
                if (activeStoryId) {
                  createChapter(activeStoryId, `第${chapters.length + 1}章`, volumeId);
                }
              }}
              onCreateSection={(chapterId) => {
                const chapterSections = sections.filter((s) => s.chapter_id === chapterId);
                createSection(chapterId, `第${chapterSections.length + 1}节`);
              }}
              onRenameVolume={renameVolume}
              onRenameChapter={renameChapter}
              onRenameSection={renameSection}
              onDeleteVolume={deleteVolume}
              onDeleteChapter={deleteChapter}
              onDeleteSection={deleteSection}
              onToggleVolume={toggleVolume}
              onToggleChapter={toggleChapter}
              onReorderVolumes={(orderedIds) =>
                activeStoryId && reorderVolumes(orderedIds)
              }
              onReorderChapters={(orderedIds) =>
                activeStoryId && reorderChapters(orderedIds)
              }
              onReorderSections={reorderSections}
              onSyncToOutline={handleOpenSyncDialog}
            />
          </div>

          <ResizeHandle
            side="left"
            onResize={(delta) => setLeftSidebarWidth((w) => Math.min(400, Math.max(160, w + delta)))}
          />

          <main
            className="flex-1 flex flex-col overflow-hidden"
            style={{ borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', minHeight: 0 }}
          >
            {section ? (
              <RichTextEditor
                content={sectionContent ?? ''}
                onChangeContent={setSectionContent}
                onInsertDiceRequest={() => diceStore.openDialog()}
                onDiceRolled={(payload) => {
                  const rec = buildDiceHistoryRecord({
                    payload,
                    sectionId: section.id,
                    sectionTitle: section.title,
                  });
                  if (rec) useDiceHistoryStore.getState().addRecord(rec);
                }}
                onImageSelected={(info) => setSelectedImage(info)}
                commandsRef={richTextEditorCommandsRef}
                editable={true}
                onShowToast={(msg) => setToast(msg)}
              />
            ) : (
              <div
                className="flex-1 flex items-center justify-center text-xs"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
              >
                请在左侧选择一个节开始编辑
              </div>
            )}

            {section && (
              <BottomStatusBar
                onExport={onExport}
                onFlushContent={flushSectionContent}
              />
            )}
          </main>

          <ResizeHandle
            side="right"
            onResize={(delta) => setRightSidebarWidth((w) => Math.min(600, Math.max(200, w + delta)))}
          />

          <RightPanel
            activeTab={rightPanelTab}
            setActiveTab={setRightPanelTab}
            section={section}
            onRenameSection={(t) => section && renameSection(section.id, t)}
            onJumpToDice={(sectionId, payloadSnapshot) => {
              if (sectionId !== activeSectionId) {
                const setActive = useStoryStore.getState().setActiveSection;
                setActive(sectionId);
              }
              // 等下一个 tick，编辑器内容被重新渲染后再滚动
              window.setTimeout(() => {
                richTextEditorCommandsRef.current?.scrollToDiceCard(payloadSnapshot);
              }, 80);
            }}
            selectedImage={selectedImage}
            onSetImageSize={(size) => {
              richTextEditorCommandsRef.current?.setSelectedImageSize(size);
            }}
            richTextEditorCommandsRef={richTextEditorCommandsRef}
            onShowToast={(msg) => setToast(msg)}
            width={rightSidebarWidth}
          />
        </div>
      )}

      {view === 'outline' && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <OutlineTree
            onJumpToChapter={(chapterId) => {
              setActiveChapter(chapterId);
              setView('directory');
            }}
          />
          <main
            className="flex-1 flex flex-col overflow-hidden"
            style={{ borderLeft: '1px solid var(--border-color)', background: 'var(--bg-page)', minHeight: 0 }}
          >
            <div
              className="shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
            >
              <button
                onClick={() => handleOpenSyncDialog('outline')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                📋 同步大纲到目录
              </button>
              <button
                onClick={() => handleOpenSyncDialog('directory')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                📋 同步目录到大纲
              </button>
            </div>
            <OutlineEditor />
          </main>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div
          className="absolute left-1/2 top-6 z-50 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-xs font-medium"
          style={{ background: 'var(--text-primary)', color: 'var(--bg-card)' }}
        >
          {toast}
        </div>
      )}

      {/* 骰子配置弹窗 */}
      <DiceConfigDialog
        onSaveNew={(payload) => {
          richTextEditorCommandsRef.current?.insertDice(payload as DiceBlockPayloadV2);
        }}
      />

      {/* 同步对话框（支持大纲→目录 和 目录→大纲 两个方向） */}
      <SyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        source={syncDialogSource}
        volumeDiffs={volumeDiffs}
        chapterDiffs={chapterDiffs}
        onConfirm={handleApplySync}
      />
    </div>
  );
}

// ========== 右侧栏：属性 / 世界观 / 人物 / 骰点记录 四 Tab 切换 ==========

function RightPanel({
  activeTab,
  setActiveTab,
  section,
  onRenameSection,
  onJumpToDice,
  selectedImage,
  onSetImageSize,
  richTextEditorCommandsRef,
  onShowToast,
  width,
}: {
  activeTab: 'properties' | 'world' | 'character' | 'dice' | 'relation';
  setActiveTab: (tab: 'properties' | 'world' | 'character' | 'dice' | 'relation') => void;
  section: Section | undefined;
  onRenameSection: (newTitle: string) => void;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
  selectedImage: { width: number; height: number; src?: string; dataSize?: string } | null;
  onSetImageSize: (size: string) => void;
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  width?: number;
}) {
  const [imageSizeNga, setImageSizeNga] = useState<string>('original');
  const [imageUrl, setImageUrl] = useState<string>('');
  const activeStoryId = useStoryStore((s) => s.activeStoryId);

  // 当选中图片变化时，同步输入框的值
  useEffect(() => {
    if (selectedImage) {
      setImageSizeNga(selectedImage.dataSize || 'original');
      setImageUrl(selectedImage.src || '');
    }
  }, [selectedImage?.dataSize, selectedImage?.src]);
  const tabs: {
    key: 'properties' | 'world' | 'character' | 'dice' | 'relation';
    label: string;
  }[] = [
    { key: 'properties', label: '⚙️属性' },
    { key: 'world', label: '🌏世界观' },
    { key: 'character', label: '👤人物' },
    { key: 'relation', label: '🔗关系' },
    { key: 'dice', label: '🎲骰点' },
  ];

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{ width: width ?? 384, background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)' }}
    >
      {/* Tab 头部 */}
      <div className="shrink-0 flex items-stretch border-b" style={{ borderColor: 'var(--border-color)' }}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-1 flex items-center justify-center px-2 py-2 text-xs font-medium transition-colors"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'properties' && (
          <div className="p-4 space-y-4">
            {section ? (
              <>
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>节标题</div>
                  <input
                    defaultValue={section.title}
                    onBlur={(e) => onRenameSection(e.target.value.trim() || section.title)}
                    className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  创建: {section.created_at?.slice(0, 10) || '-'}
                  <br />
                  更新: {section.updated_at?.slice(0, 10) || '-'}
                </div>
              </>
            ) : (
              <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                选择一节开始编辑
              </div>
            )}

            {/* 选中图片时显示尺寸编辑区 */}
            {selectedImage && (
              <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-[11px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  🖼️ 图片属性
                </div>
                {/* NGA 尺寸选择 */}
                <div className="mb-3">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    尺寸预设（点击切换）
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {NGA_IMAGE_SIZES.map((s) => {
                      const active = imageSizeNga === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => {
                            setImageSizeNga(s.value);
                            onSetImageSize(s.value);
                          }}
                          className="text-[10px] px-2 py-1.5 rounded-md transition-colors"
                          style={{
                            background: active ? 'var(--accent-bg)' : 'var(--bg-hover)',
                            color: active ? 'var(--accent)' : 'var(--text-primary)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* URL */}
                <div className="mb-2">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    图片 URL
                  </div>
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onBlur={() => {
                      if (imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    className="w-full px-2 py-1.5 text-xs rounded-md border outline-none transition-colors"
                    style={{
                      borderColor: 'var(--border-color)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder="图片链接地址"
                  />
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  提示：点击上方尺寸预设调整大小，导出时会拼接到图片 URL 后缀。
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === 'world' && <CompactWorldSettingPanel onShowToast={onShowToast} />}
        {activeTab === 'character' && (
          <CompactCharacterPanel
            richTextEditorCommandsRef={richTextEditorCommandsRef}
            onShowToast={onShowToast}
          />
        )}
        {activeTab === 'relation' && activeStoryId && (
          <RelationshipPanel storyId={activeStoryId} />
        )}
        {activeTab === 'dice' && <DiceHistoryPanel onJumpToDice={onJumpToDice} />}
      </div>
    </aside>
  );
}

// ========== 骰点历史记录面板 ==========

function DiceHistoryPanel({
  onJumpToDice,
}: {
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
}) {
  const records = useDiceHistoryStore((s) => s.records);
  const clearAll = useDiceHistoryStore((s) => s.clearAll);

  const formatTime = (ts: number): string => {
    try {
      const d = new Date(ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours(),
      )}:${pad(d.getMinutes())}`;
    } catch {
      return String(ts);
    }
  };

  return (
    <div className="p-3 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          骰点历史 <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>共 {records.length} 条</span>
        </div>
        {records.length > 0 && (
          <button
            onClick={() => {
              if (confirm('确定清空全部骰点记录？')) clearAll();
            }}
            className="text-[10px] px-2 py-1 rounded-md border transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'var(--danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            清空
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs py-16" style={{ color: 'var(--text-secondary)' }}>
          还没有骰点记录，去正文编辑器掷一次骰子试试。
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {records.map((r) => (
            <div
              key={r.id}
              className="p-3 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
            >
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                {formatTime(r.timestamp)}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {r.diceName}
                </div>
                <div
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {r.diceType}
                </div>
              </div>
              <div className="text-xs font-mono mb-1" style={{ color: 'var(--accent)' }}>
                结果: {r.result}
              </div>
              {r.resultDetail && r.resultDetail !== r.result && (
                <div className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {r.resultDetail}
                </div>
              )}
              <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
                <div className="text-[10px] truncate flex-1 pr-2" style={{ color: 'var(--text-secondary)' }}>
                  → {r.sectionTitle || '(未命名节)'}
                </div>
                <button
                  onClick={() => onJumpToDice(r.sectionId, r.payloadSnapshot)}
                  className="text-[10px] px-2 py-1 rounded-md font-medium shrink-0"
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                >
                  跳转
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== 紧凑型世界观设定面板 ==========

function CompactWorldSettingPanel({
  onShowToast,
}: {
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const worldSettings = useMetaStore((s) => s.worldSettings);
  const editingWorldId = useMetaStore((s) => s.editingWorldId);
  const createWorldSetting = useMetaStore((s) => s.createWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const editing = worldSettings.find((w) => w.id === editingWorldId) ?? null;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* 顶部工具条 */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>世界观设定</div>
        <button
          onClick={() => activeStoryId && createWorldSetting(activeStoryId)}
          disabled={!activeStoryId}
          className="text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          + 新建
        </button>
      </div>

      {/* 条目列表 */}
      <div className="shrink-0 p-2 border-b max-h-40 overflow-y-auto space-y-1" style={{ borderColor: 'var(--border-color)' }}>
        {!activeStoryId && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>请先选择一个故事</div>
        )}
        {activeStoryId && worldSettings.length === 0 && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无条目，点击上方"新建"
          </div>
        )}
        {activeStoryId && worldSettings.length > 0 && (
          <div className="space-y-1">
            {worldSettings.map((ws) => {
              const isActive = ws.id === editingWorldId;
              return (
                <button
                  key={ws.id}
                  onClick={() => setEditingWorldId(isActive ? null : ws.id)}
                  className="w-full text-left px-2 py-1.5 text-xs rounded transition-colors border"
                  style={{
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                    borderColor: isActive ? 'var(--accent)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div className="font-medium truncate">{ws.title || '未命名'}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                    {(ws.content || '').slice(0, 50)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <WorldSettingEditorInline setting={editing} onShowToast={onShowToast} />
        ) : (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3 opacity-40">📜</div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>选择或新建一个世界观条目</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>点击上方列表中的条目进行编辑</div>
          </div>
        )}
      </div>
    </div>
  );
}

// 简易内嵌版世界观编辑器（文本标题 + 富文本内容）
function WorldSettingEditorInline({ setting, onShowToast }: { setting: WorldSetting; onShowToast?: (msg: string) => void }) {
  const updateWorldSetting = useMetaStore((s) => s.updateWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const [title, setTitle] = useState(setting.title || '');
  const [content, setContent] = useState(setting.content || '');

  useEffect(() => {
    setTitle(setting.title || '');
    setContent(setting.content || '');
  }, [setting.id]);

  const handleSave = () => {
    updateWorldSetting(setting.id, { title, content });
  };

  const handleDelete = () => {
    if (window.confirm(`删除"${title || '未命名'}"？`)) {
      deleteWorldSetting(setting.id);
      setEditingWorldId(null);
    }
  };

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--bg-card)' }}>
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          placeholder="例如：主要角色设定"
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          rows={12}
          className="w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          placeholder="在此编辑世界观设定..."
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => {
            const tplName = (title || '未命名世界观模板').trim();
            handleSave();
            useMetaStore.getState().createWorldSettingTemplate({
              title: tplName,
              content,
            });
          }}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
          title="把当前世界观设定保存为模板"
        >
          存为模板
        </button>
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          删除条目
        </button>
      </div>
    </div>
  );
}

// ========== 紧凑型人物角色面板 ==========

function CompactCharacterPanel({
  richTextEditorCommandsRef,
  onShowToast,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const editingCharacterId = useMetaStore((s) => s.editingCharacterId);
  const createCharacter = useMetaStore((s) => s.createCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);

  const editing = characters.find((c) => c.id === editingCharacterId) ?? null;

  const handleInsertVariant = (variantName: string, url: string) => {
    if (!richTextEditorCommandsRef.current) {
      onShowToast?.('没有可用的编辑器');
      return;
    }
    richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
    onShowToast?.(`已插入差分：${variantName}`);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* 顶部工具条 */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>人物角色</div>
        <button
          onClick={() => activeStoryId && createCharacter(activeStoryId)}
          disabled={!activeStoryId}
          className="text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          + 新建角色
        </button>
      </div>

      {/* 角色卡片列表 */}
      <div 
        className="shrink-0 p-2 border-b max-h-48 overflow-y-auto"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {!activeStoryId && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>请先选择一个故事</div>
        )}
        {activeStoryId && characters.length === 0 && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无角色，点击上方"新建"
          </div>
        )}
        {activeStoryId && characters.length > 0 && (
          <div className="space-y-1">
            {characters.map((ch) => {
              const isActive = ch.id === editingCharacterId;
              const variants = ch.variants || [];
              return (
                <div
                  key={ch.id}
                  className="rounded transition-colors border"
                  style={{
                    background: isActive ? 'var(--accent-bg)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                    borderColor: isActive ? 'var(--accent)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <button
                    onClick={() => setEditingCharacter(isActive ? null : ch.id)}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5"
                  >
                    {ch.avatar ? (
                      <img
                        src={ch.avatar}
                        alt={ch.name}
                        className="w-7 h-7 rounded-md shrink-0 object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-xs"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        🧑
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{ch.name || '未命名'}</div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {(ch.personality || '暂无角色描述').slice(0, 30)}
                        {variants.length > 0 && ` · 差分 ${variants.length}`}
                      </div>
                    </div>
                  </button>
                  {/* 差分缩略图条 */}
                  {variants.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                      {variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => handleInsertVariant(v.name, v.url)}
                          className="w-7 h-7 rounded border overflow-hidden shrink-0 transition"
                          style={{ borderColor: 'var(--border-color)' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.outline = '2px solid var(--accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.outline = '';
                          }}
                          title={`点击插入差分：${v.name}`}
                        >
                          <img
                            src={v.url}
                            alt={v.name}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <CharacterEditorInline character={editing} onShowToast={onShowToast} richTextEditorCommandsRef={richTextEditorCommandsRef} />
        ) : (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3 opacity-40">🧑‍🎨</div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>选择或新建一个角色</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>点击上方列表中的角色进行编辑</div>
          </div>
        )}
      </div>
    </div>
  );
}

// 简易内嵌版角色编辑器
function CharacterEditorInline({
  character,
  onShowToast,
  richTextEditorCommandsRef,
}: {
  character: {
    id: string;
    name: string;
    personality?: string;
    notes?: string;
    avatar?: string;
    variants?: { id: string; name: string; url: string; order_index: number }[];
    attributes?: Record<string, string | number>;
  };
  onShowToast?: (msg: string) => void;
  richTextEditorCommandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
}) {
  const updateCharacter = useMetaStore((s) => s.updateCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const addVariant = useMetaStore((s) => s.addCharacterVariant);
  const updateVariant = useMetaStore((s) => s.updateCharacterVariant);
  const deleteVariant = useMetaStore((s) => s.deleteCharacterVariant);
  const reorderVariants = useMetaStore((s) => s.reorderCharacterVariants);

  // 属性相关状态
  const [attributes, setAttributes] = useState<Record<string, string | number>>(character.attributes || {});

  const updateAttributes = (next: Record<string, string | number>) => {
    setAttributes(next);
    updateCharacter(character.id, { attributes: next });
  };

  const [name, setName] = useState(character.name || '');
  const [personality, setPersonality] = useState(character.personality || '');
  const [notes, setNotes] = useState(character.notes || '');
  const [avatar, setAvatar] = useState(character.avatar || '');
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const variantFileRef = useRef<HTMLInputElement | null>(null);

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');

  useEffect(() => {
    setName(character.name || '');
    setPersonality(character.personality || '');
    setNotes(character.notes || '');
    setAvatar(character.avatar || '');
  }, [character.id]);

  const handleSave = () => {
    updateCharacter(character.id, { name, personality, notes, avatar });
  };

  const handleDelete = () => {
    if (window.confirm(`删除角色"${name || '未命名'}"？`)) {
      deleteCharacter(character.id);
      setEditingCharacter(null);
    }
  };

  const handleAvatarFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      // 尝试保存到本地文件系统（Electron 环境），避免 base64 超长
      if (window.electronAPI?.saveImage) {
        const savedPath = await window.electronAPI.saveImage(dataUrl);
        setAvatar(savedPath || dataUrl);
        updateCharacter(character.id, { avatar: savedPath || dataUrl });
      } else {
        setAvatar(dataUrl);
        updateCharacter(character.id, { avatar: dataUrl });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVariantFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      // 尝试保存到本地文件系统（Electron 环境），避免 base64 超长
      if (window.electronAPI?.saveImage) {
        const savedPath = await window.electronAPI.saveImage(dataUrl);
        setNewVariantUrl(savedPath || dataUrl);
      } else {
        setNewVariantUrl(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${(character.variants || []).length + 1}`;
    addVariant(character.id, { name: vname, url });
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const moveVariant = (id: string, dir: -1 | 1) => {
    const list = [...(character.variants || [])];
    const i = list.findIndex((v) => v.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    reorderVariants(character.id, list.map((v) => v.id));
  };

  const inputStyle = { 
    background: 'var(--bg-input)', 
    borderColor: 'var(--border-color)', 
    color: 'var(--text-primary)' 
  } as React.CSSProperties;
  const labelColor = 'var(--text-secondary)';

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--bg-card)' }}>
      {/* 头像 */}
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-16 h-16 rounded-lg flex items-center justify-center text-2xl cursor-pointer overflow-hidden border"
          style={{ background: 'var(--bg-page)', borderColor: 'var(--border-color)' }}
          onClick={() => avatarFileRef.current?.click()}
          title="点击更换头像"
        >
          {avatar ? (
            <img 
              src={avatar} 
              alt={name} 
              className="w-full h-full object-cover" 
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>🧑</span>
          )}
        </div>
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAvatarFile(file);
            e.target.value = '';
          }}
        />
        <div className="flex-1 space-y-2">
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSave}
              className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
              style={{ ...inputStyle, outline: 'none' }}
              placeholder="角色姓名"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>性格/特征</label>
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              onBlur={handleSave}
              className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
              style={inputStyle}
              placeholder="例如：开朗、冷静、勇敢"
            />
          </div>
        </div>
      </div>

      {/* 描述 */}
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>备注/详情</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleSave}
          rows={4}
          className="w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed"
          style={inputStyle}
          placeholder="背景、外貌、技能等详细描述..."
        />
      </div>

      {/* 属性展示（可编辑） */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-medium" style={{ color: labelColor }}>角色属性</label>
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: labelColor }}>
              {Object.keys(attributes || {}).length} 项
            </span>
            <button
              onClick={() => {
                const key = prompt('输入新属性名：');
                if (!key?.trim()) return;
                const k = key.trim();
                if (attributes[k] !== undefined) {
                  onShowToast?.(`属性"${k}"已存在`);
                  return;
                }
                updateAttributes({ ...attributes, [k]: '' });
              }}
              className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
              title="添加新属性"
            >
              + 添加
            </button>
          </div>
        </div>
        {Object.keys(attributes || {}).length === 0 ? (
          <div className="text-[10px] italic text-center py-2" style={{ color: labelColor }}>暂无属性，点击上方添加</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(attributes || {}).map(([key, value]) => {
              const [editingVal, setEditingVal] = useState(String(value));
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1 rounded border"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="text-[10px] font-medium w-16 shrink-0 truncate" style={{ color: 'var(--text-primary)' }}>
                    {key}
                  </span>
                  <input
                    value={editingVal}
                    onChange={(e) => setEditingVal(e.target.value)}
                    onBlur={() => {
                      updateAttributes({ ...attributes, [key]: editingVal });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateAttributes({ ...attributes, [key]: editingVal });
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="flex-1 text-[10px] px-1.5 py-0.5 rounded border outline-none"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    onClick={() => {
                      const next = { ...attributes };
                      delete next[key];
                      updateAttributes(next);
                    }}
                    className="text-[10px] px-1 transition-colors"
                    style={{ color: 'var(--danger)' }}
                    title="删除此属性"
                  >x</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 差分管理 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-medium" style={{ color: labelColor }}>
            人物差分（表情/姿势/服饰等图片变体）
          </label>
          <span className="text-[10px]" style={{ color: labelColor }}>
            {(character.variants || []).length} 个
          </span>
        </div>

        {(character.variants || []).length === 0 && (
          <div className="text-[10px] italic text-center py-1 mb-1" style={{ color: labelColor }}>
            暂无差分
          </div>
        )}

        <div className="space-y-1 mb-2">
          {(character.variants || []).map((v, idx) => (
            <div
              key={v.id}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded border"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <img
                src={v.url}
                alt={v.name}
                className="w-8 h-8 rounded object-cover shrink-0"
                style={{ background: 'var(--bg-input)' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              <input
                value={v.name}
                onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                placeholder="差分名称"
                className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
                style={inputStyle}
              />
              <input
                value={v.url}
                onChange={(e) => updateVariant(v.id, { url: e.target.value })}
                placeholder="图片 URL"
                className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
                style={inputStyle}
              />
              <button
                onClick={() => moveVariant(v.id, -1)}
                disabled={idx === 0}
                className="text-[10px] px-1 py-0.5 rounded border disabled:opacity-30"
                style={{ 
                  background: 'var(--bg-base)', 
                  color: 'var(--text-secondary)', 
                  borderColor: 'var(--border-color)' 
                }}
                title="上移"
              >
                ↑
              </button>
              <button
                onClick={() => moveVariant(v.id, 1)}
                disabled={idx === (character.variants || []).length - 1}
                className="text-[10px] px-1 py-0.5 rounded border disabled:opacity-30"
                style={{ 
                  background: 'var(--bg-base)', 
                  color: 'var(--text-secondary)', 
                  borderColor: 'var(--border-color)' 
                }}
                title="下移"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  if (richTextEditorCommandsRef?.current) {
                    richTextEditorCommandsRef.current.insertImage(v.url, NGA_DEFAULT_IMAGE_SIZE);
                    onShowToast?.(`已插入差分：${v.name}`);
                  }
                }}
                disabled={!richTextEditorCommandsRef?.current}
                className="text-[10px] px-1 py-0.5 rounded border transition-colors disabled:opacity-30"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                title="插入到编辑器"
              >
                插入
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`删除差分"${v.name}"？`)) deleteVariant(v.id);
                }}
                className="text-[10px] px-1 py-0.5 rounded"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={newVariantName}
            onChange={(e) => setNewVariantName(e.target.value)}
            placeholder="差分名称（可空）"
            className="w-28 px-1.5 py-1 text-[10px] rounded border outline-none"
            style={inputStyle}
          />
          <input
            value={newVariantUrl}
            onChange={(e) => setNewVariantUrl(e.target.value)}
            placeholder="图片 URL 或上传"
            className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
            style={inputStyle}
          />
          <button
            onClick={() => variantFileRef.current?.click()}
            className="text-[10px] px-1.5 py-1 rounded border"
            style={{ 
              background: 'var(--bg-sidebar)', 
              color: 'var(--text-primary)', 
              borderColor: 'var(--border-color)' 
            }}
            title="上传"
          >
            📁
          </button>
          <input
            ref={variantFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVariantFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={handleAddVariant}
            disabled={!newVariantUrl.trim()}
            className="text-[10px] px-2 py-1 rounded disabled:opacity-40"
            style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--danger)';
            e.currentTarget.style.color = 'var(--text-on-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--danger-soft)';
            e.currentTarget.style.color = 'var(--danger)';
          }}
        >
          🗑 删除角色
        </button>
        <button
          onClick={handleSave}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
            e.currentTarget.style.color = 'var(--text-on-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent-bg)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
        >
          ✓ 保存
        </button>
      </div>
    </div>
  );
}

interface BottomStatusBarProps {
  onExport: () => void;
  onFlushContent?: () => void;
}

function BottomStatusBar({
  onExport,
  onFlushContent,
}: BottomStatusBarProps) {

  return (
    <footer
      className="shrink-0 flex items-center justify-between px-4 py-2 text-xs"
      style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onExport}
          className="px-3 py-1.5 rounded-lg shadow-sm transition-opacity flex items-center gap-1.5 font-medium"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          🗂 导出为 NGA 代码
        </button>
        {onFlushContent && (
          <button
            onClick={onFlushContent}
            className="px-3 py-1.5 rounded-lg transition-colors font-medium"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            title="立即将当前节的内容写入数据库"
          >
            💾 保存当前节
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span
          className="flex items-center gap-1.5 px-2 py-1 rounded-md"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
          富文本模式
        </span>
      </div>
    </footer>
  );
}
