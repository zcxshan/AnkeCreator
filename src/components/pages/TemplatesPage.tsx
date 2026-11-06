import { useEffect, useState, useRef } from 'react';
import { useMetaStore } from '../../store/metaStore';
import { useToastStore } from '../../store/toastStore';
import { Icon } from '../common/Icon';
import { CharacterTemplatesPanel } from '../templates/CharacterTemplatesPanel';

interface TemplatesPanelProps {
  onShowAuthor?: () => void;
}

/**
 * 人物模板面板：CRUD + 复制为草稿。
 * 原「设定模板（世界观）」已随设定备忘录一并移除，这里只保留人物模板。
 */
export function TemplatesPanel({ onShowAuthor }: TemplatesPanelProps) {
  const loadTemplates = useMetaStore((s) => s.loadTemplates);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // 模板加载三态：读取失败不能静默（否则用户只看到空模板库）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [characterSelectedIds, setCharacterSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadTemplates()
      .catch((err) => {
        if (!cancelled) {
          console.error('[TemplatesPanel] 加载模板失败:', err);
          setError((err as Error)?.message || String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTemplates, reloadKey]);

  // 导出选中的人物模板为 JSON 文件
  const handleExport = () => {
    const { characterTemplates } = useMetaStore.getState();
    const filteredChar = characterTemplates.filter((t) => characterSelectedIds.includes(t.id));
    if (filteredChar.length === 0) {
      useToastStore.getState().showToast(
        '请先勾选需要导出的模板（点击列表前的复选框）',
        'warning',
      );
      return;
    }
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      characterTemplates: filteredChar,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anke-character-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    useToastStore.getState().showToast(`已导出 ${filteredChar.length} 个人物模板`, 'success');
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') {
        useToastStore.getState().showToast('文件格式不正确', 'error');
        return;
      }
      // 旧版模板文件里的 worldSettingTemplates 会被 importTemplates 识别但忽略
      const result = await useMetaStore.getState().importTemplates(data);
      useToastStore.getState().showToast(
        `已导入 ${result.charCount} 个人物模板${result.failed > 0 ? `（失败 ${result.failed} 个）` : ''}`,
        result.failed > 0 ? 'warning' : 'success',
      );
    } catch (err) {
      useToastStore.getState().showToast(
        `导入失败：${(err as Error).message || '文件解析错误'}`,
        'error',
      );
    }
  };

  return (
    <div className="bg-[var(--bg-base)] text-[var(--text-primary)] min-h-full w-full flex flex-col">
      <header
        className="border-b border-b-[color:var(--border-color)] flex items-center justify-between px-6 py-3"
      >
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">人物模板</div>
          {onShowAuthor && (
            <button
              onClick={onShowAuthor}
              className="text-[var(--text-secondary)] text-xs transition-colors"
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              关于作者
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[var(--text-secondary)] text-xs">
            独立于具体作品，可被任意作品引用
          </div>
          <button
            onClick={handleExport}
            className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-xs px-3 py-1.5 rounded-md transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            title="先勾选模板，再点击导出"
          >
            <span className="inline-flex items-center gap-1"><Icon name="download" size={13} /> 导出模板</span>
          </button>
          <button
            onClick={handleImportClick}
            className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-xs px-3 py-1.5 rounded-md transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            title="从 JSON 文件导入模板"
          >
            <span className="inline-flex items-center gap-1"><Icon name="upload" size={13} /> 导入模板</span>
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error ? (
          <div
            role="alert"
            className="border border-[color:var(--tone-danger-border)] bg-[var(--tone-danger-veil)] rounded-xl px-6 py-8 text-center"
          >
            <div className="text-[var(--tone-danger)] flex justify-center mb-2">
              <Icon name="alert" size={28} />
            </div>
            <div className="text-[var(--text-primary)] text-sm font-medium">模板加载失败</div>
            <div className="text-[var(--text-secondary)] text-xs mt-1">{error}</div>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-4 inline-flex items-center gap-1 px-4 py-1.5 text-sm rounded-md bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)]"
            >
              <Icon name="refresh" size={13} /> 重新加载
            </button>
          </div>
        ) : loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center h-40 text-[var(--text-secondary)] text-sm"
          >
            正在加载模板…
          </div>
        ) : (
          <CharacterTemplatesPanel onSelectionChange={setCharacterSelectedIds} />
        )}
      </div>
    </div>
  );
}
