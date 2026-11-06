import React, { useState } from 'react';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import type {
  ManualFormatConfig,
  ManualVolumeConfig,
  ManualChapterConfig,
  ManualSectionConfig,
} from '../../utils/ankeCollect';
import { parseSectionText } from '../../utils/parseSectionText';

interface ManualFormatEditorProps {
  value: ManualFormatConfig;
  onChange: (v: ManualFormatConfig) => void;
  maxFloor?: number;
}

const inputStyle: React.CSSProperties = {
  height: 26,
  padding: '0 6px',
  fontSize: 12,
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  outline: 'none',
  flex: 1,
  minWidth: 60,
};

const numberInputStyle: React.CSSProperties = {
  ...inputStyle,
  maxWidth: 70,
  minWidth: 50,
};

const btnStyle: React.CSSProperties = {
  height: 24,
  padding: '0 8px',
  fontSize: 12,
  border: '1px dashed var(--accent)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
};

const parseBtnStyle: React.CSSProperties = {
  ...btnStyle,
  border: '1px dashed var(--text-secondary)',
  color: 'var(--text-secondary)',
};

const deleteBtnStyle: React.CSSProperties = {
  height: 22,
  width: 22,
  padding: 0,
  fontSize: 12,
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--danger)',
  cursor: 'pointer',
  lineHeight: 1,
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  marginBottom: 6,
  background: 'var(--bg-base)',
};

function emptySection(): ManualSectionConfig {
  return { title: '', startFloor: 1, endFloor: 1 };
}
function emptyChapter(): ManualChapterConfig {
  return { title: '', sections: [emptySection()] };
}
function emptyVolume(): ManualVolumeConfig {
  return { title: '', chapters: [emptyChapter()] };
}

export function ManualFormatEditor({ value, onChange, maxFloor }: ManualFormatEditorProps) {
  // 解析文本弹窗状态：targetChapterKey = `${vi}-${ci}` 唯一标识当前编辑的章
  const [parseModalOpen, setParseModalOpen] = useState(false);
  const [parseModalChapterKey, setParseModalChapterKey] = useState<string | null>(null);
  const [parseText, setParseText] = useState('');
  const [parseError, setParseError] = useState('');

  const updateVolume = (vi: number, vol: ManualVolumeConfig) => {
    const volumes = value.volumes.slice();
    volumes[vi] = vol;
    onChange({ ...value, volumes });
  };
  const updateChapter = (vi: number, ci: number, ch: ManualChapterConfig) => {
    const vol = value.volumes[vi];
    const chapters = vol.chapters.slice();
    chapters[ci] = ch;
    updateVolume(vi, { ...vol, chapters });
  };
  const updateSection = (vi: number, ci: number, si: number, sec: ManualSectionConfig) => {
    const ch = value.volumes[vi].chapters[ci];
    const sections = ch.sections.slice();
    sections[si] = sec;
    updateChapter(vi, ci, { ...ch, sections });
  };

  const addVolume = () => {
    onChange({ ...value, volumes: [...value.volumes, emptyVolume()] });
  };
  const addChapter = (vi: number) => {
    const vol = value.volumes[vi];
    updateVolume(vi, { ...vol, chapters: [...vol.chapters, emptyChapter()] });
  };
  const addSection = (vi: number, ci: number) => {
    const ch = value.volumes[vi].chapters[ci];
    updateChapter(vi, ci, { ...ch, sections: [...ch.sections, emptySection()] });
  };

  const deleteVolume = (vi: number) => {
    onChange({ ...value, volumes: value.volumes.filter((_, i) => i !== vi) });
  };
  const deleteChapter = (vi: number, ci: number) => {
    const vol = value.volumes[vi];
    updateVolume(vi, { ...vol, chapters: vol.chapters.filter((_, i) => i !== ci) });
  };
  const deleteSection = (vi: number, ci: number, si: number) => {
    const ch = value.volumes[vi].chapters[ci];
    updateChapter(vi, ci, { ...ch, sections: ch.sections.filter((_, i) => i !== si) });
  };

  // 打开解析文本弹窗
  const openParseModal = (vi: number, ci: number) => {
    setParseModalChapterKey(`${vi}-${ci}`);
    setParseText('');
    setParseError('');
    setParseModalOpen(true);
  };

  const handleCancelParse = () => {
    setParseModalOpen(false);
    setParseModalChapterKey(null);
    setParseText('');
    setParseError('');
  };

  // 点击解析按钮：调用 parseSectionText，成功后替换该章的现有节结构
  const handleParse = () => {
    if (!parseModalChapterKey) return;
    const [viStr, ciStr] = parseModalChapterKey.split('-');
    const vi = parseInt(viStr, 10);
    const ci = parseInt(ciStr, 10);

    const effectiveMaxFloor = Number.isFinite(maxFloor) && maxFloor! > 0 ? maxFloor! : 9999;
    const result = parseSectionText(parseText, effectiveMaxFloor);
    if (!result.ok || !result.sections) {
      setParseError(result.error || '解析失败');
      return;
    }

    // 替换该章的现有节结构（按用户确认：替换现有节）
    const ch = value.volumes[vi]?.chapters?.[ci];
    if (!ch) {
      setParseError('找不到目标章');
      return;
    }
    updateChapter(vi, ci, { ...ch, sections: result.sections });
    setParseModalOpen(false);
    setParseModalChapterKey(null);
    setParseText('');
    setParseError('');
  };

  return (
    <div className="flex flex-col gap-[6px] mt-[6px]">
      {value.volumes.length === 0 && (
        <div className="text-[12px] text-[var(--text-secondary)] py-[8px] px-[0px]">
          尚未添加卷，点击下方"添加卷"开始配置。
        </div>
      )}
      {value.volumes.map((vol, vi) => (
        <div key={vi} style={sectionStyle}>
          {/* 卷标题行 */}
          <div className="flex gap-[6px] items-center mb-[6px]">
            <span className="text-[12px] text-[var(--accent)] font-semibold min-w-[36px]">卷名</span>
            <input
              style={inputStyle}
              placeholder="如：和平解散"
              value={vol.title}
              onChange={(e) => updateVolume(vi, { ...vol, title: e.target.value })}
            />
            <button style={deleteBtnStyle} title="删除此卷" onClick={() => deleteVolume(vi)}>×</button>
          </div>
          {/* 章列表 */}
          <div className="pl-[12px] flex flex-col gap-[6px]">
            {vol.chapters.map((ch, ci) => (
              <div key={ci} style={{ ...sectionStyle, marginBottom: 0 }}>
                <div className="flex gap-[6px] items-center mb-[6px]">
                  <span className="text-[12px] text-[var(--accent)] font-semibold min-w-[36px]">章名</span>
                  <input
                    style={inputStyle}
                    placeholder="如：第一章"
                    value={ch.title}
                    onChange={(e) => updateChapter(vi, ci, { ...ch, title: e.target.value })}
                  />
                  <button style={deleteBtnStyle} title="删除此章" onClick={() => deleteChapter(vi, ci)}>×</button>
                </div>
                {/* 节列表 */}
                <div className="pl-[12px] flex flex-col gap-[4px]">
                  {ch.sections.map((sec, si) => (
                    <div key={si} className="flex gap-[6px] items-center flex-wrap">
                      <span className="text-[12px] text-[var(--text-secondary)] min-w-[30px]">节名</span>
                      <input
                        style={inputStyle}
                        placeholder="如：第一集"
                        value={sec.title}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, title: e.target.value })}
                      />
                      <span className="text-[12px] text-[var(--text-secondary)]">从</span>
                      <input
                        type="number"
                        style={numberInputStyle}
                        value={sec.startFloor}
                        min={1}
                        max={maxFloor}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, startFloor: Number(e.target.value) })}
                      />
                      <span className="text-[12px] text-[var(--text-secondary)]">楼到</span>
                      <input
                        type="number"
                        style={numberInputStyle}
                        value={sec.endFloor}
                        min={sec.startFloor}
                        max={maxFloor}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, endFloor: Number(e.target.value) })}
                      />
                      <span className="text-[12px] text-[var(--text-secondary)]">楼</span>
                      <button style={deleteBtnStyle} title="删除此节" onClick={() => deleteSection(vi, ci, si)}>×</button>
                    </div>
                  ))}
                  <div className="flex gap-[6px] flex-wrap">
                    <button style={btnStyle} onClick={() => addSection(vi, ci)}>+ 添加节</button>
                    <button
                      style={parseBtnStyle}
                      onClick={() => openParseModal(vi, ci)}
                      title="按文本批量生成节结构（替换现有节）"
                    >
                      <span className="inline-flex items-center gap-1"><Icon name="clipboard" size={12} /> 解析文本</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button style={btnStyle} onClick={() => addChapter(vi)}>+ 添加章</button>
          </div>
        </div>
      ))}
      <button style={btnStyle} onClick={addVolume}>+ 添加卷</button>
      {maxFloor && (
        <div className="text-[12px] text-[var(--text-secondary)] mt-[4px]">
          提示：当前帖子最高 {maxFloor} 楼，节楼号范围应在此区间内。
        </div>
      )}

      {/* 解析文本弹窗 */}
      <Modal
        open={parseModalOpen && !!parseModalChapterKey}
        onClose={handleCancelParse}
        overlayStyle={{ animation: 'none' }}
        contentStyle={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-toolbar)',
          boxShadow: 'var(--shadow-modal)',
          padding: '20px 24px 16px',
          minWidth: 420,
          maxWidth: 560,
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animation: 'none',
        }}
      >
            <h3 className="m-[0px] text-[15px] font-semibold text-[var(--text-primary)]">
              解析文本生成节结构
            </h3>
            <div className="text-[12px] text-[var(--text-secondary)] leading-[1.6]">
              <div>请在下方输入节定义文本，每条用 <code>;</code> 或 <code>；</code> 分隔。中英文标点均可。</div>
              <div className="mt-[4px]">
                格式：<code>节名：起始楼层，终止楼层；</code> 或 <code>节名：起始楼层；</code>
              </div>
              <div className="mt-[4px] text-[var(--text-muted)]">
                示例：<code>第一节：1，10；第二节：11，20；第三节：21；</code>
              </div>
              <div className="mt-[4px] text-[var(--text-muted)]">
                未指定终止楼层时：非最后一节取下一节起始楼层减一；最后一节取表单填写的终止楼层
                {maxFloor ? `（当前 ${maxFloor}）` : ''}。
              </div>
              <div className="mt-[4px] text-[var(--danger)]">
                注意：解析成功后会替换该章现有的所有节。
              </div>
            </div>
            <textarea
              value={parseText}
              onChange={(e) => {
                setParseText(e.target.value);
                if (parseError) setParseError('');
              }}
              placeholder="节名1：起始楼层1，终止楼层1；节名2：起始楼层2；节名3：起始楼层3，终止楼层3；"
              autoFocus
              style={{
                width: '100%',
                minHeight: 120,
                padding: '8px 10px',
                fontSize: 13,
                lineHeight: 1.5,
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {parseError && (
              <div
                className="text-[12px] text-[var(--danger)] bg-[var(--danger-soft)] py-[6px] px-[10px] rounded-[var(--radius-sm)] border border-[color:var(--danger)]"
              >
                {parseError}
              </div>
            )}
            <div className="flex justify-end gap-[8px] mt-[4px]">
              <button
                onClick={handleCancelParse}
                className="h-[30px] py-[0px] px-[16px] text-[13px] rounded-[var(--radius-control)] border border-[color:var(--border-color)] bg-transparent text-[var(--text-primary)] cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleParse}
                className="h-[30px] py-[0px] px-[16px] text-[13px] rounded-[var(--radius-control)] border border-[color:var(--accent)] bg-[var(--accent)] text-[var(--bg-base)] cursor-pointer font-medium"
              >
                解析
              </button>
            </div>
      </Modal>
    </div>
  );
}
