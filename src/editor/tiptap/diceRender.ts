// ============================================================
// 安科编辑器 —— 骰子卡渲染 / payload 读写（Tiptap 内核）
//
// 从旧 contenteditable 模块 diceCard.ts 机械搬迁以下符号及其最小依赖闭包：
//   getDicePayload / setDicePayload / renderDiceCard / scrollToDiceCard
//   （diceTextStyleToCss / applyTextStyle / formatNumericExpressionFromConfig /
//    clearDiceSelection / selectDiceCard / DICE_CARD_SELECTOR）
// 函数体与语义逐字保留，不含插入 / 删除 / 掷骰等编辑命令实现。
// ============================================================

import type { DiceTextStyle, DiceStyleConfig } from '../../types';

const DICE_CARD_SELECTOR = 'div[data-type="dice-card"]';

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

/** 取消所有骰子卡的选中态 */
function clearDiceSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

/** 选中指定骰子卡 */
function selectDiceCard(editor: HTMLElement, block: HTMLElement): void {
  clearDiceSelection(editor);
  block.setAttribute('data-selected', 'true');
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
    block.style.borderRadius = 'var(--radius-lg)';
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

    // 需求: 卡片头部 Dices 图标（lucide dices path）
    const diceIcon = document.createElement('span');
    diceIcon.setAttribute('aria-hidden', 'true');
    diceIcon.style.display = 'inline-flex';
    diceIcon.style.alignItems = 'center';
    diceIcon.style.alignSelf = 'center';
    diceIcon.style.color = 'var(--dice-card-accent)';
    diceIcon.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"></rect><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 6h.01"></path><path d="M18 9h.01"></path></svg>';

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

    left.appendChild(diceIcon);
    left.appendChild(name);
    left.appendChild(kindLabel);

    const rollBtn = document.createElement('button');
    rollBtn.setAttribute('data-role', 'roll');
    rollBtn.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:4px">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"></rect><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 6h.01"></path><path d="M18 9h.01"></path></svg>' +
      '掷骰</span>';
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
    editBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
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
    rollEmoji.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"></rect><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 6h.01"></path><path d="M18 9h.01"></path></svg>';
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

    // 结果区：浅底 + 左侧色条（与引用块视觉呼应）
    const result = document.createElement('div');
    result.setAttribute('data-slot', 'result');
    result.style.marginTop = '10px';
    result.style.padding = '10px 12px';
    result.style.background = 'var(--dice-card-kind-bg)';
    result.style.borderLeft = '3px solid var(--dice-card-accent)';
    result.style.borderRadius = 'var(--radius-sm)';
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
    // 幂等重设结果区样式：旧卡片（由旧版本创建）在下次渲染时升级到新色条样式
    finalResultEl.style.borderLeft = '3px solid var(--dice-card-accent)';
    finalResultEl.style.borderRadius = 'var(--radius-sm)';
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
