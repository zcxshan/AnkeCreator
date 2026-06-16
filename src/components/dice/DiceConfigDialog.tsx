// ============================================================
// DiceConfigDialog - 骰子配置弹窗
// ------------------------------------------------------------
// 用于：
//   - 新建一个骰子块（选项/数值）
//   - 编辑已有骰子块的配置
// ============================================================

import { useEffect, useMemo, useState } from 'react';
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
} from '../../utils/diceEngine';

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

  useEffect(() => {
    setCoverageWarning(null);
  }, [open, draft?.kind, draft?.faces]);

  if (!open || !draft) return null;

  const isOption = draft.kind === 'option';

  const coverage = validateDraftCoverage();
  const faces = (draft.faces ?? 2) | 0;

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
      onClick={closeDialog}
    >
      <div
        className="w-[560px] max-h-[86vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
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
            <OptionEditor
              faces={faces}
              options={draft.options ?? []}
              onFaces={(v) => setDraftFaces(v)}
              onAdd={addDraftOption}
              onRemove={removeDraftOption}
              onUpdateOption={updateDraftOption}
            />
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
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            支持四则运算和括号，例如 <span className="font-mono" style={{ color: 'var(--text-primary)' }}>2*3d100</span>、<span className="font-mono" style={{ color: 'var(--text-primary)' }}>1d10+2d50</span>、<span className="font-mono" style={{ color: 'var(--text-primary)' }}>(1d6+2)*3</span>
          </div>
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
