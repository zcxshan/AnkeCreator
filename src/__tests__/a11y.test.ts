// 可访问性回归：纯图标按钮必须有可读名称（aria-label / aria-labelledby / title）
// 通过 TypeScript AST 静态扫描 src 下的 .tsx，避免逐个组件人肉 review。

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(process.cwd(), 'src');
const LABEL_ATTRS = new Set(['aria-label', 'aria-labelledby', 'title']);

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listTsx(full));
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function collectNodeText(node: ts.Node, source: ts.SourceFile): string {
  /** 节点是否渲染出可读文本（不含图标） */
  const rendersText = (n: ts.Node): boolean => {
    if (ts.isJsxText(n)) return n.getText(source).trim().length > 0;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return true;
    if (ts.isJsxSelfClosingElement(n)) return false; // 自闭合一般是图标/输入框
    if (ts.isJsxExpression(n)) {
      const expr = n.expression;
      if (!expr) return false;
      // 纯 JSX 表达式：继续看它内部是否有文本
      if (
        ts.isJsxElement(expr) ||
        ts.isJsxFragment(expr) ||
        ts.isJsxSelfClosingElement(expr)
      ) {
        return rendersText(expr);
      }
      // 标识符 / 条件 / 调用表达式：假定会渲染文案（宁可漏报，不误报）
      if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) return false;
      return true;
    }
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      return n.children.some(rendersText);
    }
    return false;
  };
  return node.children.some(rendersText) ? 'x' : '';
}

function hasIconDescendant(node: ts.Node, source: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.openingElement?.tagName ?? n.tagName;
      const name = tag.getText(source);
      if (/Icon$/.test(name) || name === 'icon') {
        found = true;
        return;
      }
    }
    if (ts.isIdentifier(n) && n.getText(source) === 'Icon') {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

describe('a11y：纯图标按钮可读名称', () => {
  it('所有仅含图标的 <button> 均提供 aria-label/aria-labelledby/title', () => {
    const problems: string[] = [];
    let iconOnlyTotal = 0;

    for (const file of listTsx(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node)) {
          const tag = node.openingElement.tagName.getText(source);
          if (tag === 'button' || tag === 'Button') {
            const attrs = node.openingElement.attributes.properties;
            const labelled = attrs.some(
              (a) => ts.isJsxAttribute(a) && LABEL_ATTRS.has(a.name.getText(source)),
            );
            const childText = collectNodeText(node, source);
            const iconOnly = hasIconDescendant(node, source) && childText.length === 0;
            if (iconOnly) {
              iconOnlyTotal++;
              if (!labelled) {
                const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
                problems.push(
                  `${path.relative(process.cwd(), file)}:${pos.line + 1} 纯图标按钮缺少 aria-label/title`,
                );
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    // 防止扫描规则失效导致“空过”：仓库中纯图标按钮数量应保持在一定规模
    expect(iconOnlyTotal).toBeGreaterThan(10);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
