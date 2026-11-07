// 可视化编辑器面板：独立订阅 sectionContent / 加载态，
// 打字时仅此面板（及编辑器内核）重渲染，避免整个 EditorPage 因内容写入而重渲染。
// 编辑内核：Tiptap（ProseMirror）—— 撤销/重做以内核 history 为唯一事实来源，
// 不再订阅应用级 editorHistoryStore。
import React, { useCallback } from 'react';
import { useDiceStore } from '../../store/diceStore';
import { useEditorStore } from '../../store/editorStore';
import { TiptapEditorPane as RichTextEditor, type RichTextEditorCommands } from '../../editor/tiptap/TiptapEditorPane';
import type { DiceBlockPayloadV2 } from '../../types';

interface VisualEditorPaneProps {
  commandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  editorRef: React.MutableRefObject<HTMLDivElement | null>;
  onDiceRolled: (payload: DiceBlockPayloadV2) => void;
  onEditDiceBlock: (blockId: string, payload: DiceBlockPayloadV2) => void;
  onImageSelected: (info: { width: number; height: number; src?: string; dataSize?: string } | null) => void;
  onShowToast: (msg: string) => void;
  onSearchOpen: () => void;
  /** 样式工具栏折叠态（由 EditorPage 统一管理，与「导出图片」工具行合并） */
  stylePanelCollapsed?: boolean;
  onToggleStylePanel?: () => void;
}

export const VisualEditorPane = React.memo(function VisualEditorPane({
  commandsRef,
  editorRef,
  onDiceRolled,
  onEditDiceBlock,
  onImageSelected,
  onShowToast,
  onSearchOpen,
  stylePanelCollapsed,
  onToggleStylePanel,
}: VisualEditorPaneProps) {
  const content = useEditorStore((s) => s.sectionContent);
  const setSectionContent = useEditorStore((s) => s.setSectionContent);
  const sectionLoading = useEditorStore((s) => s.sectionLoading);
  const openDiceDialog = useDiceStore((s) => s.openDialog);

  const handleInsertDiceRequest = useCallback(() => openDiceDialog(), [openDiceDialog]);

  return (
    <RichTextEditor
      content={content ?? ''}
      onChangeContent={setSectionContent}
      onInsertDiceRequest={handleInsertDiceRequest}
      onDiceRolled={onDiceRolled}
      onEditDiceBlock={onEditDiceBlock}
      onImageSelected={onImageSelected}
      commandsRef={commandsRef}
      editable={!sectionLoading}
      stylePanelCollapsed={stylePanelCollapsed}
      onToggleStylePanel={onToggleStylePanel}
      onShowToast={onShowToast}
      editorRef={editorRef}
      onSearchOpen={onSearchOpen}
    />
  );
});
