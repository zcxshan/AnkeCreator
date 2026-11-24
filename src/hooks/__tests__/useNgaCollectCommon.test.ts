import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNgaCollectCommon } from '../useNgaCollectCommon';

describe('useNgaCollectCommon 默认楼层', () => {
  it('默认起始楼层为 0（NGA 含 0 楼）', () => {
    const { result } = renderHook(() => useNgaCollectCommon({ mode: 'anjia', active: false }));
    expect(result.current.startFloor).toBe('0');
  });
});
