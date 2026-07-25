// ============================================================
// 解析文本生成节目录结构
//
// 用户在高级格式设置的章里点击"解析文本"按钮，输入以下格式文本：
//   节名1：起始楼层1，终止楼层1；节名2：起始楼层2，终止楼层2；节名3：起始楼层3，终止楼层3；
// 或：
//   节名1：起始楼层1；节名2：起始楼层2；节名3：起始楼层3；
//
// 解析规则：
//   1. 用 ; 或 ； 分割成多条节定义（忽略空段）
//   2. 每条节定义用第一个 : 或 ： 分割为"节名"和"楼层部分"
//   3. 楼层部分用 , 或 ， 分割为"起始楼层"和"终止楼层"
//   4. 若某节没有终止楼层：
//      - 非最后一节：终止楼层 = 下一节的起始楼层 - 1
//      - 最后一节：终止楼层 = maxFloor
//   5. 中英文标点都接受
// ============================================================

import type { ManualSectionConfig } from './ankeCollect';

export interface ParseSectionTextResult {
  ok: boolean;
  sections?: ManualSectionConfig[];
  error?: string;
}

/**
 * 把用户输入的文本解析为节结构列表
 *
 * @param text 用户输入的文本
 * @param maxFloor 最后一楼（表单填写的终止楼层），用于最后一节无终止楼层时兜底
 * @returns 解析结果
 */
export function parseSectionText(
  text: string,
  maxFloor: number,
): ParseSectionTextResult {
  if (!text || !text.trim()) {
    return { ok: false, error: '文本为空' };
  }

  // 兜底 maxFloor（未传或非法时用一个大数，避免最后一节 endFloor 为 0）
  const effectiveMaxFloor =
    Number.isFinite(maxFloor) && maxFloor > 0 ? maxFloor : 9999;

  // 1. 用 ; 或 ； 分割成多条节定义（忽略空段）
  //    同时支持中英文分号
  const rawSegments = text.split(/[;；]/).map((s) => s.trim()).filter((s) => s.length > 0);

  if (rawSegments.length === 0) {
    return { ok: false, error: '未解析到任何节定义（请用 ; 或 ； 分隔）' };
  }

  // 2. 解析每条节定义
  //    用第一个 : 或 ： 分割为"节名"和"楼层部分"
  //    节名允许包含除冒号外的任意字符
  interface ParsedSegment {
    title: string;
    startFloor: number;
    endFloor: number | null; // null 表示未指定，后续推导
  }

  const parsed: ParsedSegment[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    // 找到第一个冒号（中英文均可）
    const colonMatch = seg.match(/[:：]/);
    if (!colonMatch || colonMatch.index === undefined) {
      return {
        ok: false,
        error: `第 ${i + 1} 条节定义格式错误：缺少冒号（: 或 ：）分隔节名与楼层： "${seg}"`,
      };
    }

    const title = seg.substring(0, colonMatch.index).trim();
    const floorPart = seg.substring(colonMatch.index + 1).trim();

    if (!title) {
      return {
        ok: false,
        error: `第 ${i + 1} 条节定义的节名为空： "${seg}"`,
      };
    }

    if (!floorPart) {
      return {
        ok: false,
        error: `第 ${i + 1} 条节定义（"${title}"）的楼层部分为空`,
      };
    }

    // 3. 楼层部分用 , 或 ， 分割
    //    支持只有起始楼层，或 起始+终止 两种形式
    const floorParts = floorPart.split(/[,，]/).map((s) => s.trim()).filter((s) => s.length > 0);

    let startFloor: number;
    let endFloor: number | null;

    if (floorParts.length === 1) {
      // 只有起始楼层
      const startStr = floorParts[0];
      startFloor = parseInt(startStr, 10);
      if (!Number.isFinite(startFloor) || startFloor < 0) {
        return {
          ok: false,
          error: `第 ${i + 1} 条节定义（"${title}"）的起始楼层不是有效数字： "${startStr}"`,
        };
      }
      endFloor = null;
    } else if (floorParts.length === 2) {
      // 起始 + 终止
      const startStr = floorParts[0];
      const endStr = floorParts[1];
      startFloor = parseInt(startStr, 10);
      endFloor = parseInt(endStr, 10);
      if (!Number.isFinite(startFloor) || startFloor < 0) {
        return {
          ok: false,
          error: `第 ${i + 1} 条节定义（"${title}"）的起始楼层不是有效数字： "${startStr}"`,
        };
      }
      if (!Number.isFinite(endFloor) || endFloor < 0) {
        return {
          ok: false,
          error: `第 ${i + 1} 条节定义（"${title}"）的终止楼层不是有效数字： "${endStr}"`,
        };
      }
      if (endFloor < startFloor) {
        return {
          ok: false,
          error: `第 ${i + 1} 条节定义（"${title}"）的终止楼层 ${endFloor} 小于起始楼层 ${startFloor}`,
        };
      }
    } else {
      return {
        ok: false,
        error: `第 ${i + 1} 条节定义（"${title}"）的楼层部分有多余内容： "${floorPart}"（应为 起始楼层 或 起始楼层,终止楼层）`,
      };
    }

    parsed.push({ title, startFloor, endFloor });
  }

  // 4. 推导未指定的 endFloor
  //    - 非最后一节：endFloor = 下一节 startFloor - 1
  //    - 最后一节：endFloor = maxFloor
  const sections: ManualSectionConfig[] = parsed.map((p, i) => {
    if (p.endFloor !== null) {
      return {
        title: p.title,
        startFloor: p.startFloor,
        endFloor: p.endFloor,
      };
    }

    // endFloor 未指定，需要推导
    if (i < parsed.length - 1) {
      // 非最后一节：取下一节 startFloor - 1
      const nextStart = parsed[i + 1].startFloor;
      return {
        title: p.title,
        startFloor: p.startFloor,
        endFloor: Math.max(p.startFloor, nextStart - 1),
      };
    }

    // 最后一节：取 maxFloor
    return {
      title: p.title,
      startFloor: p.startFloor,
      endFloor: Math.max(p.startFloor, effectiveMaxFloor),
    };
  });

  // 5. 校验：相邻节的楼号不能重叠
  //    即 sections[i].endFloor < sections[i+1].startFloor
  //    若有重叠，提示但不报错（仅警告，由用户决定）
  //    实际上此处仅做严格校验：endFloor > startFloor 已在上面保证
  for (let i = 0; i < sections.length - 1; i++) {
    const cur = sections[i];
    const next = sections[i + 1];
    if (cur.endFloor >= next.startFloor) {
      return {
        ok: false,
        error: `节"${cur.title}"的终止楼层 ${cur.endFloor} 大于等于下一节"${next.title}"的起始楼层 ${next.startFloor}，存在重叠`,
      };
    }
  }

  return { ok: true, sections };
}
