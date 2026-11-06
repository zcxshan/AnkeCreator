import { useEffect, useRef, useState } from 'react';
import { useSettingStore, type ImageStoreMode } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import { isElectron } from '../../utils/platform';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { askConfirm } from './confirmPrompt';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 设置弹窗
 * - 图片存储模式：远端图床 / 本地保存
 * - 远端：catbox / sm.ms / 0x0.st / telegra.ph 兜底链（需要联网）
 * - 本地：保存到 [安装路径]/data/images/，通过 local:// 协议访问；NGA 导出时占位符
 *   （dev 模式：%APPDATA%\com.shanshian.ankecreator\images\）
 * - NGA 登录态：粘贴 Cookie 后可访问登录受限帖子
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const mode = useSettingStore((s) => s.imageStoreMode);
  const setMode = useSettingStore((s) => s.setImageStoreMode);
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const setLocalUploadEnabled = useSettingStore((s) => s.setLocalUploadEnabled);
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const setNgaCookies = useSettingStore((s) => s.setNgaCookies);
  const clearNgaCookies = useSettingStore((s) => s.clearNgaCookies);
  const soundEnabled = useSettingStore((s) => s.soundEnabled);
  const setSoundEnabled = useSettingStore((s) => s.setSoundEnabled);
  const diceSoundName = useSettingStore((s) => s.diceSoundName);
  const setDiceSoundName = useSettingStore((s) => s.setDiceSoundName);
  const availableDiceSounds = useSettingStore((s) => s.availableDiceSounds);
  const showToast = useToastStore((s) => s.showToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cookieDraft, setCookieDraft] = useState('');
  const [ngaLoggingIn, setNgaLoggingIn] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // 重新扫描音效列表（上传/删除后调用）
  const refreshSounds = async () => {
    if (!isElectron || !window.electronAPI?.listDiceSounds) return;
    try {
      const list = await window.electronAPI.listDiceSounds();
      useSettingStore.getState().setAvailableDiceSounds(list);
    } catch (e) {
      console.error('刷新音效列表失败:', e);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 清空 value，允许选同一文件
    e.target.value = '';
    if (!file) return;
    if (!isElectron || !window.electronAPI?.uploadDiceSound) {
      showToast('上传音效仅在桌面端支持', 'error');
      return;
    }
    if (!/\.mp3$/i.test(file.name)) {
      showToast('仅支持 .mp3 格式', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(`文件过大（限制 5MB，当前 ${(file.size / 1024 / 1024).toFixed(2)}MB）`, 'error');
      return;
    }
    try {
      // FileReader 读为 base64（去掉 data URL 前缀）
      const buffer = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await window.electronAPI.uploadDiceSound({
        filename: file.name,
        buffer,
        mimeType: 'audio/mpeg',
      });
      if (res.ok) {
        showToast(`已上传：${res.name || file.name}`, 'success');
        await refreshSounds();
      } else {
        showToast(`上传失败：${res.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      showToast(`读取文件失败：${(err as Error)?.message || err}`, 'error');
    }
  };

  const handleDeleteSound = async (name: string) => {
    if (!isElectron || !window.electronAPI?.deleteDiceSound) return;
    if (name.toLowerCase() === 'dice-roll.mp3') {
      showToast('内置音效不可删除', 'error');
      return;
    }
    const confirmed = await askConfirm({
      title: '删除音效',
      message: `确定删除「${name}」？\n此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await window.electronAPI.deleteDiceSound(name);
      if (res.ok) {
        showToast(`已删除：${name}`, 'success');
        // 如果删除的是当前选中的，回退到 dice-roll.mp3
        if (useSettingStore.getState().diceSoundName === name) {
          useSettingStore.getState().setDiceSoundName('dice-roll.mp3');
        }
        await refreshSounds();
      } else {
        showToast(`删除失败：${res.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      showToast(`删除失败：${(err as Error)?.message || err}`, 'error');
    }
  };

  // 打开弹窗时初始化 cookie 输入框
  useEffect(() => {
    if (open) {
      setCookieDraft(ngaCookies);
    }
  }, [open, ngaCookies]);

  const handleModeChange = (next: ImageStoreMode) => {
    setMode(next);
  };

  // ===== 数据目录 + 自动快照 =====
  const [dataInfo, setDataInfo] = useState<{
    dataDir: string;
    defaultDataDir?: string;
    custom?: boolean;
    fallback: boolean;
    snapshots: Array<{ name: string; createdAt: string; storyFiles: number; sectionFiles: number; totalBytes: number }>;
  } | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  const refreshDataInfo = async () => {
    if (!isElectron || !window.electronAPI?.getDataInfo) return;
    try {
      const res = await window.electronAPI.getDataInfo();
      if (res?.ok) {
        setDataInfo({
          dataDir: res.dataDir || '',
          defaultDataDir: res.defaultDataDir || '',
          custom: !!res.custom,
          fallback: !!res.fallback,
          snapshots: res.snapshots || [],
        });
      }
    } catch (e) {
      console.error('读取数据目录信息失败:', e);
    }
  };

  useEffect(() => {
    if (open && isElectron) {
      void refreshDataInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenDataDir = async () => {
    if (!isElectron || !window.electronAPI?.openDataDirectory) {
      showToast('打开数据目录仅在桌面端支持', 'error');
      return;
    }
    try {
      const res = await window.electronAPI.openDataDirectory();
      if (!res?.ok) showToast(`打开失败：${res?.error || '未知错误'}`, 'error');
    } catch (e) {
      showToast(`打开失败：${(e as Error).message}`, 'error');
    }
  };

  const handleMigrateDataDir = async () => {
    if (!isElectron || !window.electronAPI?.pickDataDir || !window.electronAPI?.migrateDataDir) {
      showToast('迁移数据目录仅在桌面端支持', 'error');
      return;
    }
    try {
      const picked = await window.electronAPI.pickDataDir();
      if (!picked?.ok || !picked.dir) {
        if (!picked?.canceled) showToast(`选择目录失败：${picked?.error || '未知错误'}`, 'error');
        return;
      }
      const confirmed = await askConfirm({
        title: '迁移数据目录',
        message:
          `将把当前全部数据复制到：\n${picked.dir}\n\n` +
          '目标目录必须为空。迁移完成后应用会自动重启，原目录数据会保留作为备份，可确认无误后手动删除。',
        confirmText: '迁移并重启',
        danger: true,
      });
      if (!confirmed) return;
      setSnapshotBusy(true);
      const res = await window.electronAPI.migrateDataDir(picked.dir);
      if (res?.ok) {
        showToast('迁移完成，应用即将重启…', 'success');
      } else {
        showToast(`迁移失败：${res?.error || '未知错误'}`, 'error');
        setSnapshotBusy(false);
      }
    } catch (e) {
      showToast(`迁移失败：${(e as Error).message}`, 'error');
      setSnapshotBusy(false);
    }
  };

  const handleCreateSnapshot = async () => {
    if (!isElectron || !window.electronAPI?.createSnapshot) {
      showToast('备份仅在桌面端支持', 'error');
      return;
    }
    setSnapshotBusy(true);
    try {
      const res = await window.electronAPI.createSnapshot();
      if (res?.ok) {
        showToast('已创建快照', 'success');
        await refreshDataInfo();
      } else {
        showToast(`创建快照失败：${res?.error || '未知错误'}`, 'error');
      }
    } catch (e) {
      showToast(`创建快照失败：${(e as Error).message}`, 'error');
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleRestoreSnapshot = async (name: string) => {
    if (!isElectron || !window.electronAPI?.restoreSnapshot) return;
    const confirmed = await askConfirm({
      title: '恢复快照',
      message:
        `将用快照「${name}」覆盖当前所有作品与正文。\n\n` +
        '恢复前会自动把当前数据备份到 data/backup/。恢复完成后应用会自动重启。',
      confirmText: '恢复并重启',
      danger: true,
    });
    if (!confirmed) return;
    setSnapshotBusy(true);
    try {
      const res = await window.electronAPI.restoreSnapshot(name);
      if (res?.ok) {
        showToast('已恢复快照，应用即将重启…', 'success');
      } else {
        showToast(`恢复失败：${res?.error || '未知错误'}`, 'error');
        setSnapshotBusy(false);
      }
    } catch (e) {
      showToast(`恢复失败：${(e as Error).message}`, 'error');
      setSnapshotBusy(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      initialFocusRef={closeBtnRef}
      labelledBy="settings-dialog-title"
      contentClassName="w-[min(90vw,520px)] max-h-[85vh] flex flex-col overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ background: 'var(--an-pink-soft)', borderBottom: 'var(--an-line)' }}
      >
        <h3
          id="settings-dialog-title"
          className="m-0 text-[16px] font-bold flex items-center gap-2"
          style={{ fontFamily: 'var(--an-font-display)', color: 'var(--an-ink)' }}
        >
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full"
            style={{ background: 'var(--an-pink)', border: '2px solid var(--an-ink)' }}
          >
            <Icon name="settings" size={13} />
          </span>
          设置
        </h3>
        <button
          aria-label="关闭"
          onClick={onClose}
          ref={closeBtnRef}
          className="an-btn an-btn--sm w-8 h-8 !p-0 flex items-center justify-center"
          title="关闭"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* 内容区（可滚动） */}
      <div className="flex-1 overflow-y-auto px-6 pt-1 pb-2">
        {/* 分组：图片存储模式 */}
        <Section title="图片存储模式">
          {/* 本地上传总开关（统一控制 4 个上传入口） */}
          <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2.5 border-b border-dashed border-[var(--border-color)] mb-2.5">
            <ToggleSwitch
              label="启用本地上传"
              checked={localUploadEnabled}
              onChange={setLocalUploadEnabled}
            />
            <span className={`text-[12px] ${localUploadEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {localUploadEnabled ? '已开启' : '默认关闭'}
            </span>
            <span className="text-[12px] text-[var(--text-muted)] ml-auto">
              控制编辑器/角色/模板页的本地上传
            </span>
          </div>

          <RadioRow
            label="本地保存"
            description="保存到本地 安装路径/data/images/，通过 local:// 协议访问。无需联网；NGA 导出时自动替换为占位符。需先在上方开启「本地上传」开关。"
            checked={mode === 'local'}
            onChange={() => handleModeChange('local')}
            disabled={!localUploadEnabled}
          />
          {mode === 'local' && (
            <div className="px-1.5 pt-1 pb-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
              本地模式保存的图片（local:// 协议）在 NGA 论坛
              <b className="text-[var(--danger)]">无法被识别</b>
              ，导出时自动替换为占位符
              <br />
              远端图床（uguu.se 等）有
              <b className="text-[var(--danger)]">时限限制</b>
              ，图片可能在数月/数年后失效
              <br />
              推荐：把图片上传到 NGA 后，复制 NGA 的图片 URL 直接粘贴到编辑器
            </div>
          )}
          {/* 重置图片警告标记（用户曾勾「不再提示」时可恢复） */}
          {mode === 'local' && (
            <div className="px-1.5 pt-1 pb-2 flex items-center gap-2">
              <SettingsBtn
                variant="ghost"
                onClick={() => {
                  try {
                    localStorage.removeItem('anke-creator-image-warning-dismissed');
                    useToastStore.getState().showToast('已重置图片警告，下次本地上传会重新提示', 'success');
                  } catch {
                    useToastStore.getState().showToast('重置失败', 'error');
                  }
                }}
                title="清除 anke-creator-image-warning-dismissed 标记，下次本地上传重新弹警告"
              >
                <span className="inline-flex items-center gap-1"><Icon name="refresh" size={13} /> 重置图片警告</span>
              </SettingsBtn>
              <span className="text-[12px] text-[var(--text-muted)]">
                如果之前勾过「不再提示」，点此恢复
              </span>
            </div>
          )}
        </Section>

        {/* 分组：音效 */}
        <Section title="音效">
          <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2.5 border-b border-dashed border-[var(--border-color)] mb-2.5">
            <ToggleSwitch
              label={<span className="inline-flex items-center gap-1.5"><Icon name="volume" size={14} /> 启用掷骰音效</span>}
              checked={soundEnabled}
              onChange={setSoundEnabled}
            />
            <span className={`text-[12px] ${soundEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {soundEnabled ? '已开启' : '已关闭'}
            </span>
            <span className="text-[12px] text-[var(--text-muted)] ml-auto">
              关闭后掷骰不再发出声音
            </span>
          </div>

          {/* 音效选择器 + 上传/删除 */}
          <div className="flex items-center gap-2.5 flex-wrap px-1.5 pt-1 pb-1.5">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              <span className="inline-flex items-center gap-1.5"><Icon name="music" size={14} /> 音效选择</span>
            </span>
            <select
              value={diceSoundName}
              onChange={(e) => setDiceSoundName(e.target.value)}
              disabled={!soundEnabled}
              className={`text-xs px-2 py-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] ${soundEnabled ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-50'}`}
            >
              {availableDiceSounds.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <SettingsBtn
              variant="primary"
              onClick={handleUploadClick}
              disabled={!isElectron}
              title={isElectron ? '选择本地 mp3 文件上传' : '上传音效仅在桌面端支持'}
            >
              <span className="inline-flex items-center gap-1"><Icon name="upload" size={13} /> 上传 mp3</span>
            </SettingsBtn>
            {diceSoundName.toLowerCase() !== 'dice-roll.mp3' && (
              <SettingsBtn
                variant="ghost"
                onClick={() => handleDeleteSound(diceSoundName)}
                title="删除当前选中的音效"
              >
                <span className="inline-flex items-center gap-1"><Icon name="trash" size={13} /> 删除当前</span>
              </SettingsBtn>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,audio/mpeg"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>
          {/* 已加载音效列表（带删除按钮） */}
          {isElectron && availableDiceSounds.length > 0 && (
            <div className="px-1.5 pb-2.5 max-h-[140px] overflow-y-auto">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">
                已加载 {availableDiceSounds.length} 个音效（点击切换，右侧删除用户上传的）
              </div>
              <div className="flex flex-col gap-0.5">
                {availableDiceSounds.map((name) => {
                  const isBuiltin = name.toLowerCase() === 'dice-roll.mp3';
                  const isSelected = name === diceSoundName;
                  return (
                    <div
                      key={name}
                      className={`flex items-center gap-1.5 px-1.5 py-[3px] rounded-[var(--radius-sm)] text-[12px] ${isSelected ? 'bg-[var(--accent-bg)]' : 'bg-transparent'}`}
                    >
                      <button
                        onClick={() => setDiceSoundName(name)}
                        disabled={!soundEnabled}
                        className={`flex-1 text-left bg-transparent border-0 p-0 text-[12px] overflow-hidden text-ellipsis whitespace-nowrap ${soundEnabled ? 'cursor-pointer' : 'cursor-not-allowed'} ${isSelected ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-primary)] font-normal'}`}
                      >
                        {isSelected ? <Icon name="play" size={10} className="inline-block align-[-1px] mr-1" /> : <span className="inline-block w-[10px] mr-1" />}{name}
                        {isBuiltin && <span className="text-[var(--text-muted)] text-[12px] ml-1">(内置)</span>}
                      </button>
                      {!isBuiltin && (
                        <button
                          aria-label="删除"
                          onClick={() => handleDeleteSound(name)}
                          title={`删除 ${name}`}
                          className="text-[12px] px-1.5 py-px border border-[var(--border-color)] rounded-[var(--radius-chip)] bg-transparent cursor-pointer text-[var(--danger)]"
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="text-[12px] text-[var(--text-muted)] px-1.5 pb-2.5 leading-relaxed">
            上传的 mp3 存于本地数据目录 <code className="bg-[var(--bg-hover)] px-1 rounded-[var(--radius-chip)]">sounds/</code> 子目录，重启应用后保留。
            <br />
            仅支持 .mp3 格式，文件 ≤ 5MB，内置 dice-roll.mp3 不可覆盖/删除。
          </div>
        </Section>

        {/* 分组：数据目录与快照备份 */}
        <Section title="数据目录与备份">
          {!isElectron ? (
            <div className="px-1.5 pt-1 text-[12px] text-[var(--text-secondary)]">
              浏览器模式的数据保存在本机 IndexedDB 中，快照备份仅在桌面端可用。
            </div>
          ) : (
            <>
              <div className="px-1.5 pt-1 pb-2.5 border-b border-dashed border-[var(--border-color)]">
                <div className="text-[12px] text-[var(--text-secondary)] mb-1.5">
                  当前数据目录（作品、正文、图片、模板都在这里）：
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code
                    className="flex-1 min-w-[220px] px-2 py-[5px] text-[12px] font-mono bg-[var(--bg-input)] border border-[var(--border-color)] rounded-[var(--radius-sm)] text-[var(--text-primary)] break-all"
                    title={dataInfo?.dataDir || ''}
                  >
                    {dataInfo?.dataDir || '读取中…'}
                  </code>
                  <SettingsBtn variant="ghost" onClick={handleOpenDataDir}>
                    <span className="inline-flex items-center gap-1"><Icon name="folder" size={13} /> 打开目录</span>
                  </SettingsBtn>
                  <SettingsBtn
                    variant="ghost"
                    onClick={handleMigrateDataDir}
                    disabled={snapshotBusy}
                  >
                    <span className="inline-flex items-center gap-1"><Icon name="arrowLeftRight" size={13} /> 迁移位置…</span>
                  </SettingsBtn>
                </div>
                {dataInfo?.custom && (
                  <div className="mt-2 px-2 py-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-input)] rounded-[var(--radius-sm)]">
                    当前使用自定义数据目录。默认位置：{dataInfo.defaultDataDir || '—'}
                  </div>
                )}
                {dataInfo?.fallback && (
                  <div className="mt-2 px-2 py-1.5 text-[12px] leading-relaxed text-[var(--warning)] bg-[var(--tone-warn-soft)] rounded-[var(--radius-sm)]">
                    安装目录无写权限，数据已自动回退到 %APPDATA% 目录。迁移或备份时请以上方路径为准。
                  </div>
                )}
              </div>

              <div className="px-1.5 pt-2.5 pb-1.5">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    自动快照
                  </span>
                  <span className="text-[12px] text-[var(--text-muted)]">
                    每日启动自动备份，保留最近 7 份
                  </span>
                  <SettingsBtn
                    variant="primary"
                    onClick={handleCreateSnapshot}
                    disabled={snapshotBusy}
                    className="ml-auto"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icon name="save" size={13} /> {snapshotBusy ? '处理中…' : '立即备份'}
                    </span>
                  </SettingsBtn>
                </div>

                {dataInfo && dataInfo.snapshots.length > 0 ? (
                  <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                    {dataInfo.snapshots.map((snap) => (
                      <div
                        key={snap.name}
                        className="flex items-center gap-2 px-2 py-[5px] rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-color)]"
                      >
                        <span className="text-[12px] text-[var(--text-primary)] flex-1">
                          {snap.name}
                        </span>
                        <span className="text-[12px] text-[var(--text-muted)]">
                          {snap.storyFiles} 作品 / {snap.sectionFiles} 正文 / {formatBytes(snap.totalBytes)}
                        </span>
                        <SettingsBtn
                          variant="ghost"
                          onClick={() => handleRestoreSnapshot(snap.name)}
                          disabled={snapshotBusy}
                          title={`恢复到 ${snap.name}`}
                        >
                          <span className="inline-flex items-center gap-1"><Icon name="refresh" size={12} /> 恢复</span>
                        </SettingsBtn>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] text-[var(--text-muted)] py-0.5 pb-1.5">
                    还没有快照。点「立即备份」创建一份，或下次启动时自动生成。
                  </div>
                )}
              </div>

              <div className="px-1.5 pt-1.5 pb-1 text-[12px] leading-relaxed text-[var(--text-muted)] border-t border-dashed border-[var(--border-color)]">
                <b>卸载行为：</b>应用卸载时会先询问「是否已导出重要数据」，确认后再询问「是否同时清空个人数据」。
                <br />
                <b>更新行为：</b>覆盖安装（更新版本）时，所有数据自动保留在原位置，无需重新导出。
                <br />
                如需彻底清空，请先「打开目录」并手动删除 <code className="bg-[var(--bg-input)] px-1 rounded-[var(--radius-chip)]">data/</code> 文件夹。
              </div>
            </>
          )}
        </Section>

        {/* 分组：NGA 登录态（可选） */}
        <Section title="NGA 登录态（可选）">
          <div>
            <div className="text-[12px] text-[var(--text-secondary)] mb-1.5 leading-normal">
              登录 NGA 后，可访问"饼干/扣扣"等登录受限内容，并可把安科正文直接发送到关联的帖子。
              <br />
              推荐使用应用内登录；也可手动粘贴浏览器 Cookie。
            </div>
            <div className="flex items-center gap-2 mb-2">
              <SettingsBtn
                variant="primary"
                onClick={async () => {
                  if (!isElectron || !window.electronAPI?.ngaLogin) {
                    showToast('应用内登录仅在桌面版可用，请手动粘贴 Cookie', 'error');
                    return;
                  }
                  setNgaLoggingIn(true);
                  try {
                    const res = await window.electronAPI.ngaLogin();
                    if (res?.cancelled) return;
                    if (!res?.ok || !res.cookie) {
                      showToast(res?.error || 'NGA 登录失败', 'error');
                      return;
                    }
                    setNgaCookies(res.cookie);
                    setCookieDraft(res.cookie);
                    showToast('NGA 登录成功', 'success');
                  } finally {
                    setNgaLoggingIn(false);
                  }
                }}
                disabled={ngaLoggingIn}
              >
                {ngaLoggingIn ? '登录中…' : '打开 NGA 登录窗口'}
              </SettingsBtn>
              {ngaCookies && (
                <span className="text-[12px] text-[var(--success)]">
                  <span className="inline-flex items-center gap-1"><Icon name="check" size={13} /> 已登录</span>
                </span>
              )}
            </div>
            <textarea
              rows={3}
              value={cookieDraft}
              onChange={(e) => setCookieDraft(e.target.value)}
              placeholder="ngaPassportCid=xxx; ngaPassportUid=xxx; ngaPassportToken=xxx"
              className="w-full px-2.5 py-2 text-[12px] font-mono rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] resize-y outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center gap-2 mt-2">
              <SettingsBtn
                variant="primary"
                onClick={() => {
                  if (cookieDraft === ngaCookies) return;
                  setNgaCookies(cookieDraft);
                }}
                disabled={cookieDraft === ngaCookies}
              >
                保存 Cookie
              </SettingsBtn>
              <SettingsBtn
                variant="ghost"
                onClick={() => {
                  if (!ngaCookies) return;
                  clearNgaCookies();
                  setCookieDraft('');
                  if (isElectron) void window.electronAPI?.ngaLogout?.();
                }}
                disabled={!ngaCookies}
              >
                退出登录
              </SettingsBtn>
              {ngaCookies && (
                <span className="text-[12px] text-[var(--success)]">
                  <span className="inline-flex items-center gap-1"><Icon name="check" size={13} /> 已配置</span>
                </span>
              )}
            </div>
          </div>
        </Section>
      </div>

      {/* 底部按钮 */}
      <div
        className="flex justify-end gap-2 px-5 py-3"
        style={{ background: 'var(--an-paper-2)', borderTop: 'var(--an-line)' }}
      >
        <SettingsBtn variant="primary" onClick={onClose}>
          完成
        </SettingsBtn>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-[18px]">
      <div
        className="inline-flex items-center text-[12px] font-bold mb-2 px-2.5 py-0.5 rounded-full"
        style={{
          fontFamily: 'var(--an-font-display)',
          color: 'var(--an-ink)',
          background: 'var(--an-lemon-soft)',
          border: '2px solid var(--an-ink)',
        }}
      >
        {title}
      </div>
      <div
        className="p-3.5 transition-colors"
        style={{
          background: 'var(--an-paper)',
          border: 'var(--an-line)',
          borderRadius: 'var(--an-radius-md)',
          boxShadow: 'var(--an-shadow-soft)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function RadioRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 px-2.5 py-2.5 pl-2 rounded-[var(--radius-sm)] transition-colors ${checked ? 'bg-[var(--accent-bg)] border-l-[3px] border-l-[color:var(--accent)]' : 'bg-transparent border-l-[3px] border-l-transparent'} ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${!disabled && !checked ? 'hover:bg-[var(--bg-hover)]' : ''}`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={disabled ? undefined : onChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">
          {label}
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] leading-normal mt-0.5">
          {description}
        </div>
      </div>
    </label>
  );
}

function SettingsBtn({ variant = 'ghost', onClick, children, title, className = '', disabled }: {
  variant?: 'primary' | 'danger' | 'ghost';
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  const variantStyle: React.CSSProperties = variant === 'primary'
    ? { background: 'var(--an-pink)', color: '#fff', borderColor: 'var(--an-ink)' }
    : variant === 'danger'
    ? { background: 'var(--an-pink-soft)', color: '#8a1f43', borderColor: 'var(--an-ink)' }
    : { background: 'var(--an-paper-2)', color: 'var(--an-ink)', borderColor: 'var(--an-ink)' };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{ ...variantStyle, borderRadius: 999, borderWidth: 2, borderStyle: 'solid', boxShadow: '0 2px 0 var(--an-ink)' }}
      className={`px-3.5 py-1.5 text-xs font-semibold transition-transform active:translate-y-[1px] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:-translate-y-[1px]'} ${className}`}
    >
      {children}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <span className="text-[13px] text-[var(--text-primary)]">{label}</span>
      <div
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-[var(--radius-toolbar)] relative transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-hover)]'}`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--text-on-accent)] transition-[left] shadow-[var(--shadow-md)] ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </div>
    </label>
  );
}
