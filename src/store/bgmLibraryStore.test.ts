import { beforeEach, describe, expect, it } from 'vitest';
import { isValidBgmUrl, useBgmLibraryStore } from './bgmLibraryStore';
import { setNgaUrlPrefixProvider } from '../utils/ngaUrl';

setNgaUrlPrefixProvider(() => 'https://img.nga.cn/attachments');

describe('bgmLibraryStore', () => {
  beforeEach(() => {
    useBgmLibraryStore.getState().clear();
  });

  it('校验 URL 协议', () => {
    expect(isValidBgmUrl('https://example.com/a.mp3')).toBe(true);
    expect(isValidBgmUrl('./mon_202403/17/lsQ2t-db02X10Za0.mp3')).toBe(true);
    expect(isValidBgmUrl('mon_202403/17/a.mp3')).toBe(true);
    expect(isValidBgmUrl('ftp://example.com/a.mp3')).toBe(false);
    expect(isValidBgmUrl('随便一个名字')).toBe(false);
  });

  it('相对地址补全前缀并保留原文', () => {
    const result = useBgmLibraryStore
      .getState()
      .addByUrl('测试曲', './mon_202403/17/lsQ2t-db02X10Za0.mp3');
    expect(result.ok).toBe(true);
    const items = useBgmLibraryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://img.nga.cn/attachments/mon_202403/17/lsQ2t-db02X10Za0.mp3');
    expect(items[0].raw).toBe('./mon_202403/17/lsQ2t-db02X10Za0.mp3');
    expect(items[0].name).toBe('测试曲');
  });

  it('拒绝重复地址并可删除', () => {
    const store = useBgmLibraryStore.getState();
    store.addByUrl('a', 'https://example.com/a.mp3');
    expect(useBgmLibraryStore.getState().addByUrl('b', 'https://example.com/a.mp3').ok).toBe(false);
    const id = useBgmLibraryStore.getState().items[0].id;
    useBgmLibraryStore.getState().remove(id);
    expect(useBgmLibraryStore.getState().items).toHaveLength(0);
  });
});
