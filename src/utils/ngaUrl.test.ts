import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NGA_URL_CONFIG,
  buildNgaUrlCandidates,
  setNgaUrlConfigProvider,
} from './ngaUrl';

describe('NGA url 规则候选地址', () => {
  afterEach(() => {
    setNgaUrlConfigProvider(() => DEFAULT_NGA_URL_CONFIG);
  });

  it('默认规则为包含 mon_ 的不完整地址补全前缀', () => {
    expect(buildNgaUrlCandidates('./mon_202611/23/a.jpg')).toEqual([
      'https://img.nga.cn/attachments/mon_202611/23/a.jpg',
    ]);
    expect(buildNgaUrlCandidates('mon_202611/23/a.jpg')[0]).toBe(
      'https://img.nga.cn/attachments/mon_202611/23/a.jpg',
    );
  });

  it('多个前缀按规则顺序生成候选，供加载失败时依次回退', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: true,
      rules: [
        { id: 'a', pattern: 'mon_', prefix: 'https://a.example.com/attachments', enabled: true },
        { id: 'b', pattern: 'mon_', prefix: 'https://b.example.com/attachments', enabled: true },
        { id: 'c', pattern: 'other_', prefix: 'https://c.example.com/attachments', enabled: true },
      ],
    }));
    expect(buildNgaUrlCandidates('./mon_x.mp3')).toEqual([
      'https://a.example.com/attachments/mon_x.mp3',
      'https://b.example.com/attachments/mon_x.mp3',
      // 未命中的规则作为兜底前缀排在命中规则之后
      'https://c.example.com/attachments/mon_x.mp3',
    ]);
  });

  it('关闭自动补全时保留原始地址', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: false,
      rules: [
        { id: 'a', pattern: 'mon_', prefix: 'https://a.example.com/attachments', enabled: true },
      ],
    }));
    expect(buildNgaUrlCandidates('./mon_x.jpg')).toEqual(['./mon_x.jpg']);
  });

  it('绝对地址附带 NGA 图床镜像作为回退', () => {
    const list = buildNgaUrlCandidates('https://img.nga.cn/attachments/mon_x.jpg');
    expect(list[0]).toBe('https://img.nga.cn/attachments/mon_x.jpg');
    expect(list).toContain('https://img.nga.178.com/attachments/mon_x.jpg');
  });

  it('非法正则不会抛错，按未命中处理', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: true,
      rules: [{ id: 'bad', pattern: '([', prefix: 'https://a.example.com', enabled: true }],
    }));
    expect(buildNgaUrlCandidates('./mon_x.jpg')).toEqual(['https://a.example.com/mon_x.jpg']);
  });
});
