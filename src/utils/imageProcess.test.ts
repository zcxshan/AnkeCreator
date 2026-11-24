import { describe, expect, it } from 'vitest';
import {
  computeTargetSize,
  extForFormat,
  formatForMime,
  guessMimeFromName,
  mimeForFormat,
} from './imageProcess';

describe('computeTargetSize', () => {
  it('等比：给宽度推导高度', () => {
    expect(computeTargetSize(1000, 500, 400)).toEqual({ width: 400, height: 200 });
  });
  it('等比：给高度推导宽度', () => {
    expect(computeTargetSize(1000, 500, undefined, 100)).toEqual({ width: 200, height: 100 });
  });
  it('等比：都未给时保持原尺寸', () => {
    expect(computeTargetSize(320, 240)).toEqual({ width: 320, height: 240 });
  });
  it('非等比：宽高各自独立，缺失沿用原值', () => {
    expect(computeTargetSize(1000, 500, 300, undefined, false)).toEqual({ width: 300, height: 500 });
  });
  it('宽高至少为 1', () => {
    expect(computeTargetSize(1000, 500, 0, 0)).toEqual({ width: 1000, height: 500 });
  });
});

describe('格式映射', () => {
  it('mimeForFormat / extForFormat', () => {
    expect(mimeForFormat('png')).toBe('image/png');
    expect(mimeForFormat('jpeg')).toBe('image/jpeg');
    expect(mimeForFormat('webp')).toBe('image/webp');
    expect(extForFormat('jpeg')).toBe('jpg');
    expect(extForFormat('webp')).toBe('webp');
  });
  it('formatForMime', () => {
    expect(formatForMime('image/jpeg')).toBe('jpeg');
    expect(formatForMime('image/jpg')).toBe('jpeg');
    expect(formatForMime('image/webp')).toBe('webp');
    expect(formatForMime('image/gif')).toBe('png');
  });
  it('guessMimeFromName', () => {
    expect(guessMimeFromName('a.JPG')).toBe('image/jpeg');
    expect(guessMimeFromName('a.webp')).toBe('image/webp');
    expect(guessMimeFromName('a.png')).toBe('image/png');
  });
});
