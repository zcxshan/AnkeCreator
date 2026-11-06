// 设计令牌完整性测试：
// 组件里写 var(--xxx) 时如果令牌从未在 index.css 定义，浏览器会静默丢弃该样式
// （活动态没颜色、按钮没背景等），且不会报错，很难在代码评审中发现。
// 这里静态扫描 src 下的所有 var(--x) 引用，确保都能在设计令牌表中找到定义。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_DIR = resolve(__dirname, '..');
const CSS_FILE = join(SRC_DIR, 'index.css');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx|ts|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('设计令牌完整性', () => {
  it('组件中引用的 CSS 变量都在 index.css 中定义（或带 fallback）', () => {
    const css = readFileSync(CSS_FILE, 'utf8');
    const defined = new Set(
      Array.from(css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)).map((m) => m[1]),
    );

    const missing = new Map<string, string[]>();
    for (const file of collectSourceFiles(SRC_DIR)) {
      if (file === CSS_FILE) continue;
      const content = readFileSync(file, 'utf8');
      // 只匹配不带 fallback 的 var(--x)；带逗号的写法浏览器有兜底值
      for (const m of content.matchAll(/var\((--[a-zA-Z0-9_-]+)\s*\)/g)) {
        const name = m[1];
        if (defined.has(name)) continue;
        const list = missing.get(name) ?? [];
        list.push(file.replace(SRC_DIR, 'src'));
        missing.set(name, list);
      }
    }

    expect(
      Array.from(missing.entries()).map(([name, files]) => `${name} ← ${files.join(', ')}`),
    ).toEqual([]);
  });
});
