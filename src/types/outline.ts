// ============================================================
// Outline 大纲辅助函数
//
// - parseOutlineContent: content 字符串 → OutlinePayload（容错）
// - stringifyOutlinePayload: OutlinePayload → content 字符串
// - parseOutlineBody: body 文本 → 带语义的行列表（用于高亮渲染）
// ============================================================

import type { OutlinePayload, OutlineTargetType } from './character-world-outline'

/** 解析 outline.content → OutlinePayload（容错处理：老的纯文本也兼容） */
export function parseOutlineContent(content: string | null | undefined): OutlinePayload {
  if (!content) {
    return {
      title: '未命名大纲',
      target_type: 'volume',
      parent_outline_id: null,
      target_id: '',
      body: '',
    };
  }
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === 'object') {
      let tt: OutlineTargetType;
      if (obj.target_type === 'chapter') {
        tt = 'chapter';
      } else {
        tt = 'volume';
      }
      return {
        title: String(obj.title || '未命名大纲'),
        target_type: tt,
        parent_outline_id: obj.parent_outline_id ? String(obj.parent_outline_id) : null,
        target_id: String(obj.target_id || ''),
        body: String(obj.body || ''),
      };
    }
  } catch {
    // 老的纯文本 content：直接作为 body
  }
  return {
    title: '大纲',
    target_type: 'volume',
    parent_outline_id: null,
    target_id: '',
    body: content,
  };
}

/** OutlinePayload → JSON 字符串（用于写回数据库） */
export function stringifyOutlinePayload(p: OutlinePayload): string {
  return JSON.stringify({
    title: p.title,
    target_type: p.target_type,
    parent_outline_id: p.parent_outline_id,
    target_id: p.target_id,
    body: p.body,
  });
}

/** 大纲文本行的类型（用于渲染/高亮） */
export type OutlineLineKind = 'heading' | 'star' | 'list' | 'tag' | 'text';

export interface OutlineLine {
  kind: OutlineLineKind;
  indent: number;
  text: string;
  raw: string;
}

/** 解析大纲 body → 带语义的行列表，用于编辑区渲染与预览 */
export function parseOutlineBody(body: string): OutlineLine[] {
  const lines = body.split(/\r?\n/);
  const result: OutlineLine[] = [];
  for (const line of lines) {
    let indent = 0;
    let rest = line;
    const m = line.match(/^(\s*)(.*)$/);
    if (m) {
      // 每个 Tab 或 2 空格算一级缩进
      const ws = m[1];
      let level = 0;
      let i = 0;
      while (i < ws.length) {
        if (ws[i] === '\t') {
          level++;
          i++;
        } else if (ws[i] === ' ' && ws[i + 1] === ' ') {
          level++;
          i += 2;
        } else {
          i++;
        }
      }
      indent = level;
      rest = m[2];
    }
    let kind: OutlineLineKind = 'text';
    if (/^(#{1,6})\s+/.test(rest)) {
      kind = 'heading';
    } else if (/^[★★*]/.test(rest) && !/^[*-]\s+/.test(rest)) {
      // ★ 星标行（不要与 * list 冲突）
      kind = 'star';
    } else if (/^[*-]\s+/.test(rest)) {
      kind = 'list';
    } else if (/^\[\w+\]/.test(rest)) {
      kind = 'tag';
    }
    result.push({ kind, indent, text: rest, raw: line });
  }
  return result;
}
