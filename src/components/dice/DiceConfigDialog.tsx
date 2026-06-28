// ============================================================
// DiceConfigDialog - 骰子配置弹窗
// ------------------------------------------------------------
// 用于：
//   - 新建一个骰子块（选项/数值）
//   - 编辑已有骰子块的配置
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiceBlockPayloadV2, DiceConfig, DiceKind } from '../../types';
import {
  useDiceStore,
  createDefaultNumericDice,
  createDefaultOptionDice,
} from '../../store/diceStore';
import {
  NUMERIC_MAX_COUNT,
  NUMERIC_MAX_FACES,
  compressValuesToDisplay,
  parseDiceExpression,
  createOptionId,
} from '../../utils/diceEngine';
import { parseNgaAnjia, toDiceOptions, type DiceNGAOption } from '../../utils/parseNgaAnjia';

interface DiceConfigDialogProps {
  /** 保存时触发：如果有 targetBlockId，则调用 updateBlock；否则调用 onSaveNew 把新建的 dice 加到当前节 */
  onSaveEdit?: (blockId: string, payload: DiceBlockPayloadV2) => void;
  onSaveNew: (payload: DiceBlockPayloadV2) => void;
}

export function DiceConfigDialog({ onSaveEdit, onSaveNew }: DiceConfigDialogProps) {
  const { dialog, closeDialog, setDraftName, setDraftKind, setDraftFaces,
    addDraftOption, removeDraftOption, updateDraftOption, setDraftCount,
    setDraftNumericFaces, setDraftModifier, setDraftExpression, setDraft, validateDraftCoverage } =
    useDiceStore();
  const { open, draft, targetBlockId } = dialog;

  // 临时错误提示（覆盖校验失败时显示）
  const [coverageWarning, setCoverageWarning] = useState<string | null>(null);

  // 跟踪遮罩 mousedown 是否起于遮罩本身：
  // - 避免在 input/textarea 中全选文字后，鼠标拖出 UI 误关弹窗
  // - 只有 mousedown 和 mouseup 都在遮罩时才关闭
  const mouseDownOnOverlayRef = useRef(false);

  // NGA 文本添加面板状态
  const [ngaText, setNgaText] = useState('');
  const [ngaParsed, setNgaParsed] = useState<DiceNGAOption[]>([]);
  const [ngaPanelOpen, setNgaPanelOpen] = useState(false);

  useEffect(() => {
    setCoverageWarning(null);
  }, [open, draft?.kind, draft?.faces]);

  if (!open || !draft) return null;

  const isOption = draft.kind === 'option';

  const coverage = validateDraftCoverage();
  const faces = (draft.faces ?? 2) | 0;

  // NGA 文本解析
  const handleParseNga = () => {
    const result = parseNgaAnjia(ngaText);
    setNgaParsed(result);
  };

  const handleConfirmImport = () => {
    let parsed = ngaParsed;
    if (parsed.length === 0 && ngaText.trim()) {
      parsed = parseNgaAnjia(ngaText);
      setNgaParsed(parsed);
    }
    if (parsed.length === 0) {
      setCoverageWarning('未识别到任何安价，请检查格式');
      return;
    }
    const currentOptionsCount = (draft.options ?? []).length;
    if (currentOptionsCount > 0) {
      if (
        !window.confirm(
          `当前已有 ${currentOptionsCount} 个选项，将被解析出的 ${parsed.length} 个选项覆盖。是否继续？`,
        )
      ) {
        return;
      }
    }
    const options = toDiceOptions(parsed, createOptionId);
    setDraft({ ...draft, kind: 'option', faces: options.length, options });
    setNgaText('');
    setNgaParsed([]);
    setNgaPanelOpen(false);
  };

  const handleSave = () => {
    // 选项骰子必须完整覆盖
    if (isOption && coverage && !coverage.ok) {
      const parts: string[] = [];
      if (coverage.missing.length > 0) {
        parts.push(`缺: ${compressValuesToDisplay(coverage.missing)}`);
      }
      if (coverage.overlaps.length > 0) {
        parts.push(`重复: ${compressValuesToDisplay(coverage.overlaps)}`);
      }
      setCoverageWarning(`覆盖校验失败（${parts.join('，')}）`);
      return;
    }

    // 数值骰子简单边界
    if (!isOption) {
      // 表达式模式验证
      if (draft.expression) {
        const validation = parseDiceExpression(draft.expression);
        if (!validation.ok) {
          setCoverageWarning(validation.error || '表达式无效');
          return;
        }
      } else {
        const count = Math.max(1, Math.min(NUMERIC_MAX_COUNT, Math.floor(draft.count ?? 1)));
        const nf = Math.max(1, Math.min(NUMERIC_MAX_FACES, Math.floor(draft.numericFaces ?? 6)));
        const mod = Math.floor(draft.modifier ?? 0);
        if (count !== draft.count || nf !== draft.numericFaces || mod !== draft.modifier) {
          setDraft({ ...draft, count, numericFaces: nf, modifier: mod });
        }
      }
    }

    const finalConfig: DiceConfig = JSON.parse(JSON.stringify(draft));
    const payload: DiceBlockPayloadV2 = {
      version: 2,
      config: finalConfig,
      lastResult: null,
      history: [],
    };

    if (targetBlockId) {
      onSaveEdit?.(targetBlockId, payload);
    } else {
      onSaveNew(payload);
    }
    closeDialog();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onMouseDown={(e) => {
        mouseDownOnOverlayRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (mouseDownOnOverlayRef.current && e.target === e.currentTarget) {
          closeDialog();
        }
        mouseDownOnOverlayRef.current = false;
      }}
    >
      <div
        className="w-[560px] max-h-[86vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🎲</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {targetBlockId ? '编辑骰子配置' : '新建骰子'}
            </span>
          </div>
          <button
            onClick={closeDialog}
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 骰子名称 */}
          <Field label="骰子名称">
            <input
              value={draft.name}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="给骰子起个名字，例如「命运抉择」"
              className="w-full px-3 py-2 text-xs rounded-md border outline-none"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
            />
          </Field>

          {/* 类型选择 */}
          <Field label="类型">
            <div className="flex items-center gap-2">
              <KindButton
                active={isOption}
                onClick={() => setDraftKind('option')}
                label="选项骰子"
                desc="自定义面数 + 选项命中"
              />
              <KindButton
                active={!isOption}
                onClick={() => setDraftKind('numeric')}
                label="数值骰子"
                desc={`NdM ± K（N≤${NUMERIC_MAX_COUNT}，M≤${NUMERIC_MAX_FACES}）`}
              />
            </div>
          </Field>

          {isOption ? (
            <>
              <details
                open={ngaPanelOpen}
                onToggle={(e) => setNgaPanelOpen((e.target as HTMLDetailsElement).open)}
                className="rounded-lg border"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-toolbar)' }}
              >
                <summary
                  className="px-3 py-2 text-xs cursor-pointer select-none font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  📋 通过 NGA 文本添加选项
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  <textarea
                    value={ngaText}
                    onChange={(e) => setNgaText(e.target.value)}
                    placeholder={`[b]16楼 橘响弦[/b]\n安价：克星血统 (...) [s:ac:哭笑]\n\n[b]23楼 uid:67074399[/b]\n安价：数据库\n...`}
                    rows={6}
                    className="w-full px-2 py-1.5 text-xs rounded-md border outline-none font-mono resize-y"
                    style={{
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      borderColor: 'var(--border-color)',
                      minHeight: 120,
                    }}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleParseNga}
                      disabled={!ngaText.trim()}
                      className="px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50"
                      style={{
                        background: 'var(--bg-card)',
                        borderColor: 'var(--border-color)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      🔍 解析
                    </button>
                    <button
                      onClick={handleConfirmImport}
                      disabled={!ngaText.trim() && ngaParsed.length === 0}
                      className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    >
                      ✓ 导入到选项
                    </button>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {ngaParsed.length > 0
                        ? `已解析 ${ngaParsed.length} 个选项`
                        : ngaText.trim()
                        ? '点击解析'
                        : '粘贴 NGA 安价文本'}
                    </span>
                  </div>
                  {ngaParsed.length > 0 && (
                    <div
                      className="rounded-md p-2 space-y-1 max-h-32 overflow-y-auto text-[11px]"
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      {ngaParsed.map((opt, i) => (
                        <div key={i} className="flex items-baseline gap-1.5">
                          <span style={{ color: 'var(--accent)' }}>{opt.displayValue}.</span>
                          <span style={{ color: 'var(--text-primary)' }}>{opt.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
              <OptionEditor
                faces={faces}
                options={draft.options ?? []}
                onFaces={(v) => setDraftFaces(v)}
                onAdd={addDraftOption}
                onRemove={removeDraftOption}
                onUpdateOption={updateDraftOption}
              />
            </>
          ) : (
            <NumericEditor
              count={draft.count ?? 1}
              faces={draft.numericFaces ?? 100}
              modifier={draft.modifier ?? 0}
              expression={draft.expression}
              onCount={setDraftCount}
              onFaces={setDraftNumericFaces}
              onModifier={setDraftModifier}
              onExpression={setDraftExpression}
            />
          )}

          {isOption && coverageWarning && (
            <div
              className="text-xs rounded-md px-3 py-2"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-soft)' }}
            >
              {coverageWarning}
            </div>
          )}
          {isOption && coverage && coverage.ok && (
            <div
              className="text-xs rounded-md px-3 py-2"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
            >
              ✓ 覆盖校验通过：1~{faces} 全部命中且无重复
            </div>
          )}
        </div>

        {/* 底部 */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
        >
          <button
            onClick={closeDialog}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {targetBlockId ? '保存修改' : '创建骰子'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------- 子组件 --------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function KindButton({
  active,
  onClick,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 text-left px-3 py-2 rounded-lg border transition-all"
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--bg-toolbar)',
        borderColor: active ? 'var(--accent)' : 'var(--border-color)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="text-xs font-semibold">{label}</div>
      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</div>
    </button>
  );
}

function OptionEditor({
  faces,
  options,
  onFaces,
  onAdd,
  onRemove,
  onUpdateOption,
}: {
  faces: number;
  options: import('../../types').DiceOptionValue[];
  onFaces: (n: number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdateOption: (
    id: string,
    patch: Partial<Omit<import('../../types').DiceOptionValue, 'id'>>,
  ) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label={`骰子面数（1 ~ ${faces}）`}>
        <input
          type="number"
          min={1}
          value={faces}
          onChange={(e) => onFaces(parseInt(e.target.value, 10) || 2)}
          className="w-32 px-3 py-2 text-xs rounded-md border outline-none"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
        />
      </Field>

      <div className="space-y-2">
        {options.map((opt) => (
          <div
            key={opt.id}
            className="flex items-start gap-2 p-2 rounded-lg border"
            style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
          >
            <input
              value={opt.displayValue}
              onChange={(e) => onUpdateOption(opt.id, { displayValue: e.target.value })}
              placeholder="值：1-3 / 2,4,6 / 5"
              className="w-36 shrink-0 px-2 py-1.5 text-xs rounded-md border outline-none font-mono"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
            />
            <input
              value={opt.content}
              onChange={(e) => onUpdateOption(opt.id, { content: e.target.value })}
              placeholder="选项内容，例如「去学校」"
              className="flex-1 px-2 py-1.5 text-xs rounded-md border outline-none"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
            />
            <button
              onClick={() => onRemove(opt.id)}
              className="shrink-0 w-7 h-7 rounded-md transition-colors text-xs"
              style={{ color: 'var(--text-secondary)' }}
              title="删除此选项"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={onAdd}
        className="w-full px-3 py-2 text-xs rounded-lg border border-dashed transition-colors"
        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        + 新增选项
      </button>
    </div>
  );
}

function NumericEditor({
  count,
  faces,
  modifier,
  expression,
  onCount,
  onFaces,
  onModifier,
  onExpression,
}: {
  count: number;
  faces: number;
  modifier: number;
  expression?: string;
  onCount: (n: number) => void;
  onFaces: (n: number) => void;
  onModifier: (n: number) => void;
  onExpression: (expr: string) => void;
}) {
  const [mode, setMode] = useState<'simple' | 'expression'>(expression ? 'expression' : 'simple');

  const formula = useMemo(() => {
    if (mode === 'expression' && expression) return expression;
    const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
    return `${count}d${faces}${mod}`;
  }, [mode, expression, count, faces, modifier]);

  const exprValidation = useMemo(() => {
    if (mode !== 'expression' || !expression) return null;
    return parseDiceExpression(expression);
  }, [mode, expression]);

  return (
    <div className="space-y-3">
      {/* 模式切换 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('simple')}
          className="px-3 py-1 text-xs rounded-md transition-colors"
          style={{
            background: mode === 'simple' ? 'var(--accent-bg)' : 'var(--bg-toolbar)',
            color: mode === 'simple' ? 'var(--accent)' : 'var(--text-secondary)',
            border: `1px solid ${mode === 'simple' ? 'var(--accent)' : 'var(--border-color)'}`,
          }}
        >
          简单模式
        </button>
        <button
          onClick={() => setMode('expression')}
          className="px-3 py-1 text-xs rounded-md transition-colors"
          style={{
            background: mode === 'expression' ? 'var(--accent-bg)' : 'var(--bg-toolbar)',
            color: mode === 'expression' ? 'var(--accent)' : 'var(--text-secondary)',
            border: `1px solid ${mode === 'expression' ? 'var(--accent)' : 'var(--border-color)'}`,
          }}
        >
          表达式模式
        </button>
      </div>

      {mode === 'simple' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label={`骰子数量（≤${NUMERIC_MAX_COUNT}）`}>
              <input
                type="number"
                min={1}
                max={NUMERIC_MAX_COUNT}
                value={count}
                onChange={(e) => onCount(parseInt(e.target.value, 10) || 1)}
                className="w-full px-2 py-2 text-xs rounded-md border outline-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
              />
            </Field>
            <Field label={`面数（≤${NUMERIC_MAX_FACES}）`}>
              <input
                type="number"
                min={1}
                max={NUMERIC_MAX_FACES}
                value={faces}
                onChange={(e) => onFaces(parseInt(e.target.value, 10) || 6)}
                className="w-full px-2 py-2 text-xs rounded-md border outline-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
              />
            </Field>
            <Field label="修正值（+/-）">
              <input
                type="number"
                value={modifier}
                onChange={(e) => onModifier(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-2 text-xs rounded-md border outline-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
              />
            </Field>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            结果将以 NGA 风格展示，例如 <span className="font-mono" style={{ color: 'var(--text-primary)' }}>[3D6=2+5+3=10]</span>
          </div>
        </>
      ) : (
        <>
          <Field label="骰子表达式">
            <input
              value={expression || ''}
              onChange={(e) => onExpression(e.target.value)}
              placeholder="例如：2*3d100+1d10-5"
              className="w-full px-3 py-2 text-sm font-mono rounded-md border outline-none"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
            />
          </Field>
          {exprValidation && exprValidation.ok && (
            <div
              className="text-xs rounded-md px-3 py-2"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
            >
              ✓ 解析成功：{exprValidation.preview}
            </div>
          )}
          {exprValidation && !exprValidation.ok && expression && (
            <div
              className="text-xs rounded-md px-3 py-2"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-soft)' }}
            >
              {exprValidation.error}
            </div>
          )}
          <details
            className="text-[11px] rounded-md px-3 py-2"
            style={{ background: 'var(--bg-toolbar)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
          >
            <summary
              className="cursor-pointer select-none font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              📖 表达式语法说明（点击展开）
            </summary>
            <div className="mt-2 space-y-2 leading-relaxed">
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>基础语法</div>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdM</span>：投掷 <span className="font-mono">N</span> 颗 <span className="font-mono">M</span> 面骰，每颗取值 1~M 概率均等；省略 N 默认 1（如 <span className="font-mono">d100</span> ≡ <span className="font-mono">1d100</span>）
                  </li>
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdM±K</span>：所有骰子点数之和 ± 固定常数 K
                  </li>
                  <li>多个骰子项可用 + - * / 连接，遵循常规运算优先级（乘除 &gt; 加减）</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>进阶语法</div>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdMkhX</span>：投 N 颗 M 面，<b>保留最高的 X 颗</b>求和（如 <span className="font-mono">4d6kh3</span> 投 4 颗 d6 取最大 3 颗）
                  </li>
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdMklX</span>：投 N 颗 M 面，<b>保留最低的 X 颗</b>求和（如 <span className="font-mono">5d10kl2</span>）
                  </li>
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdM!</span>：<b>爆炸骰</b>，单颗掷出最大值 M 时追加 1 颗同面骰，递归直到未掷出最大值（典型 <span className="font-mono">1d6!</span>）
                  </li>
                  <li>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>NdM&gt;=X</span>：<b>骰池计数</b>，统计点数 ≥ X 的骰子颗数，结果为<b>成功次数</b>而非点数（如 <span className="font-mono">6d10&gt;=7</span> 投 6 颗 d10 数 ≥7 的颗数）
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>示例</div>
                <div className="font-mono space-y-0.5 ml-1" style={{ color: 'var(--text-primary)' }}>
                  <div>2d6+3</div>
                  <div>4d6kh3</div>
                  <div>1d6!+2d6</div>
                  <div>6d10&gt;=7</div>
                  <div>3d10+2d10</div>
                </div>
              </div>
            </div>
          </details>
        </>
      )}

      {/* 格式预览 */}
      <Field label="格式预览">
        <div
          className="px-3 py-2 text-sm font-mono rounded-md border"
          style={{ background: 'var(--bg-toolbar)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
        >
          {formula}
        </div>
      </Field>
    </div>
  );
}

// 导出两个创建辅助，方便调用方一行打开"新建选项骰子"
export function openNewOptionDiceDialog(initialKind: DiceKind = 'option') {
  useDiceStore.getState().openDialog({
    draft: initialKind === 'numeric' ? createDefaultNumericDice() : createDefaultOptionDice(),
    initialKind,
  });
}
