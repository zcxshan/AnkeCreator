import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  NGA_SMILE_PACKS,
  smileImageUrl,
  type NgaSmile,
} from '../../types/ngaSmiles';

/**
 * NGA 风格表情选择面板。
 *
 * - 顶部：标题 + 关闭
 * - Tab：NGA 官方 7 个表情包 + 「自定义」
 * - 网格：点击表情回调 onPick(pack, face)，由调用方插入 [s:pack:face]
 *
 * 图片直接走 NGA 图床（Electron 侧有 Referer 钩子）；
 * Web/Android 若加载失败，用表情名文字块兜底，避免破图。
 */
interface SmileyPickerProps {
  /** 点击官方表情时回调（pack 为包 code，face 为表情名） */
  onPick: (pack: string, face: string) => void;
  onClose: () => void;
}

/** 自定义 Tab 的虚拟 code（不会作为 [s:] 的 pack 使用） */
const CUSTOM_TAB = '__custom__';

const panelStyle: React.CSSProperties = {
  width: 360,
  maxWidth: 'calc(100vw - 24px)',
  background: 'var(--an-card)',
  border: '2px solid var(--an-ink)',
  borderRadius: 'var(--an-radius-sm)',
  boxShadow: 'var(--an-shadow-pop), var(--an-shadow-soft)',
  overflow: 'hidden',
  userSelect: 'none',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  borderBottom: '1px solid var(--an-ink)',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--an-ink)',
};

const closeBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--an-ink)',
  cursor: 'pointer',
  lineHeight: 1,
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '6px 8px',
  overflowX: 'auto',
  borderBottom: '1px solid var(--an-ink)',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: '0 0 auto',
    padding: '2px 8px',
    fontSize: 11,
    lineHeight: 1.6,
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--an-ink)' : 'transparent'}`,
    background: active ? 'var(--an-pink)' : 'transparent',
    color: active ? '#fff' : 'var(--an-ink)',
    fontWeight: active ? 700 : 400,
    boxShadow: active ? '0 1px 0 var(--an-ink)' : 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(9, 1fr)',
  gap: 4,
  padding: 8,
  maxHeight: 240,
  overflowY: 'auto',
  alignContent: 'start',
};

const cellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  aspectRatio: '1 / 1',
  padding: 2,
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'var(--an-paper)',
  color: 'var(--an-ink)',
  cursor: 'pointer',
  overflow: 'hidden',
};

const customWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
};

const customInputStyle: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  fontSize: 12,
  border: '2px solid var(--an-ink)',
  borderRadius: 8,
  background: 'var(--an-paper)',
  color: 'var(--an-ink)',
  outline: 'none',
};

const customBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-end',
  padding: '3px 12px',
  fontSize: 12,
  fontWeight: 700,
  border: '2px solid var(--an-ink)',
  borderRadius: 999,
  background: 'var(--an-pink)',
  color: '#fff',
  boxShadow: '0 2px 0 var(--an-ink)',
  cursor: 'pointer',
};

/** 表情格：图片加载失败时退化为表情名文字，避免出现破图 */
function SmileCell({
  smile,
  onPick,
}: {
  smile: NgaSmile;
  onPick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={smile.name}
      aria-label={smile.name}
      // 阻止默认 mousedown，保持编辑器选区不丢失
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...cellStyle,
        ...(hover
          ? { borderColor: 'var(--an-ink)', background: 'var(--an-pink-soft)' }
          : {}),
      }}
    >
      {failed ? (
        <span style={{ fontSize: 10, lineHeight: 1.1, textAlign: 'center' }}>
          {smile.name}
        </span>
      ) : (
        <img
          src={smileImageUrl(smile.file)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />
      )}
    </button>
  );
}

export function SmileyPicker({ onPick, onClose }: SmileyPickerProps) {
  // 默认停在 AC娘(v1)：最常用的一组
  const [active, setActive] = useState('ac');
  const [customPack, setCustomPack] = useState('');
  const [customFace, setCustomFace] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);

  // 窄屏/靠右时把面板整体左移，避免被编辑器容器的 overflow-hidden 裁切
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    let dx = 0;
    if (rect.right > window.innerWidth - margin) {
      dx = window.innerWidth - margin - rect.right;
    }
    if (rect.left + dx < margin) {
      dx = margin - rect.left;
    }
    setShiftX(dx);
  }, []);

  const pack = useMemo(
    () => NGA_SMILE_PACKS.find((p) => p.code === active) ?? null,
    [active],
  );

  const handleCustomInsert = () => {
    const safePack = customPack.trim() || '表情包';
    const safeFace = customFace.trim() || '表情';
    onPick(safePack, safeFace);
    setCustomPack('');
    setCustomFace('');
  };

  return (
    <div
      ref={rootRef}
      style={{
        ...panelStyle,
        ...(shiftX ? { transform: `translateX(${shiftX}px)` } : {}),
      }}
    >
      <div style={headerStyle}>
        <span>插入表情</span>
        <button
          type="button"
          title="关闭"
          aria-label="关闭"
          style={closeBtnStyle}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div style={tabsStyle} role="tablist">
        {NGA_SMILE_PACKS.map((p) => (
          <button
            key={p.code}
            type="button"
            role="tab"
            aria-selected={active === p.code}
            style={tabStyle(active === p.code)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActive(p.code)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={active === CUSTOM_TAB}
          style={tabStyle(active === CUSTOM_TAB)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setActive(CUSTOM_TAB)}
        >
          自定义
        </button>
      </div>

      {active === CUSTOM_TAB ? (
        <div style={customWrapStyle}>
          <input
            autoFocus
            value={customPack}
            onChange={(e) => setCustomPack(e.target.value)}
            placeholder="表情包名（如 ac）"
            style={customInputStyle}
          />
          <input
            value={customFace}
            onChange={(e) => setCustomFace(e.target.value)}
            placeholder="表情名（如 哭笑）"
            style={customInputStyle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomInsert();
            }}
          />
          <button type="button" style={customBtnStyle} onClick={handleCustomInsert}>
            插入
          </button>
        </div>
      ) : (
        <div style={gridStyle} role="tabpanel">
          {pack?.smiles.map((smile) => (
            <SmileCell
              key={`${pack.code}-${smile.name}`}
              smile={smile}
              onPick={() => onPick(pack.code, smile.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
