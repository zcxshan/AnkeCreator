// contenteditable 富文本工具集 — 骰子卡片 dice-card
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import type { DiceTextStyle, DiceStyleConfig, DiceBlockPayloadV2 } from '../types';
import { rollDice } from '../utils/diceEngine';
import { useSettingStore } from '../store/settingStore';
import { playDiceRollSound } from '../utils/diceSound';
import {
  getInsertionPoint,
  setLastEditorRange,
  focusEditor,
  dispatchInput,
} from './selection';
import { pushAtomicHistory, DICE_CARD_SELECTOR } from './utils';
import { findAncestorWithAttr } from './dom';

export function isDiceCard(el: HTMLElement | null | undefined): boolean {
  return !!(el && el.dataset && el.dataset.type === 'dice-card');
}

/** 从节点向上查找最近的 dice-card */
export function findDiceCardAncestor(
  node: Node | null | undefined,
  editor: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (isDiceCard(el)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 读取 payload（用 try/catch 保护 dataset.payload 可能为旧值 / 空） */
export function getDicePayload(block: HTMLElement): {
  payload: any;
  payloadStr: string;
} {
  const raw = block.getAttribute('data-payload') || '{}';
  try {
    return { payload: JSON.parse(raw), payloadStr: raw };
  } catch {
    return {
      payload: { version: 2, config: { id: '', kind: 'option', name: '骰子' }, lastResult: null },
      payloadStr: raw,
    };
  }
}

/** 写入 payload（同时更新 data-payload），返回 JSON 字符串 */
export function setDicePayload(block: HTMLElement, payload: any): string {
  const str = JSON.stringify(payload);
  block.setAttribute('data-payload', str);
  return str;
}

/** 选中态管理 */
export function clearDiceSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

export function selectDiceCard(editor: HTMLElement, block: HTMLElement): void {
  clearDiceSelection(editor);
  block.setAttribute('data-selected', 'true');
}

export function getSelectedDiceCard(editor: HTMLElement): HTMLElement | null {
  const list = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-selected') === 'true') return list[i];
  }
  return null;
}

/** 需求4:把 DiceTextStyle 转换为内联 CSS 属性对象 */
function diceTextStyleToCss(style: DiceTextStyle | undefined): Partial<CSSStyleDeclaration> {
  if (!style) return {};
  const css: Partial<CSSStyleDeclaration> = {};
  if (style.bold !== undefined) css.fontWeight = style.bold ? '700' : '400';
  if (style.italic !== undefined) css.fontStyle = style.italic ? 'italic' : 'normal';
  if (style.underline !== undefined || style.strike !== undefined) {
    const decos: string[] = [];
    if (style.underline) decos.push('underline');
    if (style.strike) decos.push('line-through');
    css.textDecoration = decos.length > 0 ? decos.join(' ') : 'none';
  }
  if (style.color) css.color = style.color;
  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontSize) css.fontSize = style.fontSize;
  return css;
}

/** 需求4:把样式对象应用到 HTMLElement */
function applyTextStyle(el: HTMLElement, style: DiceTextStyle | undefined): void {
  if (!style) return;
  const css = diceTextStyleToCss(style);
  Object.assign(el.style, css);
}

/** 渲染 / 刷新 dice-card 的 DOM。用 data-payload 驱动。 */
export function renderDiceCard(block: HTMLElement): void {
  const { payload } = getDicePayload(block);
  const cfg: any = (payload && payload.config) || { name: '骰子', kind: 'option' };
  const kind: string = cfg.kind || 'option';
  const lastResult: any = payload?.lastResult || null;
  const styleConfig: DiceStyleConfig | undefined = payload?.style;

  // 为元素设置一些基础样式（第一次）
  if (!block.dataset.initialized) {
    block.setAttribute('contenteditable', 'false');
    block.setAttribute('contentEditable', 'false');
    block.style.display = 'block';
    block.style.margin = '12px 0';
    block.style.padding = '12px 14px';
    block.style.borderRadius = '10px';
    block.style.background = 'var(--dice-card-bg)';
    block.style.border = '1px solid var(--dice-card-border)';
    block.style.fontSize = '13px';
    block.style.lineHeight = '1.6';
    block.style.color = 'var(--dice-card-ink)';
    block.style.outline = 'none';
    block.style.userSelect = 'auto'; // 允许被选中以便拖动
    // 需求4:hover dice-card 时显示编辑按钮
    block.addEventListener('mouseenter', () => {
      const eb = block.querySelector<HTMLButtonElement>('button[data-role="edit"]');
      if (eb) eb.style.opacity = '1';
    });
    block.addEventListener('mouseleave', () => {
      const eb = block.querySelector<HTMLButtonElement>('button[data-role="edit"]');
      if (eb) eb.style.opacity = '0';
    });
    block.dataset.initialized = '1';
  }

  // 名称
  const nameEl = block.querySelector<HTMLElement>('[data-slot="name"]');
  const kindEl = block.querySelector<HTMLElement>('[data-slot="kind"]');
  const optionsEl = block.querySelector<HTMLElement>('[data-slot="options"]');
  const resultEl = block.querySelector<HTMLElement>('[data-slot="result"]');

  // 首次构建内部结构
  let ensureName = nameEl;
  if (!ensureName) {
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.gap = '8px';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'baseline';
    left.style.gap = '8px';

    const name = document.createElement('div');
    name.setAttribute('data-slot', 'name');
    name.style.fontWeight = '600';
    name.style.fontSize = '13px';
    name.style.color = 'var(--dice-card-ink)';

    const kindLabel = document.createElement('div');
    kindLabel.setAttribute('data-slot', 'kind');
    kindLabel.style.fontSize = '11px';
    kindLabel.style.padding = '2px 8px';
    kindLabel.style.borderRadius = '999px';
    kindLabel.style.background = 'var(--dice-card-kind-bg)';
    kindLabel.style.color = 'var(--dice-card-kind-fg)';
    kindLabel.style.fontWeight = '500';

    left.appendChild(name);
    left.appendChild(kindLabel);

    const rollBtn = document.createElement('button');
    rollBtn.setAttribute('data-role', 'roll');
    rollBtn.textContent = '🎲 掷骰';
    rollBtn.style.fontSize = '12px';
    rollBtn.style.fontWeight = '500';
    rollBtn.style.padding = '4px 10px';
    rollBtn.style.borderRadius = '6px';
    rollBtn.style.border = '1px solid var(--dice-card-roll-bg)';
    rollBtn.style.background = 'var(--dice-card-roll-bg)';
    rollBtn.style.color = 'var(--text-on-accent)';
    rollBtn.style.cursor = 'pointer';
    rollBtn.style.userSelect = 'none';
    rollBtn.addEventListener('mouseenter', () => {
      rollBtn.style.background = 'var(--dice-card-roll-hover)';
      rollBtn.style.borderColor = 'var(--dice-card-roll-hover)';
    });
    rollBtn.addEventListener('mouseleave', () => {
      rollBtn.style.background = 'var(--dice-card-roll-bg)';
      rollBtn.style.borderColor = 'var(--dice-card-roll-bg)';
    });

    head.appendChild(left);

    // 需求4:右侧按钮组(编辑 + 掷骰)
    const rightBtns = document.createElement('div');
    rightBtns.style.display = 'flex';
    rightBtns.style.alignItems = 'center';
    rightBtns.style.gap = '6px';

    // 需求4:编辑按钮(hover dice-card 时显示)
    const editBtn = document.createElement('button');
    editBtn.setAttribute('data-role', 'edit');
    editBtn.textContent = '✏️';
    editBtn.title = '编辑骰子配置';
    editBtn.style.fontSize = '12px';
    editBtn.style.padding = '4px 8px';
    editBtn.style.borderRadius = '6px';
    editBtn.style.border = '1px solid var(--dice-card-border)';
    editBtn.style.background = 'transparent';
    editBtn.style.color = 'var(--dice-card-ink)';
    editBtn.style.cursor = 'pointer';
    editBtn.style.userSelect = 'none';
    editBtn.style.opacity = '0';
    editBtn.style.transition = 'opacity 0.15s';
    editBtn.addEventListener('mouseenter', () => {
      editBtn.style.background = 'var(--bg-hover)';
    });
    editBtn.addEventListener('mouseleave', () => {
      editBtn.style.background = 'transparent';
    });

    rightBtns.appendChild(editBtn);
    rightBtns.appendChild(rollBtn);
    head.appendChild(rightBtns);

    // 滚动展示区（投掷动画时显示，投后隐藏；DOM 始终保留，避免重复创建）
    const rollDisplay = document.createElement('div');
    rollDisplay.setAttribute('data-slot', 'roll-display');
    rollDisplay.style.display = 'none';
    rollDisplay.style.alignItems = 'center';
    rollDisplay.style.gap = '6px';
    rollDisplay.style.fontSize = '12px';
    rollDisplay.style.fontFamily = 'Consolas, Menlo, monospace';
    rollDisplay.style.color = 'var(--dice-card-ink)';
    rollDisplay.style.fontWeight = '500';

    const rollEmoji = document.createElement('span');
    rollEmoji.setAttribute('data-slot', 'roll-emoji');
    rollEmoji.textContent = '🎲';
    rollEmoji.style.fontSize = '16px';
    rollEmoji.style.display = 'inline-block';

    const rollNumber = document.createElement('span');
    rollNumber.setAttribute('data-slot', 'roll-number');
    rollNumber.style.minWidth = '52px';
    rollNumber.style.textAlign = 'right';

    rollDisplay.appendChild(rollEmoji);
    rollDisplay.appendChild(rollNumber);
    // 需求4:应用用户配置的骰子点数文本样式(覆盖默认)
    if (styleConfig?.resultText) applyTextStyle(rollDisplay, styleConfig.resultText);
    head.appendChild(rollDisplay);

    block.appendChild(head);

    // 选项区
    const options = document.createElement('div');
    options.setAttribute('data-slot', 'options');
    options.style.marginTop = '8px';
    options.style.display = 'flex';
    options.style.flexDirection = 'column';
    options.style.gap = '4px';
    block.appendChild(options);

    // 结果区
    const result = document.createElement('div');
    result.setAttribute('data-slot', 'result');
    result.style.marginTop = '10px';
    result.style.padding = '8px 10px';
    result.style.background = 'var(--dice-card-kind-bg)';
    result.style.border = '1px dashed var(--dice-card-border)';
    result.style.borderRadius = '8px';
    result.style.color = 'var(--dice-card-kind-fg)';
    result.style.fontSize = '12px';
    result.style.display = 'none';
    block.appendChild(result);
  }

  // 填值：名称
  const finalNameEl = block.querySelector<HTMLElement>('[data-slot="name"]');
  if (finalNameEl) finalNameEl.textContent = cfg.name || '';

  // 填值：类型标签
  const finalKindEl = block.querySelector<HTMLElement>('[data-slot="kind"]');
  if (finalKindEl) {
    finalKindEl.textContent =
      kind === 'numeric'
        ? `数值 · ${formatNumericExpressionFromConfig(cfg)}`
        : `选项 · D${cfg.faces ?? 2}`;
  }

  // 一次性约束：已投掷过 → 隐藏掷骰按钮（投掷动画结束后保持隐藏）
  const finalRollBtn = block.querySelector<HTMLButtonElement>('button[data-role="roll"]');
  if (finalRollBtn) {
    finalRollBtn.style.display = lastResult ? 'none' : '';
  }

  // 填值：选项（仅选项骰子）
  const finalOptionsEl = block.querySelector<HTMLElement>('[data-slot="options"]');
  if (finalOptionsEl) {
    finalOptionsEl.innerHTML = '';
    if (kind === 'option') {
      const opts: any[] = cfg.options || [];
      const hitId: string | null = lastResult?.hitOptionId || null;
      opts.forEach((opt) => {
        const row = document.createElement('div');
        row.setAttribute('data-option-id', opt.id);
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '3px 6px';
        row.style.borderRadius = '6px';
        if (hitId && opt.id === hitId) {
          row.style.background = 'var(--dice-card-hit-bg)';
          row.style.color = 'var(--dice-card-hit-fg)';
          row.style.fontWeight = '600';
          row.style.border = '1px solid var(--dice-card-hit-border)';
          row.classList.add('anke-dice-hit');
          // 需求4:应用用户配置的选中选项文本样式(覆盖默认)
          if (styleConfig?.selectedOption) applyTextStyle(row, styleConfig.selectedOption);
        } else {
          row.style.background = 'var(--dice-card-bg)';
          row.style.color = 'var(--dice-card-ink)';
          // 需求4:应用用户配置的未选中选项文本样式(覆盖默认)
          if (styleConfig?.unselectedOption) applyTextStyle(row, styleConfig.unselectedOption);
        }
        const val = document.createElement('span');
        val.textContent = opt.displayValue || '';
        val.style.fontSize = '11px';
        val.style.fontFamily = 'Consolas, Menlo, monospace';
        val.style.padding = '1px 6px';
        val.style.borderRadius = '4px';
        val.style.background = hitId && opt.id === hitId ? 'var(--dice-card-roll-hover)' : 'var(--dice-card-kind-bg)';
        val.style.color = hitId && opt.id === hitId ? 'var(--text-on-accent)' : 'var(--dice-card-kind-fg)';
        val.style.fontWeight = '600';
        val.style.minWidth = '36px';
        val.style.textAlign = 'center';

        const content = document.createElement('span');
        content.textContent = opt.content || '';
        content.style.fontSize = '12px';
        content.style.flex = '1';

        row.appendChild(val);
        row.appendChild(content);
        finalOptionsEl.appendChild(row);
      });
    }
  }

  // 填值：结果
  const finalResultEl = block.querySelector<HTMLElement>('[data-slot="result"]');
  if (finalResultEl) {
    if (!lastResult) {
      finalResultEl.style.display = 'none';
      finalResultEl.textContent = '';
    } else {
      finalResultEl.style.display = 'block';
      const headText = lastResult.displayText || '';
      let bodyText = '';
      if (lastResult.kind === 'option') {
        bodyText = lastResult.hitOptionContent
          ? `命中：${lastResult.hitOptionContent}`
          : '未命中任何选项';
      } else {
        bodyText = `结果：${lastResult.total}`;
      }
      finalResultEl.innerHTML = '';
      const headDiv = document.createElement('div');
      headDiv.style.fontFamily = 'Consolas, Menlo, monospace';
      headDiv.style.fontSize = '12px';
      headDiv.style.marginBottom = '4px';
      // 需求4:应用用户配置的骰子点数文本样式(覆盖默认)
      if (styleConfig?.resultText) applyTextStyle(headDiv, styleConfig.resultText);
      headDiv.textContent = headText;
      finalResultEl.appendChild(headDiv);

      const bodyDiv = document.createElement('div');
      bodyDiv.textContent = bodyText;
      finalResultEl.appendChild(bodyDiv);
    }
  }
}

/** 把数值骰子的配置格式化为 "3d6+2" 或表达式 */
function formatNumericExpressionFromConfig(cfg: any): string {
  if (cfg.expression) return cfg.expression;
  const count = Math.max(1, Math.floor(cfg.count ?? 1));
  const faces = Math.max(1, Math.floor(cfg.numericFaces ?? 100));
  const modifier = Math.floor(cfg.modifier ?? 0);
  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return `${count}d${faces}${mod}`;
}

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 在光标处插入 dice-card，后补空段落并把光标落进去 */
export function insertDiceCard(
  editor: HTMLElement,
  payload: any,
): HTMLElement | null {
  // 关键：不要先 focusEditor！focus 会把 contenteditable 的 selection 重置到 (0,0)
  // getInsertionPoint 内部会优先用 _lastEditorRange（用户最后在 editor 内的光标）
  const range = getInsertionPoint(editor);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-type', 'dice-card');
  wrapper.setAttribute('draggable', 'true');
  wrapper.setAttribute('tabindex', '-1');
  // 需求4:设置 data-block-id 用于编辑时定位(优先用 config.id)
  wrapper.setAttribute('data-block-id', payload?.config?.id || Math.random().toString(36).slice(2, 10));
  wrapper.style.userSelect = 'auto';
  wrapper.style.cursor = 'grab';
  wrapper.style.outline = 'none';
  wrapper.style.display = 'block';
  setDicePayload(wrapper, payload);
  renderDiceCard(wrapper);

  range.insertNode(wrapper);

  // 紧跟 wrapper 之后插入 <br> 占位，让用户可以点击空行放下光标
  const placeholder = document.createElement('br');
  wrapper.parentNode?.insertBefore(placeholder, wrapper.nextSibling);

  // 移动光标到 <br> 占位之后；这样连续插入会接在 <br> 之后，
  // 形成 wrapper → <br> → 新块 的结构（与测试期望一致）
  const sel = window.getSelection();
  if (sel) {
    const newRange = document.createRange();
    newRange.setStartAfter(placeholder);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    // 同步到模块，让连续插入接在后面
    setLastEditorRange(newRange.cloneRange());
  }
  focusEditor(editor);

  dispatchInput(editor);
  // 原子块插入立即 push 历史（跳过 200ms 防抖，让每次插入可独立撤销）
  pushAtomicHistory(editor.innerHTML);
  return wrapper;
}

/** 需求4:更新已有 dice-card 的 payload 并重新渲染(编辑保存后回填) */
export function updateDiceBlock(
  editor: HTMLElement,
  blockId: string,
  payload: DiceBlockPayloadV2,
): boolean {
  const block = editor.querySelector<HTMLElement>(
    `${DICE_CARD_SELECTOR}[data-block-id="${blockId}"]`,
  );
  if (!block) return false;
  block.setAttribute('data-payload', JSON.stringify(payload));
  // 同步更新 data-block-id(以防 config.id 变化)
  if (payload?.config?.id) {
    block.setAttribute('data-block-id', payload.config.id);
  }
  // 重置 initialized 标记以强制重建内部结构(确保编辑按钮等正确挂载)
  delete block.dataset.initialized;
  block.innerHTML = '';
  renderDiceCard(block);
  dispatchInput(editor);
  pushAtomicHistory(editor.innerHTML);
  return true;
}

/** 删除指定 dice-card，光标落到前一个兄弟末尾，触发 input */
export function removeDiceCard(editor: HTMLElement, block: HTMLElement): void {
  if (!block.parentNode) return;
  const prev = block.previousSibling;
  block.parentNode.removeChild(block);

  const newRange = document.createRange();
  if (prev) {
    try {
      newRange.selectNodeContents(prev);
      newRange.collapse(false);
    } catch {
      newRange.selectNodeContents(editor);
      newRange.collapse(false);
    }
  } else {
    newRange.selectNodeContents(editor);
    newRange.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  focusEditor(editor);
  sel?.addRange(newRange);
  dispatchInput(editor);
  // 原子块删除立即 push 历史（跳过 200ms 防抖，让每次删除可独立撤销）
  pushAtomicHistory(editor.innerHTML);
}

/** 对 dice-card 执行掷骰：读取 payload → rollDice → 更新 payload → 重渲染 → dispatchInput
 *  - 一次性约束：已投掷过（payload.lastResult 存在）则直接返回
 *  - 动画：600ms 内 🎲 emoji 旋转 + 数字快速滚动（老虎机效果）
 *  - 投后：按钮消失（display:none），结果区显示最终结果
 */
export function rollDiceOnCard(editor: HTMLElement, block: HTMLElement): void {
  const { payload } = getDicePayload(block);
  if (!payload || !payload.config) return;

  // 一次性约束：已投掷过则不再触发（renderDiceCard 已隐藏按钮，双保险）
  if (payload.lastResult) return;

  // 1. 启动动画：摇一摇卡片 + 按钮按压 + 显示滚动区
  const rollBtn = block.querySelector<HTMLButtonElement>('button[data-role="roll"]');
  const rollDisplay = block.querySelector<HTMLElement>('[data-slot="roll-display"]');
  const rollEmoji = block.querySelector<HTMLElement>('[data-slot="roll-emoji"]');
  const rollNumber = block.querySelector<HTMLElement>('[data-slot="roll-number"]');

  // 播放音效（仅在设置开启时；playDiceRollSound 内部 try/catch，失败安全 no-op）
  if (useSettingStore.getState().soundEnabled) {
    void playDiceRollSound();
  }

  // 摇一摇卡片（350ms 后自动清除 class）
  block.classList.add('anke-dice-shaking');
  window.setTimeout(() => block.classList.remove('anke-dice-shaking'), 350);

  // 按钮按压（180ms 后清除，180ms 后再隐藏）
  if (rollBtn) rollBtn.classList.add('anke-dice-btn-press');
  window.setTimeout(() => {
    if (rollBtn) {
      rollBtn.classList.remove('anke-dice-btn-press');
      rollBtn.style.display = 'none';
    }
  }, 180);

  if (rollDisplay) {
    rollDisplay.style.display = 'inline-flex';
    rollDisplay.classList.add('anke-dice-rolling');
  }
  if (rollEmoji) rollEmoji.classList.add('anke-dice-spin');

  // 2. 同步计算结果（动画期间不渲染结果区，等动画结束再统一更新）
  const cfg: any = payload.config;
  const result: any = rollDicePure(cfg);
  const history: any[] = Array.isArray(payload.history) ? [...payload.history, result] : [result];
  const nextPayload = {
    ...payload,
    lastResult: result,
    history: history.slice(-20),
  };

  // 3. 数字滚动：渐进减速节奏（6 快速 + 4 中速 + 2 慢速 = 800ms）
  const kind: string = cfg.kind || 'option';
  const maxValue =
    kind === 'numeric'
      ? Math.max(1, Math.floor(cfg.numericFaces ?? 100))
      : Math.max(1, Math.floor(cfg.faces ?? 2));
  const displayText = kind === 'numeric' ? `${cfg.count ?? 1}d${maxValue}` : `D${maxValue}`;

  const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100];
  const ROLL_TOTAL_MS = tickDelays.reduce((a, b) => a + b, 0); // 800
  let tickIdx = 0;
  const tickFn = () => {
    const v = Math.floor(Math.random() * maxValue) + 1;
    if (rollNumber) rollNumber.textContent = `[${displayText}=${v}]`;
    if (tickIdx < tickDelays.length) {
      window.setTimeout(tickFn, tickDelays[tickIdx]);
      tickIdx++;
    }
  };
  tickFn();

  // 4. ROLL_TOTAL_MS 后：写入 payload、隐藏滚动区、清空动画
  window.setTimeout(() => {
    if (rollDisplay) {
      rollDisplay.classList.remove('anke-dice-rolling');
      rollDisplay.style.display = 'none';
    }
    if (rollEmoji) rollEmoji.classList.remove('anke-dice-spin');
    if (rollNumber) rollNumber.textContent = '';

    // 写入 payload → renderDiceCard 内 lastResult 存在 → rollBtn 永久隐藏
    setDicePayload(block, nextPayload);
    renderDiceCard(block);
    dispatchInput(editor);

    // 通知外层（例如 RichTextEditor）：骰子被掷出
    try {
      editor.dispatchEvent(
        new CustomEvent('anke-dice-rolled', {
          bubbles: true,
          detail: { payload: nextPayload, blockElement: block },
        }),
      );
    } catch {
      // ignore
    }
  }, ROLL_TOTAL_MS);
}

/** 纯函数版 rollDice：不依赖 store，直接调 diceEngine.rollDice
 *  - diceEngine.rollDice 已正确处理：
 *    · 数值骰子简单模式：count 上限 NUMERIC_MAX_COUNT (100)，faces 上限 NUMERIC_MAX_FACES (9999999)
 *    · 数值骰子表达式模式：自动走 rollExpression（支持 + - * / 和括号）
 *    · 选项骰子：1Dfaces 投掷 + 命中选项
 */
function rollDicePure(cfg: any): any {
  return rollDice(cfg as any);
}

/** 给编辑器挂载 dice-card 交互：点击选中、Delete/Backspace 删除、掷骰按钮；并对所有已有 dice-card 重渲染 */
export function attachDiceCardHandlers(editor: HTMLElement): () => void {
  // 首次挂载：对已有的 dice-card（从 innerHTML 恢复出来）重渲染以确保内部结构
  // 注意：已初始化的（data-initialized=1）只刷新内容，不再清空重建，避免 rollBtn 引用变化导致 hover/click 状态丢失
  const existing = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  existing.forEach((el) => {
    // 需求4:补全 data-block-id(从 innerHTML 恢复的 dice-card 可能没有)
    if (!el.getAttribute('data-block-id')) {
      const { payload } = getDicePayload(el);
      el.setAttribute('data-block-id', payload?.config?.id || Math.random().toString(36).slice(2, 10));
    }
    if (el.dataset.initialized) {
      renderDiceCard(el);
    } else {
      el.innerHTML = '';
      renderDiceCard(el);
    }
  });

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    // 点击到掷骰按钮：不做选中（click 事件会处理）
    const btn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'roll');
    if (btn) return;
    const block = findDiceCardAncestor(target, editor);
    if (block) {
      // 不调用 e.preventDefault()！否则浏览器不会触发 dragstart。
      selectDiceCard(editor, block);
      return;
    }
    clearDiceSelection(editor);
  };

  // 用 selectstart 阻止文本选区出现在骰子卡片内（不阻止 dragstart）
  const onSelectStart = (e: Event) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    if (findDiceCardAncestor(target, editor)) {
      e.preventDefault();
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;

    // 需求4:编辑按钮点击 → 分发 CustomEvent 给 RichTextEditor
    const editBtn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'edit');
    if (editBtn) {
      e.stopPropagation();
      e.preventDefault();
      const block = findDiceCardAncestor(target, editor);
      if (!block) return;
      const { payload } = getDicePayload(block);
      const blockId = block.getAttribute('data-block-id') || '';
      editor.dispatchEvent(new CustomEvent('dice-edit-request', {
        detail: { blockId, payload },
        bubbles: false,
      }));
      return;
    }

    const btn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'roll');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const block = findDiceCardAncestor(target, editor);
    if (!block) return;
    rollDiceOnCard(editor, block);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = getSelectedDiceCard(editor);
    if (selected) {
      e.preventDefault();
      removeDiceCard(editor, selected);
      return;
    }
    // 光标在紧邻位置按 Backspace/Delete 也删除
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    const container = range.startContainer;
    const offset = range.startOffset;

    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container as HTMLElement;
      if (e.key === 'Backspace') {
        const target = el.childNodes[offset - 1] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isDiceCard(target)) {
          e.preventDefault();
          removeDiceCard(editor, target);
          return;
        }
      } else {
        const target = el.childNodes[offset] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isDiceCard(target)) {
          e.preventDefault();
          removeDiceCard(editor, target);
          return;
        }
      }
    }

    if (container.nodeType === Node.TEXT_NODE) {
      const parent = container.parentNode as HTMLElement | null;
      if (!parent) return;
      const idx = Array.prototype.indexOf.call(parent.childNodes, container);
      if (e.key === 'Backspace' && offset === 0) {
        const prev = parent.childNodes[idx - 1] as HTMLElement | undefined;
        if (prev && prev.nodeType === Node.ELEMENT_NODE && isDiceCard(prev)) {
          e.preventDefault();
          removeDiceCard(editor, prev);
          return;
        }
      } else if (
        e.key === 'Delete' &&
        offset === (container.textContent?.length ?? 0)
      ) {
        const next = parent.childNodes[idx + 1] as HTMLElement | undefined;
        if (next && next.nodeType === Node.ELEMENT_NODE && isDiceCard(next)) {
          e.preventDefault();
          removeDiceCard(editor, next);
          return;
        }
      }
    }
  };

  editor.addEventListener('mousedown', onMouseDown, true);
  editor.addEventListener('selectstart', onSelectStart, true);
  editor.addEventListener('click', onClick, true);
  editor.addEventListener('keydown', onKeyDown, true);
  return () => {
    editor.removeEventListener('mousedown', onMouseDown, true);
    editor.removeEventListener('selectstart', onSelectStart, true);
    editor.removeEventListener('click', onClick, true);
    editor.removeEventListener('keydown', onKeyDown, true);
  };
}

/** 给定历史记录的 payload JSON 字符串，在编辑器中找到对应的 dice-card 并滚动到它，选中并闪烁高亮 */
export function scrollToDiceCard(editor: HTMLElement, payloadSnapshot: string): boolean {
  if (!editor || !payloadSnapshot) return false;
  let snapshot: any = null;
  try {
    snapshot = JSON.parse(payloadSnapshot);
  } catch {
    return false;
  }
  const snapshotId: string =
    (snapshot && snapshot.config && (snapshot.config.id || snapshot.config.name)) || '';
  const snapshotTimestamp: number | null =
    snapshot && snapshot.lastResult && typeof snapshot.lastResult.timestamp === 'number'
      ? snapshot.lastResult.timestamp
      : null;

  const candidates = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  if (candidates.length === 0) return false;

  let best: HTMLElement | null = null;
  let bestScore = -1;

  candidates.forEach((el) => {
    let cur: any = null;
    try {
      cur = JSON.parse(el.getAttribute('data-payload') || '{}');
    } catch {
      return;
    }
    const curId: string =
      (cur && cur.config && (cur.config.id || cur.config.name)) || '';
    const curTimestamp: number | null =
      cur && cur.lastResult && typeof cur.lastResult.timestamp === 'number'
        ? cur.lastResult.timestamp
        : null;

    let score = 0;
    if (snapshotId && curId === snapshotId) score += 100;
    if (
      snapshotTimestamp != null &&
      curTimestamp != null &&
      Math.abs(curTimestamp - snapshotTimestamp) < 1000
    ) {
      score += 50;
    }
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });

  if (!best) {
    // 降级策略：找编辑器中第一个 dice-card
    best = candidates[0] || null;
  }

  if (best) {
    selectDiceCard(editor, best);
    try {
      (best as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // ignore
    }
    // 简单高亮闪烁
    const original = (best as HTMLElement).style.boxShadow;
    (best as HTMLElement).style.boxShadow = '0 0 0 3px var(--accent-bg)';
    window.setTimeout(() => {
      if (best) (best as HTMLElement).style.boxShadow = original;
    }, 1200);
    return true;
  }
  return false;
}

/**
 * 纯检查函数（无副作用）：判断 payloadSnapshot 对应的骰子是否仍在编辑器中。
 * 匹配规则与 scrollToDiceCard 一致（id/name +100 分，timestamp +50 分），
 * 但不滚动/不选中/不闪烁，且不降级到第一个 dice-card。
 * 返回 true 表示骰子还在编辑区（恢复按钮应 disabled）。
 */
export function isDiceCardInEditor(editor: HTMLElement, payloadSnapshot: string): boolean {
  if (!editor || !payloadSnapshot) return false;
  let snapshot: any = null;
  try {
    snapshot = JSON.parse(payloadSnapshot);
  } catch {
    return false;
  }
  const snapshotId: string =
    (snapshot && snapshot.config && (snapshot.config.id || snapshot.config.name)) || '';
  const snapshotTimestamp: number | null =
    snapshot && snapshot.lastResult && typeof snapshot.lastResult.timestamp === 'number'
      ? snapshot.lastResult.timestamp
      : null;

  const candidates = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  if (candidates.length === 0) return false;

  let bestScore = -1;
  candidates.forEach((el) => {
    let cur: any = null;
    try {
      cur = JSON.parse(el.getAttribute('data-payload') || '{}');
    } catch {
      return;
    }
    const curId: string =
      (cur && cur.config && (cur.config.id || cur.config.name)) || '';
    const curTimestamp: number | null =
      cur && cur.lastResult && typeof cur.lastResult.timestamp === 'number'
        ? cur.lastResult.timestamp
        : null;

    let score = 0;
    if (snapshotId && curId === snapshotId) score += 100;
    if (
      snapshotTimestamp != null &&
      curTimestamp != null &&
      Math.abs(curTimestamp - snapshotTimestamp) < 1000
    ) {
      score += 50;
    }
    if (score > bestScore) {
      bestScore = score;
    }
  });

  // 有实际匹配（score >= 50）才算"还在"
  return bestScore >= 50;
}
