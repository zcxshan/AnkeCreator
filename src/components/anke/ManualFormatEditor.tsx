import React from 'react';
import type {
  ManualFormatConfig,
  ManualVolumeConfig,
  ManualChapterConfig,
  ManualSectionConfig,
} from '../../utils/ankeCollect';

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
  borderRadius: 4,
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
  fontSize: 11,
  border: '1px dashed var(--accent)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
};

const deleteBtnStyle: React.CSSProperties = {
  height: 22,
  width: 22,
  padding: 0,
  fontSize: 12,
  border: '1px solid var(--danger)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--danger)',
  cursor: 'pointer',
  lineHeight: 1,
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: 8,
  marginBottom: 6,
  background: 'var(--bg-base)',
};

function genId(): string {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {value.volumes.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
          尚未添加卷，点击下方"添加卷"开始配置。
        </div>
      )}
      {value.volumes.map((vol, vi) => (
        <div key={vi} style={sectionStyle}>
          {/* 卷标题行 */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, minWidth: 36 }}>卷名</span>
            <input
              style={inputStyle}
              placeholder="如：和平解散"
              value={vol.title}
              onChange={(e) => updateVolume(vi, { ...vol, title: e.target.value })}
            />
            <button style={deleteBtnStyle} title="删除此卷" onClick={() => deleteVolume(vi)}>×</button>
          </div>
          {/* 章列表 */}
          <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vol.chapters.map((ch, ci) => (
              <div key={ci} style={{ ...sectionStyle, marginBottom: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, minWidth: 36 }}>章名</span>
                  <input
                    style={inputStyle}
                    placeholder="如：第一章"
                    value={ch.title}
                    onChange={(e) => updateChapter(vi, ci, { ...ch, title: e.target.value })}
                  />
                  <button style={deleteBtnStyle} title="删除此章" onClick={() => deleteChapter(vi, ci)}>×</button>
                </div>
                {/* 节列表 */}
                <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {ch.sections.map((sec, si) => (
                    <div key={si} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 30 }}>节名</span>
                      <input
                        style={inputStyle}
                        placeholder="如：第一集"
                        value={sec.title}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, title: e.target.value })}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>从</span>
                      <input
                        type="number"
                        style={numberInputStyle}
                        value={sec.startFloor}
                        min={1}
                        max={maxFloor}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, startFloor: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>楼到</span>
                      <input
                        type="number"
                        style={numberInputStyle}
                        value={sec.endFloor}
                        min={sec.startFloor}
                        max={maxFloor}
                        onChange={(e) => updateSection(vi, ci, si, { ...sec, endFloor: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>楼</span>
                      <button style={deleteBtnStyle} title="删除此节" onClick={() => deleteSection(vi, ci, si)}>×</button>
                    </div>
                  ))}
                  <button style={btnStyle} onClick={() => addSection(vi, ci)}>+ 添加节</button>
                </div>
              </div>
            ))}
            <button style={btnStyle} onClick={() => addChapter(vi)}>+ 添加章</button>
          </div>
        </div>
      ))}
      <button style={btnStyle} onClick={addVolume}>+ 添加卷</button>
      {maxFloor && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
          提示：当前帖子最高 {maxFloor} 楼，节楼号范围应在此区间内。
        </div>
      )}
    </div>
  );
}
