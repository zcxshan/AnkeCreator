// ============================================================
// useSectionEditor —— 节切换时自动保存 / 加载 编辑器内容
//
// 使用场景：EditorPage 中，当左侧目录选中的节 (activeSectionId)
// 变化时，需要：
//   1) 把当前正在编辑的节的内存 content 写回数据库（flush 防抖保存）
//   2) 从数据库加载新节的内容填入 editorStore
//
// 本 hook 集中封装该逻辑，并提供：
//   - sectionId 变化时的自动保存 + 自动加载
//   - 页面离开 / 组件卸载 时的 flush 保存
//   - 外部手动 flush 保存按钮
// ============================================================

import { useEffect, useRef } from 'react';
import { useEditorStore, flushDebouncedSave } from '../store/editorStore';
import * as db from '../db/index';

export interface UseSectionEditorResult {
  flushContent: () => void;
  currentSectionId: string | null;
}

export function useSectionEditor(activeSectionId: string | null): UseSectionEditorResult {
  const loadSection = useEditorStore((s) => s.loadSection);
  const flushSectionContent = useEditorStore((s) => s.flushSectionContent);
  const sectionId = useEditorStore((s) => s.sectionId);

  // 上一次触发切换的 activeSectionId, 用于避免重复触发
  const lastSectionIdRef = useRef<string | null>(null);

  // ---- 1) 节切换时：保存旧节 + 加载新节 ----
  // 监听 activeSectionId 变化, 先 flush 防抖保存, 再调用 loadSection 完成旧→新切换
  useEffect(() => {
    // 同一个节无需切换
    if (activeSectionId === lastSectionIdRef.current) return;

    // 切换前：主动把挂起的防抖保存 flush 到数据库
    flushDebouncedSave();

    // 再把当前节的内存内容写回数据库（兜底）
    const cur = useEditorStore.getState();
    if (cur.sectionId && cur.sectionContent != null) {
      db.setSectionContent(cur.sectionId, cur.sectionContent).catch(() => {});
    }

    // 加载新节到 editorStore
    loadSection(activeSectionId);
    lastSectionIdRef.current = activeSectionId;
  }, [activeSectionId, loadSection]);

  // ---- 2) 页面离开 / 关闭 / 刷新 时：flush 保存 ----
  useEffect(() => {
    const handler = () => {
      flushDebouncedSave();
      const cur = useEditorStore.getState();
      if (cur.sectionId && cur.sectionContent != null) {
        db.setSectionContent(cur.sectionId, cur.sectionContent).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ---- 3) 组件卸载时：flush 最后一次保存 ----
  useEffect(() => {
    return () => {
      flushDebouncedSave();
      const cur = useEditorStore.getState();
      if (cur.sectionId && cur.sectionContent != null) {
        db.setSectionContent(cur.sectionId, cur.sectionContent).catch(() => {});
      }
    };
  }, []);

  return {
    flushContent: flushSectionContent,
    currentSectionId: sectionId,
  };
}
