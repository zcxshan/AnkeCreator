// v14：parseLocalUrlToFileName 单元测试
// 旧版只取 URL 的 hostname，导致嵌套 URL（local://001/4.png）拿不到文件
// v14 修复：合并 hostname + pathname，支持嵌套 URL

import { describe, it, expect } from 'vitest';
import { parseLocalUrlToFileName, validateLocalUrlForFileOp } from './parseLocalUrl';

describe('parseLocalUrlToFileName', () => {
  // T1: 旧格式 - 单段
  it('T1: local://1.png → 1.png（兼容旧格式）', () => {
    expect(parseLocalUrlToFileName('local://1.png')).toBe('1.png');
  });

  // T2: 三斜杠格式
  it('T2: local:///1.png → 1.png（兼容三斜杠）', () => {
    expect(parseLocalUrlToFileName('local:///1.png')).toBe('1.png');
  });

  // T3: 单层子目录（最常见场景，001/4.png）
  it('T3: local://001/4.png → 001/4.png（单层子目录 - 核心修复）', () => {
    expect(parseLocalUrlToFileName('local://001/4.png')).toBe('001/4.png');
  });

  // T4: 嵌套子目录
  it('T4: local://001/002/5.png → 001/002/5.png（嵌套子目录）', () => {
    expect(parseLocalUrlToFileName('local://001/002/5.png')).toBe('001/002/5.png');
  });

  // T5: 中文目录（v13 引入的"根目录"bug 场景）
  it('T5: local://根目录/1.png → 根目录/1.png（中文目录）', () => {
    expect(parseLocalUrlToFileName('local://根目录/1.png')).toBe('根目录/1.png');
  });

  // T6: URL 编码的文件名
  it('T6: local://001/4%20(1).png → 001/4 (1).png（URL decode）', () => {
    expect(parseLocalUrlToFileName('local://001/4%20(1).png')).toBe('001/4 (1).png');
  });

  // 附加: 多个特殊场景
  it('附加: local://001/4.png 带 query/fragment → 001/4.png（忽略 ?#）', () => {
    // URL 的 pathname 不包含 query/fragment，所以应该被忽略
    expect(parseLocalUrlToFileName('local://001/4.png?v=1')).toBe('001/4.png');
    expect(parseLocalUrlToFileName('local://001/4.png#frag')).toBe('001/4.png');
  });

  it('附加: local:// 大写扩展名也支持 → IMAGE.JPG', () => {
    expect(parseLocalUrlToFileName('local://IMAGE.JPG')).toBe('IMAGE.JPG');
  });

  it('附加: 路径结尾带 / → 去掉尾部 /', () => {
    expect(parseLocalUrlToFileName('local://001/4.png/')).toBe('001/4.png');
  });

  // v19: path-based URL 格式（三斜杠，空 host）
  it('v19-T1: local:///001/4.png → 001/4.png（path-based 单层子目录）', () => {
    expect(parseLocalUrlToFileName('local:///001/4.png')).toBe('001/4.png');
  });

  it('v19-T2: local:///001/002/5.png → 001/002/5.png（path-based 嵌套子目录）', () => {
    expect(parseLocalUrlToFileName('local:///001/002/5.png')).toBe('001/002/5.png');
  });

  it('v19-T3: local:///根目录/1.png → 根目录/1.png（path-based 中文目录）', () => {
    expect(parseLocalUrlToFileName('local:///根目录/1.png')).toBe('根目录/1.png');
  });
});

// v25：validateLocalUrlForFileOp 单元测试
// 修复资源库 image:deleteLocal / image:renameLocal 拒绝 v22 后 local:/// 格式的 bug
// 修复前：用 replace(/^local:\/\//, '') + startsWith('/') 安全检查 → 三斜杠 URL 被误判
// 修复后：复用 URL API 解析 + 路径安全检查
describe('validateLocalUrlForFileOp', () => {
  // D1: 核心 bug 修复 - local:/// 三斜杠格式
  it('D1: local:///001/3.png → ok=true, relPath=001/3.png（v22 后三斜杠格式）', () => {
    const result = validateLocalUrlForFileOp('local:///001/3.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('001/3.png');
    }
  });

  // D2: 向后兼容 - 旧的双斜杠格式
  it('D2: local://001/3.png → ok=true, relPath=001/3.png（旧双斜杠格式）', () => {
    const result = validateLocalUrlForFileOp('local://001/3.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('001/3.png');
    }
  });

  // D3: 安全检查 - 拒绝 .. 路径元素
  // URL API 会把 ../ 规范化掉（new URL('local:///../etc/passwd').pathname = '/etc/passwd'）
  // 所以我们的安全检查变成"检查 relPath 是否含 .."（这取决于 URL 解析后的 relPath）
  it('D3: local:///../etc/passwd → URL 规范化后 relPath=etc/passwd（无 .. 风险）', () => {
    // URL API 规范化了 ../，relPath 变成 etc/passwd
    // path.join(imagesDir, 'etc/passwd') 不会逃逸到 imagesDir 外，仍是安全
    const result = validateLocalUrlForFileOp('local:///../etc/passwd');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('etc/passwd');
    }
  });

  // D3-extra: 安全检查 - 拒绝明显含 .. 的文件名
  it('D3-extra: local:///001/..%2Fevil.png → ok=false（含 .. 的文件名仍被拒绝）', () => {
    // 如果 URL 编码了 ../，URL decode 后包含 ..
    // 我们的 check 在 parseLocalUrlToFileName 之后做，URL decode 后 .. 仍会出现
    // 但 URL pathname 的 '..%2Fevil' 会被 URL API 解析为 '..%2Fevil' (pathname 不解码 ..%2F)
    // parseLocalUrlToFileName decode 后是 '../evil'，includes('..') = true → 拒绝
    const result = validateLocalUrlForFileOp('local:///..%2Fevil.png');
    // URL 编码的 ..%2F 实际上 URL API pathname 不会自动 decode ..%2F（这是 path segment）
    // 但 parseLocalUrlToFileName 会 decodeURIComponent，把它变成 '../evil'
    // 然后 includes('..') = true → 拒绝
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('非法路径');
    }
  });

  // D4: 协议检查 - 拒绝 http(s) URL
  it('D4: https://example.com/x.png → ok=false, error=非本地 URL，跳过', () => {
    const result = validateLocalUrlForFileOp('https://example.com/x.png');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('非本地 URL，跳过');
    }
  });

  // D5: 重命名等价于删除 - 用同一函数
  it('D5: renameLocal 用同一函数 - local:///001/3.png 解析正确', () => {
    // image:renameLocal 在 v25 修复后复用 validateLocalUrlForFileOp
    // 验证该函数对 local:/// 格式的解析结果与 deleteLocal 一致
    const deleteResult = validateLocalUrlForFileOp('local:///001/3.png');
    expect(deleteResult.ok).toBe(true);
    if (deleteResult.ok) {
      expect(deleteResult.relPath).toBe('001/3.png');
    }
    // renameLocal 还要求 source 文件存在（这是 IPC handler 后续的事，纯函数不测）
  });

  // 附加: 嵌套子目录
  it('附加: local:///001/002/5.png → ok=true, relPath=001/002/5.png（嵌套子目录）', () => {
    const result = validateLocalUrlForFileOp('local:///001/002/5.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('001/002/5.png');
    }
  });

  // 附加: 空字符串
  it('附加: 空字符串 → ok=false, error=非本地 URL，跳过', () => {
    const result = validateLocalUrlForFileOp('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('非本地 URL，跳过');
    }
  });

  // 附加: 根目录文件（无子目录）
  it('附加: local:///1.png → ok=true, relPath=1.png（根目录文件）', () => {
    const result = validateLocalUrlForFileOp('local:///1.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('1.png');
    }
  });

  // 附加: 中文目录
  it('附加: local:///根目录/1.png → ok=true, relPath=根目录/1.png（中文目录）', () => {
    const result = validateLocalUrlForFileOp('local:///根目录/1.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relPath).toBe('根目录/1.png');
    }
  });

  // 附加: data: URL 拒绝
  it('附加: data:image/png;base64,... → ok=false（拒绝非 local 协议）', () => {
    const result = validateLocalUrlForFileOp('data:image/png;base64,iVBOR');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('非本地 URL，跳过');
    }
  });
});
