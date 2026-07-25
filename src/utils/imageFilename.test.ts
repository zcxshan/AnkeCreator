import { describe, it, expect } from 'vitest';
import { stripImageFilenameExtension } from './imageFilename';

describe('stripImageFilenameExtension - 重命名去扩展名（v4 测试）', () => {
  // 业务规则：用户输入"newname.png"应被自动剥成"newname"（扩展名由磁盘文件决定）。
  // 在 UI（ImageLibraryPage.handleRenameItem）和 IPC（image:renameLocal）两处都用了同样的剥离逻辑。
  // 本测试覆盖边界场景。

  it('B1: "newname.png" → "newname"（最常见场景）', () => {
    expect(stripImageFilenameExtension('newname.png')).toBe('newname');
  });

  it('B2: "newname" → "newname"（无扩展名时保持原样）', () => {
    expect(stripImageFilenameExtension('newname')).toBe('newname');
  });

  it('B3: "newname.jpg" → "newname"（强制使用磁盘扩展名，不信任用户输入的扩展名）', () => {
    expect(stripImageFilenameExtension('newname.jpg')).toBe('newname');
  });

  it('B4: "newname.tar.gz" → "newname.tar"（只剥最后一段）', () => {
    expect(stripImageFilenameExtension('newname.tar.gz')).toBe('newname.tar');
  });

  it('B5: "newname." → "newname"（末尾空扩展名被剥）', () => {
    expect(stripImageFilenameExtension('newname.')).toBe('newname');
  });

  it('B6: ".bashrc" → ".bashrc"（隐藏文件不动）', () => {
    expect(stripImageFilenameExtension('.bashrc')).toBe('.bashrc');
  });

  it('B7: "a..b.png" → "a..b"（中间的双点不影响）', () => {
    expect(stripImageFilenameExtension('a..b.png')).toBe('a..b');
  });

  it('B8: "" → ""（空字符串保持）', () => {
    expect(stripImageFilenameExtension('')).toBe('');
  });
});
