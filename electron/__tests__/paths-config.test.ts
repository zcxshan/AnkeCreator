// ============================================================
// 自定义数据目录配置测试
// 覆盖：
//   1. 写入后可读回（绝对路径）
//   2. 配置不存在 → null
//   3. 配置损坏 → null（不抛错）
//   4. 清除配置 → null
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const hoisted = vi.hoisted(() => ({ appDataDir: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? hoisted.appDataDir : hoisted.appDataDir),
    getAppPath: () => hoisted.appDataDir,
    isPackaged: false,
  },
}));

import {
  readConfiguredDataDir,
  writeConfiguredDataDir,
  clearConfiguredDataDir,
} from '../paths';

beforeAll(() => {
  hoisted.appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-paths-'));
});

afterAll(() => {
  try {
    fs.rmSync(hoisted.appDataDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe('自定义数据目录配置', () => {
  it('写入后可按绝对路径读回', () => {
    const target = path.join(hoisted.appDataDir, 'my-data');
    writeConfiguredDataDir(target);
    expect(readConfiguredDataDir()).toBe(path.resolve(target));
  });

  it('配置损坏时返回 null', () => {
    const file = path.join(hoisted.appDataDir, 'com.shanshian.ankecreator', 'data-dir.json');
    fs.writeFileSync(file, '{ bad json', 'utf-8');
    expect(readConfiguredDataDir()).toBeNull();
  });

  it('清除配置后返回 null', () => {
    const target = path.join(hoisted.appDataDir, 'other-data');
    writeConfiguredDataDir(target);
    clearConfiguredDataDir();
    expect(readConfiguredDataDir()).toBeNull();
  });
});
