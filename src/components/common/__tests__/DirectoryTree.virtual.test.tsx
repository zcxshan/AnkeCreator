// ============================================================
// VirtualSectionRow 跨章混排 bug 修复验证
//
// 修复根因：旧版 VirtualSectionRow 用 data.sections[index]（全局 sections 数组）
// 按章内 index 取节。当章内节数 > VIRTUALIZE_THRESHOLD(20) 触发虚拟滚动时，
// 会取到全局数组前 N 项（可能属于其他章），造成跨章混排。
//
// 新版 VirtualSectionRow 改用 data.chapterSections[index]（章内过滤+排序后的节），
// 确保虚拟列表只渲染当前章的节。
//
// 本测试验证：构造 25 节属于 ch-A + 5 节属于 ch-B（共 30 节，超过阈值 20），
// 展开 ch-A 时只应看到 A 节，不应出现任何 B 节。
// ============================================================

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { DirectoryTree } from '../DirectoryTree';
import type { Volume, Chapter, SectionMeta } from '../../../types';

// 构造 25 节属于 chapter-A，5 节属于 chapter-B（共 30 节，超过 VIRTUALIZE_THRESHOLD=20）
// 全局数组顺序：B 节在前（index 0-4），A 节在后（index 5-29）
// 旧版 bug 会用全局 index 0-24 渲染 ch-A，把 B 节也显示出来
function makeSections(): SectionMeta[] {
  const secs: SectionMeta[] = [];
  // B 节放前面（验证全局数组顺序不影响章内渲染）
  for (let i = 0; i < 5; i++) {
    secs.push({
      id: `B-${i}`,
      title: `B节${i}`,
      chapter_id: 'ch-B',
      order_index: i,
      word_count: 0,
      created_at: '',
      updated_at: '',
    } as SectionMeta);
  }
  for (let i = 0; i < 25; i++) {
    secs.push({
      id: `A-${i}`,
      title: `A节${i}`,
      chapter_id: 'ch-A',
      order_index: i,
      word_count: 0,
      created_at: '',
      updated_at: '',
    } as SectionMeta);
  }
  return secs;
}

describe('VirtualSectionRow uses chapter-specific sections', () => {
  it('章内 > 20 节时仅显示该章的节（不混入其他章）', () => {
    const sections = makeSections();
    const { container } = render(
      <DirectoryTree
        volumes={[{ id: 'v1', story_id: 's1', title: '卷', order_index: 0, created_at: '', updated_at: '' } as Volume]}
        chapters={[
          { id: 'ch-A', story_id: 's1', volume_id: 'v1', title: 'A章', order_index: 0, word_count: 0, created_at: '', updated_at: '' } as Chapter,
          { id: 'ch-B', story_id: 's1', volume_id: 'v1', title: 'B章', order_index: 1, word_count: 0, created_at: '', updated_at: '' } as Chapter,
        ]}
        sections={sections}
        activeChapterId="ch-A"
        activeSectionId={null}
        sectionStats={{}}
        expandedVolumeIds={{ v1: true }}
        expandedChapterIds={{ 'ch-A': true, 'ch-B': false }}
        onSelectChapter={() => {}}
        onSelectSection={() => {}}
        onCreateVolume={() => {}}
        onCreateChapter={() => {}}
        onCreateSection={() => {}}
        onRenameVolume={() => {}}
        onRenameChapter={() => {}}
        onRenameSection={() => {}}
        onDeleteVolume={() => {}}
        onDeleteChapter={() => {}}
        onDeleteSection={() => {}}
        onToggleVolume={() => {}}
        onToggleChapter={() => {}}
        onReorderVolumes={() => {}}
        onReorderChapters={() => {}}
        onReorderSections={() => {}}
        onMoveChapters={() => {}}
        onMoveSections={() => {}}
      />,
    );
    // ch-A 展开（25 节 > 20 触发虚拟滚动），应渲染 A 节，不能出现 B 节
    const text = container.textContent || '';
    const aTexts = text.match(/A节\d+/g) || [];
    const bTexts = text.match(/B节\d+/g) || [];
    // 虚拟列表至少渲染 overscanCount 部分的 A 节
    expect(aTexts.length).toBeGreaterThan(0);
    // 不应出现任何 B 节（ch-B 未展开）
    expect(bTexts.length).toBe(0);
  });

  it('普通章节（<= 20 节）仍正常渲染', () => {
    const sections: SectionMeta[] = [];
    for (let i = 0; i < 10; i++) {
      sections.push({
        id: `small-${i}`,
        title: `小节${i}`,
        chapter_id: 'ch-small',
        order_index: i,
        word_count: 0,
        created_at: '',
        updated_at: '',
      } as SectionMeta);
    }
    const { container } = render(
      <DirectoryTree
        volumes={[{ id: 'v2', story_id: 's1', title: '卷', order_index: 0, created_at: '', updated_at: '' } as Volume]}
        chapters={[
          { id: 'ch-small', story_id: 's1', volume_id: 'v2', title: '小章', order_index: 0, word_count: 0, created_at: '', updated_at: '' } as Chapter,
        ]}
        sections={sections}
        activeChapterId="ch-small"
        activeSectionId={null}
        sectionStats={{}}
        expandedVolumeIds={{ v2: true }}
        expandedChapterIds={{ 'ch-small': true }}
        onSelectChapter={() => {}}
        onSelectSection={() => {}}
        onCreateVolume={() => {}}
        onCreateChapter={() => {}}
        onCreateSection={() => {}}
        onRenameVolume={() => {}}
        onRenameChapter={() => {}}
        onRenameSection={() => {}}
        onDeleteVolume={() => {}}
        onDeleteChapter={() => {}}
        onDeleteSection={() => {}}
        onToggleVolume={() => {}}
        onToggleChapter={() => {}}
        onReorderVolumes={() => {}}
        onReorderChapters={() => {}}
        onReorderSections={() => {}}
        onMoveChapters={() => {}}
        onMoveSections={() => {}}
      />,
    );
    const text = container.textContent || '';
    const smallTexts = text.match(/小节\d+/g) || [];
    expect(smallTexts.length).toBe(10);
  });
});
