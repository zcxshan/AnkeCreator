// ============================================================
// 安科作者助手 - 核心 TypeScript 接口定义
// ============================================================

// 所有实体共享的时间戳字段
export interface Entity {
  id: string;           // UUID v4
  created_at: string;   // ISO 8601
  updated_at: string;   // ISO 8601
}

// ------------------------------------------------------------
// 一级实体
// ------------------------------------------------------------

export interface Story extends Entity {
  title: string;
  description?: string;
  category?: string;
  order_index?: number;
  is_starred?: boolean;
  is_pinned?: boolean;
}

export interface WorldSetting extends Entity {
  story_id: string;
  title: string;
  content?: string;     // 富文本或纯文本
  order_index: number;
}

export interface Character extends Entity {
  story_id: string;
  name: string;
  avatar?: string;      // 本地路径或 base64
  personality?: string; // 性格描述
  attributes?: Record<string, string | number>; // { HP: 100, 力量: 18, ... }
  notes?: string;
  order_index: number;
  /** 人物差分（表情/姿势/服饰等图片变体），由 db.listCharacters 顺带填充 */
  variants?: CharacterVariant[];
}

/** 人物差分：一种图片变体（如某个表情、某个姿势、某套服装等）。 */
export interface CharacterVariant extends Entity {
  character_id: string;
  name: string;   // 差分名称
  url: string;    // 差分图片（base64 / 远程 URL / 本地路径）
  order_index: number;
}

/** 人物关系：源角色 + 关系名 + 目标角色。 */
export interface CharacterRelation extends Entity {
  story_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  note?: string;
  order_index: number;
}

// ============================================================
// 模板（独立表，不属于具体作品）
// ============================================================

/** 世界观设定模板。结构与 WorldSetting 相同但无 story_id / order_index */
export interface WorldSettingTemplate extends Entity {
  title: string;
  content?: string;
  is_preset?: number;
}

/** 人物模板。结构与 Character 相同但无 story_id / order_index */
export interface CharacterTemplate extends Entity {
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  variants?: CharacterVariant[];
  is_preset?: number;
}

export type OutlineTargetType = 'volume' | 'chapter';

export interface OutlinePayload {
  title: string;
  target_type: OutlineTargetType;
  /** 大纲侧章归属的卷 outline.id（章必填，卷为 null） */
  parent_outline_id: string | null;
  /** 关联目录侧的 volume.id 或 chapter.id（可为空表示未关联） */
  target_id: string;
  body: string;
}

export interface Outline extends Entity {
  story_id: string;
  content: string;
  order_index: number;
}

export interface Volume extends Entity {
  story_id: string;
  title: string;
  order_index: number;
}

export interface Chapter extends Entity {
  story_id: string;
  volume_id: string | null;
  title: string;
  order_index: number;
}

export interface Section extends Entity {
  chapter_id: string;
  title: string;
  order_index: number;
  /** 新一代富文本：JSON 字符串（TipTap 文档格式）。有此字段时优先使用。
   *  老的 ContentBlock 列表仍然保留以便迁移。 */
  content?: string;
}

// ------------------------------------------------------------
// ContentBlock - 内容块（核心）
// ------------------------------------------------------------

export type ContentBlockType = 'text' | 'image' | 'dice';

export interface ContentBlockBase extends Entity {
  section_id: string;
  type: ContentBlockType;
  order_index: number;
}

// --- 文本块 ---

export type NGA_COLOR =
  | 'red'
  | 'green'
  | 'blue'
  | 'skyblue'
  | 'orange'
  | 'purple'
  | 'yellow'
  | 'pink'
  | 'white'
  | 'black'
  | 'gray'
  | string; // 允许任意颜色名（由导出器原样写出）

export type NGA_FONT =
  | 'simsun'        // 宋体 (Word 默认)
  | 'simhei'          // 黑体
  | 'fangsong'        // 仿宋
  | 'kaiti'           // 楷体
  | 'yahei'           // 微软雅黑
  | 'lisu'            // 隶书
  | 'youyuan'         // 幼圆
  | 'Arial'
  | 'Times New Roman'
  | 'Georgia'
  | 'Consolas'
  | string;

export interface TextStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: NGA_COLOR;
  /** Word 字号（磅值 pt，例如 12 表示小四）。
   * 常用：10.5=五号、12=小四、14=四号、16=三号、18=小二、22=二号
   */
  size?: number;
  font?: NGA_FONT;
}

export interface TextBlockPayload {
  text: string;
  styles?: TextStyles;
}

export interface TextBlock extends ContentBlockBase {
  type: 'text';
  payload: TextBlockPayload;
}

// --- 图片块 ---

export interface ImageBlockPayload {
  src: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface ImageBlock extends ContentBlockBase {
  type: 'image';
  payload: ImageBlockPayload;
}

// --- 骰点块 ---

/** 老版本：与现有数据保持兼容（保留 read 能力） */
export type DiceType = '1d2' | '1d10' | '1d100';

/** 老版本选项结构，保留以兼容既有数据 */
export interface DiceOption {
  id: string;
  range_start: number;
  range_end: number;
  content: string;
}

/** 老版本 payload，保留以兼容既有数据 */
export interface DiceBlockPayload {
  dice_type: DiceType;
  last_roll: number | null;
  options: DiceOption[];
}

// ======= 新一代骰子系统：选项骰子 + 数值骰子 =======

/** 骰子的两种基本类别 */
export type DiceKind = 'option' | 'numeric';

/** 选项骰子中的单个选项（值表达式 + 展开后的值数组） */
export interface DiceOptionValue {
  id: string;
  displayValue: string;
  values: number[];
  content: string;
}

/** 骰子完整配置，统一描述选项骰子与数值骰子 */
export interface DiceConfig {
  id: string;
  kind: DiceKind;
  name: string;
  // 选项骰子
  faces?: number;
  options?: DiceOptionValue[];
  // 数值骰子
  count?: number;
  numericFaces?: number;
  modifier?: number;
  // 数值骰子表达式模式（如 "2*3d100+1d10-5"）
  expression?: string;
}

/** 投掷结果 */
export interface DiceResult {
  configId?: string;
  kind?: DiceKind;
  rolls: number[];
  total: number;
  modifier: number;
  displayText?: string;
  hitOptionId?: string | null;
  hitOptionContent?: string | null;
  timestamp: number;
}

/** 新一代骰点块 payload（用于替换旧的 DiceBlockPayload） */
export interface DiceBlockPayloadV2 {
  version: 2;
  config: DiceConfig;
  lastResult: DiceResult | null;
  /** 历史记录，最多保留若干条，方便回顾 */
  history?: DiceResult[];
}

/** 最终对外：DiceBlock 的 payload 可能是老版本或新版本 */
export type DiceBlockPayloadUnion = DiceBlockPayload | DiceBlockPayloadV2;

export interface DiceBlock extends ContentBlockBase {
  type: 'dice';
  payload: DiceBlockPayloadUnion;
}

// --- 联合 ---

export type AnyContentBlock = TextBlock | ImageBlock | DiceBlock;

// ------------------------------------------------------------
// 聚合
// ------------------------------------------------------------

export interface SectionWithBlocks extends Section {
  blocks: AnyContentBlock[];
}

export interface ChapterWithSections extends Chapter {
  sections: SectionWithBlocks[];
}

export interface StoryWithAll extends Story {
  world_settings: WorldSetting[];
  characters: Character[];
  outlines: Outline[];
  volumes: Volume[];
  chapters: ChapterWithSections[];
}

// ------------------------------------------------------------
// 导出器
// ------------------------------------------------------------

export interface NGADiceRenderResult {
  /** 展示在帖子里的完整 collapse 文本 */
  collapse: string;
  /** 便于玩家点按的裸骰子行 */
  dice_line: string;
}

export interface NGAExportOptions {
  include_world_settings?: boolean;
  include_characters?: boolean;
  include_outlines?: boolean;
  /** 是否自动把上一次骰点命中的选项用箭头标记 */
  mark_hit?: boolean;
  /** 每节之间的分隔线 */
  section_separator?: string;
  /** 每章之间的分隔线 */
  chapter_separator?: string;
}

export interface NGAExportResult {
  code: string;
  /** 为方便发帖拆好的片段 */
  fragments: {
    title: string;
    code: string;
  }[];
}

// ============================================================
// Word 风格字号 & 字体常量（编辑器和属性面板共享）
// ============================================================

/** Word 中文字号表：中文名称 → 磅值(pt) */
export const WORD_FONT_SIZES: { label: string; pt: number | null }[] = [
  { label: '初号', pt: 42 },
  { label: '小初', pt: 36 },
  { label: '一号', pt: 26 },
  { label: '小一', pt: 24 },
  { label: '二号', pt: 22 },
  { label: '小二', pt: 18 },
  { label: '三号', pt: 16 },
  { label: '小三', pt: 15 },
  { label: '四号', pt: 14 },
  { label: '小四', pt: 12 }, // Word 正文默认
  { label: '五号', pt: 10.5 },
  { label: '小五', pt: 9 },
  { label: '六号', pt: 7.5 },
  { label: '小六', pt: 6.5 },
  { label: '默认', pt: null },
];

/** Word 正文默认字号（小四 12pt） */
export const WORD_DEFAULT_SIZE_PT = 12;

/** Word 常用字体表 */
export const WORD_FONTS: { label: string; value: string | null }[] = [
  { label: '默认(宋体)', value: null },
  { label: '宋体', value: 'simsun' },
  { label: '黑体', value: 'simhei' },
  { label: '仿宋', value: 'fangsong' },
  { label: '楷体', value: 'kaiti' },
  { label: '微软雅黑', value: 'yahei' },
  { label: '隶书', value: 'lisu' },
  { label: '幼圆', value: 'youyuan' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Consolas', value: 'Consolas' },
];

/** Word 正文默认字体 */
export const WORD_DEFAULT_FONT = 'simsun';

/** pt → px 转换（Word 1pt ≈ 1.333px，屏幕常用 DPI） */
export function ptToPx(pt: number): number {
  return Math.round(pt * 1.333);
}

/** 字体值 → CSS font-family */
export function translateFontToCSS(value: string | null | undefined): string {
  if (!value) value = WORD_DEFAULT_FONT;
  const map: Record<string, string> = {
    simsun: '"SimSun", "宋体", serif',
    simhei: '"SimHei", "黑体", sans-serif',
    fangsong: '"FangSong", "仿宋", serif',
    kaiti: '"KaiTi", "楷体", serif',
    yahei: '"Microsoft YaHei", "微软雅黑", sans-serif',
    lisu: '"LiSu", "隶书", serif',
    youyuan: '"YouYuan", "幼圆", sans-serif',
    Arial: 'Arial, sans-serif',
    'Times New Roman': '"Times New Roman", serif',
    Georgia: 'Georgia, serif',
    Consolas: 'Consolas, "Courier New", monospace',
  };
  return map[value] ?? value;
}

/** 颜色值 → CSS color */
export function translateColorToCSS(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const map: Record<string, string> = {
    red: '#e53935',
    green: '#43a047',
    blue: '#1e88e5',
    skyblue: '#00acc1',
    orange: '#fb8c00',
    purple: '#8e24aa',
    yellow: '#fdd835',
    pink: '#ec407a',
    white: '#ffffff',
    black: '#000000',
    gray: '#808080',
  };
  return map[name] ?? name;
}

// ============================================================
// NGA BBCode 规范常量（编辑器内显示样式 → 导出 BBCode 标签）
// ============================================================

/** NGA 字体 → 16 项（默认 simsun） */
export const NGA_FONTS: { label: string; value: string; cssFamily: string }[] = [
  { label: '宋体',     value: 'simsun',          cssFamily: '"SimSun", "宋体", serif' },
  { label: '黑体',     value: 'simhei',          cssFamily: '"SimHei", "黑体", sans-serif' },
  { label: 'Arial',    value: 'Arial',           cssFamily: 'Arial, sans-serif' },
  { label: 'Arial Black', value: 'Arial Black', cssFamily: '"Arial Black", "Arial Black", sans-serif' },
  { label: 'Book Antiqua', value: 'Book Antiqua', cssFamily: '"Book Antiqua", "Book Antiqua", serif' },
  { label: 'Century Gothic', value: 'Century Gothic', cssFamily: '"Century Gothic", "Century Gothic", sans-serif' },
  { label: 'Comic Sans MS', value: 'Comic Sans MS', cssFamily: '"Comic Sans MS", "Comic Sans MS", cursive' },
  { label: 'Courier New', value: 'Courier New', cssFamily: '"Courier New", monospace' },
  { label: 'Georgia', value: 'Georgia',         cssFamily: 'Georgia, serif' },
  { label: 'Serif',   value: 'Serif',           cssFamily: 'serif' },
  { label: 'Impact',  value: 'Impact',          cssFamily: 'Impact, "Charcoal", sans-serif' },
  { label: 'Tahoma',  value: 'Tahoma',          cssFamily: 'Tahoma, Geneva, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman', cssFamily: '"Times New Roman", serif' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS', cssFamily: '"Trebuchet MS", sans-serif' },
  { label: 'Script MT Bold', value: 'Script MT Bold', cssFamily: '"Script MT Bold", cursive' },
  { label: '微软雅黑', value: 'yahei',          cssFamily: '"Microsoft YaHei", "微软雅黑", sans-serif' },
];

/** NGA 默认字体：宋体 */
export const NGA_DEFAULT_FONT = 'simsun';

/** NGA 字号 → 6 档（百分比），默认 100% */
export const NGA_FONT_SIZES: { label: string; percent: number; cssSize: string }[] = [
  { label: '100%', percent: 100, cssSize: '12pt' },
  { label: '110%', percent: 110, cssSize: '13.2pt' },
  { label: '120%', percent: 120, cssSize: '14.4pt' },
  { label: '130%', percent: 130, cssSize: '15.6pt' },
  { label: '140%', percent: 140, cssSize: '16.8pt' },
  { label: '150%', percent: 150, cssSize: '18pt' },
];

/** NGA 默认字号 100% */
export const NGA_DEFAULT_FONT_SIZE = 100;

/** NGA 字色 → 24 色（默认 black） */
export const NGA_COLORS: { label: string; value: string; cssColor: string }[] = [
  { label: '天蓝',   value: 'skyblue',    cssColor: '#00acc1' },
  { label: '橙色',   value: 'orange',     cssColor: '#fb8c00' },
  { label: '火砖',   value: 'firebrick',  cssColor: '#b22222' },
  { label: '海绿',   value: 'seagreen',   cssColor: '#2e8b57' },
  { label: '珊瑚',   value: 'coral',      cssColor: '#ff7f50' },
  { label: '沙棕',   value: 'sandybrown', cssColor: '#f4a460' },
  { label: '宝蓝',   value: 'royalblue',  cssColor: '#4169e1' },
  { label: '橙红',   value: 'orangered',  cssColor: '#ff4500' },
  { label: '暗红',   value: 'darkred',    cssColor: '#8b0000' },
  { label: '青色',   value: 'teal',       cssColor: '#008080' },
  { label: '紫色',   value: 'purple',     cssColor: '#8e24aa' },
  { label: '土黄',   value: 'sienna',     cssColor: '#a0522d' },
  { label: '蓝色',   value: 'blue',       cssColor: '#1e88e5' },
  { label: '绯红',   value: 'crimson',    cssColor: '#dc143c' },
  { label: '绿色',   value: 'green',      cssColor: '#43a047' },
  { label: '深粉',   value: 'deeppink',   cssColor: '#ff1493' },
  { label: '靛蓝',   value: 'indigo',     cssColor: '#4b0082' },
  { label: '巧克力', value: 'chocolate',  cssColor: '#d2691e' },
  { label: '深蓝',   value: 'darkblue',   cssColor: '#00008b' },
  { label: '红色',   value: 'red',        cssColor: '#e53935' },
  { label: '青绿',   value: 'limegreen',  cssColor: '#32cd32' },
  { label: '番茄',   value: 'tomato',     cssColor: '#ff6347' },
  { label: '硬木',   value: 'burlywood',  cssColor: '#deb887' },
  { label: '银色',   value: 'silver',     cssColor: '#c0c0c0' },
  { label: '黑色',   value: 'black',      cssColor: '#000000' },
];

/** NGA 默认颜色：黑色 */
export const NGA_DEFAULT_COLOR = 'black';

/** NGA 图片尺寸 → 5 档（导出时拼到 src 后缀） */
export const NGA_IMAGE_SIZES: {
  label: string;
  value: 'original' | 'medium' | 'thumb' | 'thumb_s' | 'thumb_ss';
  suffix: string;
  width: number;
  height: number;
}[] = [
  { label: '完整大小', value: 'original', suffix: '',              width: 0,   height: 0 },
  { label: '640x?',    value: 'medium',   suffix: '.medium.jpg',   width: 640, height: 0 },
  { label: '320x240',  value: 'thumb',    suffix: '.thumb.jpg',    width: 320, height: 240 },
  { label: '130x91',   value: 'thumb_s',  suffix: '.thumb_s.jpg',  width: 130, height: 91 },
  { label: '60x45',    value: 'thumb_ss', suffix: '.thumb_ss.jpg', width: 60,  height: 45 },
];

/** NGA 默认图片尺寸 */
export const NGA_DEFAULT_IMAGE_SIZE: 'original' | 'medium' | 'thumb' | 'thumb_s' | 'thumb_ss' =
  'original';

/** 引用行背景色（编辑态与 NGA 一致） */
export const NGA_QUOTE_BG = '#f2eddf';

/** 折叠标题背景色 */
export const NGA_COLLAPSE_HEAD_BG = '#ead5bc';

/** 折叠内容背景色 */
export const NGA_COLLAPSE_BODY_BG = '#fff7d9';

/** 代码块背景色 */
export const NGA_CODE_BG = '#f1f1f1';

/** 链接默认颜色 */
export const NGA_LINK_COLOR = '#0000ee';

/** NGA 字体值 → CSS font-family（查 NGA_FONTS 表） */
export function ngaFontToCSS(value: string | null | undefined): string {
  if (!value) return NGA_FONTS[0].cssFamily;
  const f = NGA_FONTS.find((x) => x.value === value);
  return f ? f.cssFamily : NGA_FONTS[0].cssFamily;
}

/** NGA 颜色值 → CSS color（查 NGA_COLORS 表） */
export function ngaColorToCSS(value: string | null | undefined): string {
  if (!value) return NGA_DEFAULT_COLOR;
  const c = NGA_COLORS.find((x) => x.value === value);
  return c ? c.cssColor : value;
}

/** NGA 字号百分比 → CSS font-size（查 NGA_FONT_SIZES 表） */
export function ngaSizeToCSS(percent: number | null | undefined): string {
  const p = percent ?? NGA_DEFAULT_FONT_SIZE;
  const s = NGA_FONT_SIZES.find((x) => x.percent === p);
  return s ? s.cssSize : NGA_FONT_SIZES[0].cssSize;
}

// ============================================================
// Outline 大纲 辅助函数
// ============================================================

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

