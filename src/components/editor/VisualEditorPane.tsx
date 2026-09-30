// 可视化编辑器面板：独立订阅 sectionContent / 撤销栈 / 加载态，
// 打字时仅此面板（及 RichTextEditor）重渲染，避免整个 EditorPage 因内容写入而重渲染。
import React, { useCallback } from 'react';
import { useDiceStore } from '../../store/diceStore';
import { useEditorStore } from '../../store/editorStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { RichTextEditor, type RichTextEditorCommands } from './RichTextEditor';
import type { DiceBlockPayloadV2 } from '../../types';

interface VisualEditorPaneProps {
  commandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  editorRef: React.MutableRefObject<HTMLDivElement | null>;
  onDiceRolled: (payload: DiceBlockPayloadV2) => void;
  onEditDiceBlock: (blockId: string, payload: DiceBlockPayloadV2) => void;
  onImageSelected: (info: { width: number; height: number; src?: string; dataSize?: string } | null) => void;
  onShowToast: (msg: string) => void;
  onSearchOpen: () => void;
}

export const VisualEditorPane = React.memo(function VisualEditorPane({
  commandsRef,
  editorRef,
  onDiceRolled,
  onEditDiceBlock,
  onImageSelected,
  onShowToast,
  onSearchOpen,
}: VisualEditorPaneProps) {
  const content = useEditorStore((s) => s.sectionContent);
  const setSectionContent = useEditorStore((s) => s.setSectionContent);
  const sectionLoading = useEditorStore((s) => s.sectionLoading);
  const canUndo = useEditorHistoryStore((s) => s.canUndo());
  const canRedo = useEditorHistoryStore((s) => s.canRedo());
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
      onShowToast={onShowToast}
      canUndo={canUndo}
      canRedo={canRedo}
      editorRef={editorRef}
      onSearchOpen={onSearchOpen}
    />
  );
});
