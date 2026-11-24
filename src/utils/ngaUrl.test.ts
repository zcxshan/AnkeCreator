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

  it('默认规则为 ./mon_ 开头的不完整地址补全前缀（两个默认前缀按顺序）', () => {
    expect(buildNgaUrlCandidates('./mon_202611/23/a.jpg')).toEqual([
      'https://img.nga.cn/attachments/mon_202611/23/a.jpg',
      'https://img.nga.178.com/attachments/mon_202611/23/a.jpg',
    ]);
  });

  it('命中任意一条规则即按全部前缀顺序生成候选（多对多）', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: true,
      patterns: [
        { id: 'p1', pattern: '^\\./mon_' },
        { id: 'p2', pattern: '^\\./other_' },
      ],
      prefixes: [
        { id: 'a', prefix: 'https://a.example.com/attachments' },
        { id: 'b', prefix: 'https://b.example.com/attachments' },
      ],
    }));
    expect(buildNgaUrlCandidates('./mon_x.mp3')).toEqual([
      'https://a.example.com/attachments/mon_x.mp3',
      'https://b.example.com/attachments/mon_x.mp3',
    ]);
    expect(buildNgaUrlCandidates('./other_y.mp3')).toEqual([
      'https://a.example.com/attachments/other_y.mp3',
      'https://b.example.com/attachments/other_y.mp3',
    ]);
  });

  it('未命中任何规则的相对地址保持原样', () => {
    expect(buildNgaUrlCandidates('./plain/image.jpg')).toEqual(['./plain/image.jpg']);
  });

  it('关闭自动补全时保留原始地址', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: false,
      patterns: [{ id: 'p1', pattern: '^mon_' }],
      prefixes: [{ id: 'a', prefix: 'https://a.example.com/attachments' }],
    }));
    expect(buildNgaUrlCandidates('./mon_x.jpg')).toEqual(['./mon_x.jpg']);
  });

  it('绝对地址附带 NGA 图床镜像与自定义前缀作为回退', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: true,
      patterns: [{ id: 'p1', pattern: 'mon_' }],
      prefixes: [
        { id: 'a', prefix: 'https://img.nga.cn/attachments' },
        { id: 'b', prefix: 'https://mirror.example.com/attachments' },
      ],
    }));
    const list = buildNgaUrlCandidates('https://img.nga.cn/attachments/mon_x.jpg');
    expect(list[0]).toBe('https://img.nga.cn/attachments/mon_x.jpg');
    expect(list).toContain('https://img.nga.178.com/attachments/mon_x.jpg');
    expect(list).toContain('https://mirror.example.com/attachments/mon_x.jpg');
    // 不能出现重复的 attachments 目录
    expect(list.every((url) => !url.includes('/attachments/attachments/'))).toBe(true);
  });

  it('非法正则不会抛错，按未命中处理', () => {
    setNgaUrlConfigProvider(() => ({
      autoPrefix: true,
      patterns: [{ id: 'bad', pattern: '([' }],
      prefixes: [{ id: 'a', prefix: 'https://a.example.com' }],
    }));
    expect(buildNgaUrlCandidates('./mon_x.jpg')).toEqual(['./mon_x.jpg']);
  });
});
