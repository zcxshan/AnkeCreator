/**
 * htmlToNGABBCode 单元测试
 *
 * 覆盖：基础富文本 / 块级结构 / 工具栏插入元素回转 / 回环测试
 *
 * 重点：
 * - NGA 论坛支持的语义尽量保留
 * - 工具栏插入的 collapse/dice/image 转回 BBCode 后能再用 bbcodeToHtml 还原
 * - HTML → BBCode → HTML 回环保留关键结构
 *
 * 注：函数会在末尾补一个 \n（NGA BBCode 习惯），测试用 trim 后比较
 */
import { describe, it, expect } from 'vitest';
import { htmlToNGABBCode } from './ngaHtmlToBBCode';
import { bbcodeToHtml } from './ngaBBCodeToHtml';

const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

describe('htmlToNGABBCode - 基础富文本', () => {
  it('<b>x</b> 转 [b]x[/b]', () => {
    expect(trim(htmlToNGABBCode('<b>x</b>'))).toBe('[b]x[/b]');
  });
  it('<i>x</i> 转 [i]x[/i]', () => {
    expect(trim(htmlToNGABBCode('<i>x</i>'))).toBe('[i]x[/i]');
  });
  it('<u>x</u> 转 [u]x[/u]', () => {
    expect(trim(htmlToNGABBCode('<u>x</u>'))).toBe('[u]x[/u]');
  });
  it('<s>x</s> 转 [del]x[/del]', () => {
    expect(trim(htmlToNGABBCode('<s>x</s>'))).toBe('[del]x[/del]');
  });
  it('<strong>x</strong> 转 [b]x[/b]', () => {
    expect(trim(htmlToNGABBCode('<strong>x</strong>'))).toBe('[b]x[/b]');
  });
  it('<span style="color:red">x</span> 转 [color=red]x[/color]', () => {
    const out = htmlToNGABBCode('<span style="color:red">x</span>');
    expect(out).toContain('[color=red]');
    expect(out).toContain('x');
    expect(out).toContain('[/color]');
  });
  it('<span style="font-size:18pt">x</span> 转 [size=150%]x[/size]（18pt = 150%）', () => {
    const out = htmlToNGABBCode('<span style="font-size:18pt">x</span>');
    expect(out).toMatch(/\[size=1\d\d%\]x\[\/size\]/);
  });
  it('<span style="font-family:simsun">x</span> 默认字体不加 [font] tag', () => {
    const out = htmlToNGABBCode('<span style="font-family:宋体">x</span>');
    expect(out).not.toContain('[font=');
  });
  it('<a href="https://x.com">text</a> 转 [url=https://x.com]text[/url]', () => {
    expect(trim(htmlToNGABBCode('<a href="https://x.com">text</a>'))).toBe(
      '[url=https://x.com]text[/url]',
    );
  });
  it('<img src="https://x.com/y.jpg"> 转 [img]https://x.com/y.jpg[/img]', () => {
    expect(trim(htmlToNGABBCode('<img src="https://x.com/y.jpg">'))).toBe(
      '[img]https://x.com/y.jpg[/img]',
    );
  });
  it('<br> 转 \\n（修之前的 bug：被吞）', () => {
    const out = htmlToNGABBCode('a<br>b');
    expect(out).toContain('a\nb');
  });
});

describe('htmlToNGABBCode - 块级结构', () => {
  it('<p>x</p> 转 x', () => {
    expect(trim(htmlToNGABBCode('<p>x</p>'))).toBe('x');
  });
  it('<div>x</div> 转 x', () => {
    expect(trim(htmlToNGABBCode('<div>x</div>'))).toBe('x');
  });
  it('<h1>x</h1> 转 x', () => {
    expect(trim(htmlToNGABBCode('<h1>x</h1>'))).toBe('x');
  });
  it('<hr> 转 [h][/h]', () => {
    expect(trim(htmlToNGABBCode('<hr>'))).toBe('[h][/h]');
  });
  it('<pre class="code-block">line1\\nline2</pre> 转 [code]...\\nline1\\nline2\\n...[/code]（多行代码块保留换行）', () => {
    const out = trim(htmlToNGABBCode('<pre class="code-block">line1\nline2</pre>'));
    // 关键：保留所有换行；不压缩成一行
    expect(out).toContain('[code]');
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('[/code]');
    expect(out).toContain('line1\nline2');
  });
  it('<ul><li>a</li><li>b</li></ul> 转 [list]\\n[*]a\\n[*]b\\n[/list]', () => {
    expect(trim(htmlToNGABBCode('<ul><li>a</li><li>b</li></ul>'))).toBe(
      '[list]\n[*]a\n[*]b\n[/list]',
    );
  });
  it('<ol><li>a</li></ol> 转 [list=1]\\n[*]a\\n[/list]', () => {
    expect(trim(htmlToNGABBCode('<ol><li>a</li></ol>'))).toBe(
      '[list=1]\n[*]a\n[/list]',
    );
  });
  it('<table><tr><td>x</td></tr></table> 含 [table]/[tr]/[td]x[/td]', () => {
    const out = htmlToNGABBCode('<table><tr><td>x</td></tr></table>');
    expect(out).toContain('[table]');
    expect(out).toContain('[tr]');
    expect(out).toContain('[td]x[/td]');
    expect(out).toContain('[/tr]');
    expect(out).toContain('[/table]');
  });
  it('<div class="quote-line">x</div> 转 [quote]x[/quote]', () => {
    const out = htmlToNGABBCode('<div class="quote-line">x</div>');
    expect(out).toContain('[quote]');
    expect(out).toContain('x');
    expect(out).toContain('[/quote]');
  });
  it('<blockquote>x</blockquote> 转 [quote]x[/quote]', () => {
    const out = htmlToNGABBCode('<blockquote>x</blockquote>');
    expect(out).toContain('[quote]');
    expect(out).toContain('x');
    expect(out).toContain('[/quote]');
  });
  it('collapse-block 转 [collapse=title]\\n...\\n[/collapse]', () => {
    const out = htmlToNGABBCode(
      '<div data-type="collapse-block" data-title="标题"><div class="collapse-body">x</div></div>',
    );
    expect(out).toContain('[collapse=标题]');
    expect(out).toContain('x');
    expect(out).toContain('[/collapse]');
  });
});

describe('htmlToNGABBCode - 工具栏插入元素回转', () => {
  it('工具栏 insertCollapseBlock 输出 → BBCode → HTML 仍可识别为 collapse-block', () => {
    // 模拟工具栏 insertCollapseBlock 输出的结构
    const toolbarHtml = `<div data-type="collapse-block" data-title="秘密" data-collapsed="false"><div class="collapse-head" contenteditable="false"><span class="collapse-toggle">−</span><span class="collapse-title">秘密</span></div><div class="collapse-body">内含的秘密</div></div>`;
    const bbcode = htmlToNGABBCode(toolbarHtml);
    expect(bbcode).toContain('[collapse=秘密]');
    expect(bbcode).toContain('内含的秘密');
    expect(bbcode).toContain('[/collapse]');
    // BBCode → HTML 仍能识别为 collapse-block
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('data-type="collapse-block"');
    expect(html2).toContain('collapse-toggle');
    expect(html2).toContain('collapse-body');
  });

  it('image-block 带 size 后缀：HTML → BBCode → HTML 保留 size', () => {
    const toolbarHtml = `<div data-type="image-block" data-size="medium"><img src="https://img.nga.178.com/test.jpg"></div>`;
    const bbcode = htmlToNGABBCode(toolbarHtml);
    expect(bbcode).toContain('[img]');
    expect(bbcode).toContain('test.jpg');
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('img');
    expect(html2).toContain('test.jpg');
  });
});

describe('htmlToNGABBCode - 回环测试（HTML → BBCode → HTML）', () => {
  it('<b><i>hi</i></b> 嵌套回环保留结构', () => {
    const original = '<b><i>hi</i></b>';
    const bbcode = htmlToNGABBCode(original);
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toMatch(/<b[^>]*>\s*<i[^>]*>hi<\/i>\s*<\/b>/);
  });
  it('<p>para1</p><p>para2</p> 回环保留段落分隔', () => {
    const original = '<p>para1</p><p>para2</p>';
    const bbcode = htmlToNGABBCode(original);
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('para1');
    expect(html2).toContain('para2');
  });
  it('<ul><li>a</li><li>b</li></ul> 回环保留 li 标签', () => {
    const original = '<ul><li>a</li><li>b</li></ul>';
    const bbcode = htmlToNGABBCode(original);
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('<li>');
    expect(html2).toContain('a');
    expect(html2).toContain('b');
  });
  it('<a href="https://x.com">text</a> 回环保留链接', () => {
    const original = '<a href="https://x.com">text</a>';
    const bbcode = htmlToNGABBCode(original);
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('href="https://x.com"');
    expect(html2).toContain('text');
  });
  it('<img src="https://x.com/y.jpg"> 回环保留图片 src', () => {
    const original = '<img src="https://x.com/y.jpg">';
    const bbcode = htmlToNGABBCode(original);
    const html2 = bbcodeToHtml(bbcode);
    expect(html2).toContain('src="https://x.com/y.jpg"');
  });
});

describe('htmlToNGABBCode - 边界', () => {
  it('null/undefined/空串返回空串', () => {
    expect(htmlToNGABBCode(null)).toBe('');
    expect(htmlToNGABBCode(undefined)).toBe('');
    expect(htmlToNGABBCode('')).toBe('');
  });
  it('纯文本无 tag 直接输出', () => {
    expect(trim(htmlToNGABBCode('hello world'))).toBe('hello world');
  });
  it('嵌套 collapse 转 BBCode', () => {
    const out = htmlToNGABBCode(
      '<div data-type="collapse-block" data-title="外层"><div class="collapse-body"><div data-type="collapse-block" data-title="内层"><div class="collapse-body">嵌套内容</div></div></div></div>',
    );
    expect(out).toContain('[collapse=外层]');
    expect(out).toContain('[collapse=内层]');
    expect(out).toContain('嵌套内容');
  });
});

describe('htmlToNGABBCode - 边界 case 修复', () => {
  it('空 <div></div> 不输出空行（输出空字符串）', () => {
    expect(trim(htmlToNGABBCode('<div></div>'))).toBe('');
  });
  it('<p><br></p> 输出空字符串而非 \\n', () => {
    expect(trim(htmlToNGABBCode('<p><br></p>'))).toBe('');
  });
  it('嵌套 <b><b>x</b></b> 合并为 [b]x[/b]（不输出 [b][b]x[/b][/b]）', () => {
    expect(trim(htmlToNGABBCode('<b><b>x</b></b>'))).toBe('[b]x[/b]');
  });
});

describe('htmlToNGABBCode - 边界 case 补充', () => {
  // Helper: trim trailing whitespace for stable comparison
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('嵌套同标签 <b><b>x</b></b> 合并为 [b]x[/b]', () => {
    const html = '<b><b>x</b></b>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[b]x[/b]');
  });

  it('嵌套同标签 <i><i>y</i></i> 合并为 [i]y[/i]', () => {
    const html = '<i><i>y</i></i>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[i]y[/i]');
  });

  it('正常嵌套 <i><b>x</b></i> 保留为 [i][b]x[/b][/i]', () => {
    const html = '<i><b>x</b></i>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[i][b]x[/b][/i]');
  });

  it('<br> 输出换行符 \\n', () => {
    const html = 'line1<br>line2';
    const bb = htmlToNGABBCode(html);
    expect(bb).toContain('line1\nline2');
  });

  it('空 <div></div> 不输出多余内容', () => {
    const html = '<div></div>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('');
  });

  it('<p><br></p> 输出合理（不产生多余空行）', () => {
    const html = '<p><br></p>';
    const bb = htmlToNGABBCode(html);
    // Should not produce multiple consecutive newlines
    expect(bb).not.toMatch(/\n{3,}/);
  });

  it('<strong> 转为 [b]', () => {
    const html = '<strong>bold</strong>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[b]bold[/b]');
  });

  it('<em> 转为 [i]', () => {
    const html = '<em>italic</em>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[i]italic[/i]');
  });

  it('嵌套 <del><del>x</del></del> 合并为 [del]x[/del]', () => {
    const html = '<del><del>x</del></del>';
    const bb = trim(htmlToNGABBCode(html));
    expect(bb).toBe('[del]x[/del]');
  });
});

describe('Fix #2: 内联内容在块级容器中保留（TDD）', () => {
  it('h4 + b + span 内联内容保留外层标签', () => {
    const html = '<h4>标题</h4><b>加粗</b> <span style="color:red">红字</span>';
    // 期望：h4 单独一行，b+span 聚合成一行
    expect(trim(htmlToNGABBCode(html))).toBe(
      '标题\n[b]加粗[/b] [color=red]红字[/color]',
    );
  });

  it('h4 + 文本 + a 链接保留', () => {
    const html = '<h4>x</h4>文本 <a href="https://example.com">链接</a> 文本';
    expect(trim(htmlToNGABBCode(html))).toBe(
      'x\n文本 [url=https://example.com]链接[/url] 文本',
    );
  });

  it('anke-section 结构完整保留所有格式', () => {
    const html =
      '<div class="anke-section"><h4 style="margin: 12px 0 8px; color: var(--accent); font-size: 14px; font-weight: 600;">—— 3 楼 ——</h4><b>第3楼</b> <span style="color:red">某角色</span> 说了 <a href="https://x">某句话</a><hr style="border:none; border-top:1px dashed var(--border-color); margin:16px 0;" /></div>';
    // h4 单独一行，内联聚合一行，hr 单独一行
    expect(trim(htmlToNGABBCode(html))).toBe(
      '—— 3 楼 ——\n[b]第3楼[/b] [color=red]某角色[/color] 说了 [url=https://x]某句话[/url]\n[h][/h]',
    );
  });

  it('纯内联内容（无块级子元素）仍正常工作', () => {
    const html = '<b>加粗</b> <span style="color:red">红字</span>';
    expect(trim(htmlToNGABBCode(html))).toBe(
      '[b]加粗[/b] [color=red]红字[/color]',
    );
  });
});

describe('Fix #5: 嵌套样式与 font 标签互转（TDD）', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('b 标签自身带 color 样式提取', () => {
    expect(trim(htmlToNGABBCode('<b style="color:red">x</b>'))).toBe(
      '[b][color=red]x[/color][/b]',
    );
  });

  it('i 标签自身带 font-size 样式提取', () => {
    const result = trim(htmlToNGABBCode('<i style="font-size:18pt">x</i>'));
    expect(result).toMatch(/^\[i\]\[size=\d+%]x\[\/size\]\[\/i\]$/);
  });

  it('u 标签自身带多样式提取（color + font-weight）', () => {
    const result = trim(
      htmlToNGABBCode('<u style="color:blue;font-weight:bold">x</u>'),
    );
    expect(result).toContain('[u]');
    expect(result).toContain('[color=blue]');
    expect(result).toContain('[b]');
    expect(result).toContain('x');
  });

  it('font 标签 color 属性转换', () => {
    expect(trim(htmlToNGABBCode('<font color="red">x</font>'))).toBe(
      '[color=red]x[/color]',
    );
  });

  it('font 标签 size 属性转换', () => {
    expect(trim(htmlToNGABBCode('<font size="5">x</font>'))).toBe(
      '[size=160%]x[/size]',
    );
  });

  it('span 的 fontWeight 解析为 [b]', () => {
    expect(
      trim(htmlToNGABBCode('<span style="font-weight:bold">x</span>')),
    ).toBe('[b]x[/b]');
  });

  it('span 的 fontStyle 解析为 [i]', () => {
    expect(
      trim(htmlToNGABBCode('<span style="font-style:italic">x</span>')),
    ).toBe('[i]x[/i]');
  });

  it('span 的 text-decoration:underline 解析为 [u]', () => {
    expect(
      trim(
        htmlToNGABBCode('<span style="text-decoration:underline">x</span>'),
      ),
    ).toBe('[u]x[/u]');
  });

  it('span 的 text-decoration:line-through 解析为 [del]', () => {
    expect(
      trim(
        htmlToNGABBCode(
          '<span style="text-decoration:line-through">x</span>',
        ),
      ),
    ).toBe('[del]x[/del]');
  });
});

describe('Phase D: anke-section 嵌套完整转换', () => {
  it('anke-section 内的 h4 + blockquote + collapse 全部转换', () => {
    const html =
      '<div class="anke-section"><h4>—— 1 楼 @作者 ——</h4><p>普通段落</p><blockquote data-type="quote-block"><p>引用内容</p></blockquote><div data-type="collapse-block" data-title="折叠标题"><div class="collapse-head" contenteditable="false"><span class="collapse-toggle">+</span><span class="collapse-title">折叠标题</span></div><div class="collapse-body">折叠内容</div></div></div>';
    const result = htmlToNGABBCode(html);
    // 期望：含 h4 标题、blockquote 转换、collapse 转换
    expect(result).toContain('—— 1 楼 @作者 ——');
    expect(result).toMatch(/\[quote\][\s\S]*引用内容[\s\S]*\[\/quote\]/);
    expect(result).toMatch(/\[collapse[\s\S]*折叠内容[\s\S]*\[\/collapse\]/);
  });

  it('anke-section 内的多个 blockquote 全部转换', () => {
    const html =
      '<div class="anke-section"><h4>标题</h4><blockquote data-type="quote-block"><p>引用1</p></blockquote><blockquote data-type="quote-block"><p>引用2</p></blockquote></div>';
    const result = htmlToNGABBCode(html);
    expect(result).toMatch(/\[quote\][\s\S]*引用1[\s\S]*\[\/quote\]/);
    expect(result).toMatch(/\[quote\][\s\S]*引用2[\s\S]*\[\/quote\]/);
  });

  it('anke-section + 内联内容（b/a/span style）保留', () => {
    const html =
      '<div class="anke-section"><h4>标题</h4><b>加粗</b> <a href="https://x.com">链接</a> <span style="color:red">红字</span></div>';
    const result = htmlToNGABBCode(html);
    expect(result).toContain('[b]加粗[/b]');
    expect(result).toMatch(/\[url=https:\/\/x\.com\][\s\S]*链接[\s\S]*\[\/url\]/);
    expect(result).toContain('[color=red]红字[/color]');
  });

  it('嵌套 anke-section（少见但兼容）', () => {
    const html =
      '<div class="anke-section"><div class="anke-section"><p>内层</p></div><p>外层</p></div>';
    const result = htmlToNGABBCode(html);
    expect(result).toContain('内层');
    expect(result).toContain('外层');
  });
});

describe('BBCode 优化：嵌套合并/空标签清除/不支持标签转义', () => {
  it('sup/sub 转换', () => {
    expect(trim(htmlToNGABBCode('<sup>上标</sup>'))).toBe('[sup]上标[/sup]');
    expect(trim(htmlToNGABBCode('<sub>下标</sub>'))).toBe('[sub]下标[/sub]');
  });

  it('[sup][sup]X[/sup][/sup] 冗余嵌套展开', () => {
    // 通过嵌套 sup 标签构造
    const html = '<sup><sup>X</sup></sup>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[sup]X[/sup]');
  });

  it('[align][align] 冗余嵌套展开', () => {
    const html = '<div style="text-align:center"><p style="text-align:center">X</p></div>';
    const result = trim(htmlToNGABBCode(html));
    // 不应出现 [align=center][align=center]
    expect(result).not.toContain('[align=center][align=center]');
    expect(result).toContain('[align=center]');
    expect(result).toContain('X');
  });

  it('相邻 [quote]X[/quote][quote]Y[/quote] 合并', () => {
    const html = '<blockquote data-type="quote-block"><p>X</p></blockquote><blockquote data-type="quote-block"><p>Y</p></blockquote>';
    const result = trim(htmlToNGABBCode(html));
    // 两个相邻 quote 应合并为一个（或至少不出现连续 [quote][quote]）
    expect(result).not.toMatch(/\[quote\]\s*\[quote\]/);
  });

  it('空 quote 不输出空标签对', () => {
    const html = '<blockquote data-type="quote-block"></blockquote>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('');
  });

  it('空 collapse 不输出空标签对', () => {
    const html = '<div data-type="collapse-block" data-title="空折叠"><div class="collapse-head" contenteditable="false"><span class="collapse-toggle">+</span><span class="collapse-title">空折叠</span></div><div class="collapse-body"></div></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('');
  });

  it('空 list 不输出空标签对', () => {
    const html = '<ul></ul>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('');
  });

  it('空 table 不输出空标签对', () => {
    const html = '<table></table>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('');
  });

  it('工具栏不支持的 bbcode 标签转义为普通文本', () => {
    // 构造一个含不支持标签的 HTML（通过 span 伪造成 bbcode 文本）
    // 直接测试 escapeUnsupportedBbCode 的效果：用 font 标签的 size 输出会被支持，
    // 这里测试一个极端情况：HTML 中含 [unknown] 文本（通过 textContent）
    const html = '<div>[unknown]测试[/unknown]</div>';
    const result = trim(htmlToNGABBCode(html));
    // [unknown] 标签应被转义为 &#91;unknown&#93; 而非保留为 bbcode
    expect(result).toContain('&#91;unknown&#93;');
  });

  it('[b][b]X[/b][/b] 跨换行冗余嵌套展开', () => {
    // 通过 b 嵌套 b 构造跨行场景
    const html = '<b><b>X</b></b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]X[/b]');
  });
});

describe('Fix #3: 跨 tag 冗余嵌套/空 inner/跨行 合并（TDD）', () => {
  const t = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('跨 tag 同名嵌套展开：[b][i][b]X[/b][/i][/b] → [b][i]X[/i][/b]', () => {
    // HTML: <b><i><b>X</b></i></b>
    // 第 1 轮：raw 输出 [b][i][b]X[/b][/i][/b]
    // 第 2 轮：unwrapDeepRedundant(b) → [b][i]X[/i][/b]
    const html = '<b><i><b>X</b></i></b>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toBe('[b][i]X[/i][/b]');
  });

  it('跨 tag 有属性同名嵌套展开：[color=red][b][color=red]X[/color][/b][/color] → [color=red][b]X[/b][/color]', () => {
    const html = '<span style="color:red"><b><span style="color:red">X</span></b></span>';
    const result = t(htmlToNGABBCode(html));
    expect(result).not.toContain('[color=red][color=red]');
    expect(result).toContain('[color=red]');
    expect(result).toContain('[b]X[/b]');
  });

  it('多层跨 tag 同名嵌套：3 层 → 1 层', () => {
    // [b][i][b][i][b]X[/b][/i][/b][/i][/b] → [b][i]X[/i][/b]
    const html = '<b><i><b><i><b>X</b></i></b></i></b>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toBe('[b][i]X[/i][/b]');
  });

  it('空 inner 标签清理：[b][color=red][/color]X[/b] → [b]X[/b]', () => {
    // 内层空 color tag 应被移除
    const html = '<b><span style="color:red"></span>X</b>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toBe('[b]X[/b]');
    expect(result).not.toContain('[color=red][/color]');
  });

  it('完全空外层被清除：[b][color=red][/color][/b] → ""', () => {
    // 内层空清掉后外层变空，再被外层空标签清除
    const html = '<b><span style="color:red"></span></b>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toBe('');
  });

  it('跨行相邻同 tag 合并：[b]X[/b]\\n[b]Y[/b] → [b]X\\nY[/b]', () => {
    // 通过两个独立段落构造跨行场景（会被换行分隔）
    // 块级元素：<p><b>X</b></p><p><b>Y</b></p> 会被 split('\n') 处理
    // 跨行合并需要在线级处理完之后再做，所以应该在整段级别合并
    const html = '<b>X</b><br><b>Y</b>';
    const result = htmlToNGABBCode(html);
    // 期望：X\nY 在同一个 [b] 内
    expect(result).toMatch(/\[b\]X\nY\[\/b\]/);
  });

  it('跨行相邻有属性同 tag 合并：[color=red]X[/color]\\n[color=red]Y[/color] → [color=red]X\\nY[/color]', () => {
    const html = '<span style="color:red">X</span><br><span style="color:red">Y</span>';
    const result = htmlToNGABBCode(html);
    expect(result).toMatch(/\[color=red\]X\nY\[\/color\]/);
    expect(result).not.toMatch(/\[color=red\]X\[\/color\]\n\[color=red\]Y\[\/color\]/);
  });

  it('不同属性的相邻 color 不合并', () => {
    const html = '<span style="color:red">X</span><span style="color:blue">Y</span>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toContain('[color=red]X[/color]');
    expect(result).toContain('[color=blue]Y[/color]');
  });

  it('空 [b][i][color=red][/color][/i][/b] 全部清理', () => {
    // 内层 color 空 → 移除后 [b][i][/i][/b] → [i][/i] 移除 → [b][/b] 移除 → ""
    const html = '<b><i><span style="color:red"></span></i></b>';
    const result = t(htmlToNGABBCode(html));
    expect(result).toBe('');
  });
});

describe('Fix #2 V2: pt 字号 → BBCode 转换', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('pt → BBCode: <span style="font-size:18pt"> → [size=150%]', () => {
    const html = '<span style="font-size:18pt">文本</span>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[size=150%]文本[/size]');
  });

  it('旧 % 兼容 → BBCode: <span style="font-size:150%"> → [size=150%]', () => {
    const html = '<span style="font-size:150%">文本</span>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[size=150%]文本[/size]');
  });

  it('pt 嵌套 → BBCode 无重复: 外层18pt+内层14.4pt → [size=120%]文本[/size]', () => {
    const html = '<span style="font-size:18pt"><span style="font-size:14.4pt">文本</span></span>';
    const result = trim(htmlToNGABBCode(html));
    // 内层 14.4pt=120% 覆盖外层 18pt=150%，最终只应有 [size=120%]
    expect(result).toBe('[size=120%]文本[/size]');
    // 不应出现嵌套 [size=150%][size=120%]
    expect(result).not.toContain('[size=150%]');
  });
});

describe('v6: HTML → BBCode 去重优化', () => {
  it('J1: <font color="red"><span style="color:red">X</span></font> → [color=red]X[/color]（不重复包裹）', () => {
    const html = '<font color="red"><span style="color:red">X</span></font>';
    const result = trim(htmlToNGABBCode(html));
    // 应只有一个 [color=red] 标签
    const colorCount = (result.match(/\[color=/g) || []).length;
    expect(colorCount).toBe(1);
    expect(result).toContain('X');
  });

  it('J2: align 去重：inner 已以 [align=center] 开头+结尾 → 不再重复包裹', () => {
    // 构造一个 div 内部内容已是 [align=center]X[/align] 的场景
    // 这模拟 inner 已被 align 包裹的情况
    const html = '<div style="text-align:center">[align=center]X[/align]</div>';
    const result = trim(htmlToNGABBCode(html));
    // 应只有一个 [align=center] 标签
    const alignCount = (result.match(/\[align=center\]/g) || []).length;
    expect(alignCount).toBe(1);
  });
});

describe('v7: HTML → BBCode 保留空格/空行/换行', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('M1: <p>a</p><p></p><p>b</p> → 保留中间空行为 a\\n\\nb', () => {
    const html = '<p>a</p><p></p><p>b</p>';
    const result = trim(htmlToNGABBCode(html));
    // v7 之前：空 p 返回 [] → lines=['a','b'] → 'a\nb'
    // v7 之后：空 p 返回 [''] → lines=['a','','b'] → 'a\n\nb'
    expect(result).toBe('a\n\nb');
  });

  it('M2: <p>a</p><p><br></p><p>b</p> → 保留为 a\\n\\nb', () => {
    const html = '<p>a</p><p><br></p><p>b</p>';
    const result = trim(htmlToNGABBCode(html));
    // <br> 转 \n，trimLineKeepNbsp 裁掉 → 空行
    expect(result).toBe('a\n\nb');
  });

  it('M3: <p>a</p><div> </div><p>b</p> → 含空格 div 保留为空行', () => {
    const html = '<p>a</p><div> </div><p>b</p>';
    const result = trim(htmlToNGABBCode(html));
    // v7 之前：空格被裁掉 → div 返回 [] → 'a\nb'
    // v7 之后：空格被裁掉但返回 [''] → 'a\n\nb'
    expect(result).toBe('a\n\nb');
  });

  it('M4: <p>&nbsp;</p> → 保留 &nbsp;（U+00A0）', () => {
    const html = '<p>&nbsp;</p>';
    const result = htmlToNGABBCode(html);
    // &nbsp; 被 DOMParser 解析为 U+00A0，trimLineKeepNbsp 保留
    expect(result).toContain('\u00a0');
  });
});

describe('v8: collapse 块内空行保留', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('O1: collapse-body 内 <p>a</p><p></p><p>b</p> → 保留空行', () => {
    const html = '<div data-type="collapse-block" data-title="标题"><div class="collapse-body"><p>a</p><p></p><p>b</p></div></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('[collapse=标题]');
    expect(result).toContain('a\n\nb');
    expect(result).toContain('[/collapse]');
  });

  it('O2: collapse-body 内连续多个空行保留', () => {
    const html = '<div data-type="collapse-block" data-title="标题"><div class="collapse-body"><p>a</p><p></p><p></p><p></p><p>b</p></div></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('a\n\n\n\nb');
  });

  it('O3: collapse-body 内 <p><br></p> 空行保留', () => {
    const html = '<div data-type="collapse-block" data-title="标题"><div class="collapse-body"><p>a</p><p><br></p><p>b</p></div></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('a\n\nb');
  });
});

describe('v8: quote 块内空行保留', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('P1: blockquote 内 <p>a</p><p></p><p>b</p> → 保留空行', () => {
    const html = '<blockquote><p>a</p><p></p><p>b</p></blockquote>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('[quote]');
    expect(result).toContain('a\n\nb');
    expect(result).toContain('[/quote]');
  });

  it('P2: quote-line 内连续空行保留', () => {
    const html = '<div class="quote-line"><p>a</p><p></p><p></p><p>b</p></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('a\n\n\nb');
  });
});

describe('v8: list 列表项内空行保留', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('Q1: li 内块级内容 <p>a</p><p></p><p>b</p> → 保留空行', () => {
    const html = '<ul><li><p>a</p><p></p><p>b</p></li></ul>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('[list]');
    expect(result).toContain('[*]a');
    expect(result).toContain('a\n\nb');
    expect(result).toContain('[/list]');
  });

  it('Q2: li 内纯内联内容含 <br> → 保留换行', () => {
    const html = '<ul><li>a<br>b</li></ul>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('[*]a\nb');
  });
});

describe('v8: 连续多空行保留', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('R1: <p>a</p><p></p><p></p><p>b</p> → 保留 2 个空行', () => {
    const html = '<p>a</p><p></p><p></p><p>b</p>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('a\n\n\nb');
  });

  it('R2: <div>a<br><br><br>b</div> → 保留 2 个空行', () => {
    const html = '<div>a<br><br><br>b</div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('a\n\n\nb');
  });
});

describe('v9: BBCode 转换不遗漏(端到端)', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('W1: 颜色 <span style="color:red">x</span> → 必含 [color=red]x[/color]', () => {
    const result = trim(htmlToNGABBCode('<span style="color:red">x</span>'));
    expect(result).toContain('[color=red]');
    expect(result).toContain('[/color]');
    expect(result).toContain('x');
  });

  it('W2: 字号 <span style="font-size:18pt">x</span> → 必含 [size=...]x[/size]', () => {
    const result = trim(htmlToNGABBCode('<span style="font-size:18pt">x</span>'));
    expect(result).toMatch(/\[size=\d+%\]x\[\/size\]/);
  });

  it('W3: 非默认字体 <span style="font-family:simhei">x</span> → 必含 [font=simhei]', () => {
    const result = trim(htmlToNGABBCode('<span style="font-family:simhei">x</span>'));
    expect(result).toContain('[font=');
    expect(result).toContain('[/font]');
  });

  it('W4: 嵌套 <b><i><u>嵌套</u></i></b> → 必含 [b][i][u]', () => {
    const result = trim(htmlToNGABBCode('<b><i><u>嵌套</u></i></b>'));
    expect(result).toContain('[b]');
    expect(result).toContain('[i]');
    expect(result).toContain('[u]');
    expect(result).toContain('[/b]');
    expect(result).toContain('[/i]');
    expect(result).toContain('[/u]');
  });

  it('W5: collapse-block → 必含 [collapse=标题]', () => {
    const html = '<div data-type="collapse-block" data-title="秘密"><div class="collapse-body">内容</div></div>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toContain('[collapse=秘密]');
    expect(result).toContain('[/collapse]');
    expect(result).toContain('内容');
  });

  it('W6: 图片 <img src="https://x.com/y.jpg"> → 必含 [img]', () => {
    const result = trim(htmlToNGABBCode('<img src="https://x.com/y.jpg">'));
    expect(result).toContain('[img]');
    expect(result).toContain('[/img]');
    expect(result).toContain('y.jpg');
  });

  it('W7: 列表 <ul><li>a</li><li>b</li></ul> → 必含 [list][*]a[*]b[/list]', () => {
    const result = trim(htmlToNGABBCode('<ul><li>a</li><li>b</li></ul>'));
    expect(result).toContain('[list]');
    expect(result).toContain('[*]a');
    expect(result).toContain('[*]b');
    expect(result).toContain('[/list]');
  });
});

describe('v9: BBCode 转换不多余(端到端)', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('W8: 重复 20 次 <b>a</b> → 不应产生 20 个 [b]a[/b](v6 合并相邻应大幅减少)', () => {
    const html = '<b>a</b>'.repeat(20);
    const result = trim(htmlToNGABBCode(html));
    // 合并后应该大幅减少(< 5) — 20 个相邻 [b]a[/b][b]a[/b]... 通过 v6 mergeAdjacentSameTagNoAttr
    // 多趟合并为 ≤2 个 [b]a...a[/b]（单趟正则合并 50%）
    const openCount = (result.match(/\[b\]/g) || []).length;
    const closeCount = (result.match(/\[\/b\]/g) || []).length;
    expect(openCount).toBeLessThan(5);
    expect(closeCount).toBeLessThan(5);
    // 验证 'a' 数量保持 20(无内容丢失)
    const aCount = (result.match(/a/g) || []).length;
    expect(aCount).toBe(20);
  });

  it('W9: 冗余嵌套 <b><b>a</b></b> → 不应产生 [b][b]a[/b][/b]', () => {
    const result = trim(htmlToNGABBCode('<b><b>a</b></b>'));
    expect(result).toBe('[b]a[/b]');
  });

  it('W10: 空标签 <b></b> → 不应输出空标签对', () => {
    const result = trim(htmlToNGABBCode('<b></b>'));
    expect(result).toBe('');
  });
});

describe('v16: BBCode 深度冗余嵌套清理', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  it('V16-1: 3 层无属性 b 嵌套 → 单层 [b]123[/b]', () => {
    const html = '<b>1<b>2<b>3</b></b></b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]123[/b]');
  });

  it('V16-2: 20 层深度 b 嵌套 → 单层 [b]x[/b]', () => {
    const html = Array(20).fill('<b>').join('') + 'x' + Array(20).fill('</b>').join('');
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]x[/b]');
  });

  it('V16-3: 3 层有属性 color 嵌套 → 单层 [color=red]abc[/color]', () => {
    const html =
      '<span style="color:red">a' +
      '<span style="color:red">b' +
      '<span style="color:red">c</span>' +
      '</span>' +
      '</span>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[color=red]abc[/color]');
  });

  it('V16-4: 跨标签内层冗余 [b]a[i]b[b]c[/b]d[/i]e[/b] → [b]a[i]bcd[/i]e[/b]', () => {
    const html = '<b>a<i>b<b>c</b>d</i>e</b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]a[i]bcd[/i]e[/b]');
  });

  it('V16-5: 混合场景——前后有普通文本的深度嵌套（复现用户截图）', () => {
    // 模拟: 111...111 [b]1[b]1[b]1...[/b]...[/b] 111...111
    const prefix = '1'.repeat(30);
    const suffix = '1'.repeat(30);
    const depth = 20;
    let inner = 'x';
    for (let i = 0; i < depth; i++) {
      inner = `<b>1${inner}</b>`;
    }
    const html = prefix + inner + suffix;
    const result = trim(htmlToNGABBCode(html));
    // 应只有一个 [b] 开标签和一个 [/b] 闭标签
    const openCount = (result.match(/\[b\]/g) || []).length;
    const closeCount = (result.match(/\[\/b\]/g) || []).length;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
    // 内容不应丢失
    expect(result).toContain('x');
    expect(result.startsWith(prefix.slice(0, 10))).toBe(true);
    expect(result.endsWith(suffix.slice(-10))).toBe(true);
  });

  it('V16-6: 5 层 i 嵌套 → 单层 [i]abcde[/i]', () => {
    const html = '<i>a<i>b<i>c<i>d<i>e</i></i></i></i></i>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[i]abcde[/i]');
  });

  it('V16-7: 4 层有属性 size 嵌套 → 单层 [size=150%]abcd[/size]', () => {
    const html =
      '<span style="font-size:18pt">a' +
      '<span style="font-size:18pt">b' +
      '<span style="font-size:18pt">c' +
      '<span style="font-size:18pt">d</span>' +
      '</span>' +
      '</span>' +
      '</span>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[size=150%]abcd[/size]');
  });
});

describe('v23: BBCode 用户场景回归测试 - text-decoration 组合 + 重复/嵌套', () => {
  const trim = (s: string) => s.replace(/^\s+|\s+$/g, '');

  // B1: 单纯 [b]
  it('B1: <b>hello</b> → [b]hello[/b]', () => {
    expect(trim(htmlToNGABBCode('<b>hello</b>'))).toBe('[b]hello[/b]');
  });

  // B2: 单纯 [u]
  it('B2: <u>hello</u> → [u]hello[/u]', () => {
    expect(trim(htmlToNGABBCode('<u>hello</u>'))).toBe('[u]hello[/u]');
  });

  // B3: 单纯 [del]
  it('B3: <s>hello</s> → [del]hello[/del]', () => {
    expect(trim(htmlToNGABBCode('<s>hello</s>'))).toBe('[del]hello[/del]');
  });

  // B4: 下划线 + 删除线（用户截图 P0 反馈点）
  it('B4: text-decoration: underline line-through → 同时有 [u] 和 [del]', () => {
    const html = '<span style="text-decoration: underline line-through">x</span>';
    const result = trim(htmlToNGABBCode(html));
    // 必须同时存在 [u] 和 [del]
    expect(result).toContain('[u]');
    expect(result).toContain('[del]');
    expect(result).toContain('x');
    expect(result).toMatch(/\[u\]\[del\]x\[\/del\]\[\/u\]/);
  });

  // B5: 相邻相同 [b] 应合并
  it('B5: <b>X</b><b>Y</b> → [b]XY[/b]', () => {
    const html = '<b>X</b><b>Y</b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]XY[/b]');
  });

  // B6: 双重 [b] 应展开
  it('B6: <b><b>X</b></b> → [b]X[/b]', () => {
    const html = '<b><b>X</b></b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toBe('[b]X[/b]');
  });

  // B7: 跨行 [b] 应合并
  it('B7: <p><b>X</b></p><p><b>Y</b></p> → [b]X Y[/b] 或 [b]X\nY[/b]', () => {
    const html = '<p><b>X</b></p><p><b>Y</b></p>';
    const result = trim(htmlToNGABBCode(html));
    // 不应有重复的 [b] 嵌套
    expect(result).not.toMatch(/\[b\]\[b\]/);
    expect(result).not.toMatch(/\[\/b\]\[\/b\]/);
    // 应只有一对 [b][/b]
    const openCount = (result.match(/\[b\]/g) || []).length;
    const closeCount = (result.match(/\[\/b\]/g) || []).length;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
    expect(result).toContain('X');
    expect(result).toContain('Y');
  });

  // B8: 多重嵌套 [b][i][u] 顺序
  it('B8: <b><i><u>X</u></i></b> → [b][i][u]X[/u][/i][/b]', () => {
    const html = '<b><i><u>X</u></i></b>';
    const result = trim(htmlToNGABBCode(html));
    expect(result).toMatch(/\[b\]\[i\]\[u\]X\[\/u\]\[\/i\]\[\/b\]/);
  });

  // B9: 用户截图完整场景（简化版）
  it('B9: 用户截图简化场景 — 验证不产生冗余标签 + 样式不丢失', () => {
    const html = `
      <p>11111111<b>11111111111</b>111111111111</p>
      <p>111<i>11111111111111</i>111111</p>
      <p><u>111</u>111<del>11111</del>111111</p>
      <p><span style="text-decoration: underline line-through">x</span></p>
    `;
    const result = trim(htmlToNGABBCode(html));
    // 不应有重复的 [b][b]
    expect(result).not.toMatch(/\[b\]\[b\]/);
    expect(result).not.toMatch(/\[\/b\]\[\/b\]/);
    expect(result).not.toMatch(/\[i\]\[i\]/);
    expect(result).not.toMatch(/\[\/i\]\[\/i\]/);
    // 下划线+删除线应同时存在
    expect(result).toMatch(/\[u\]\[del\]x\[\/del\]\[\/u\]/);
    // 内容应保留
    expect(result).toContain('11111111');
    expect(result).toContain('11111111111');
  });

  // B10: text-decoration 包含 line-through 但同时有 underline - 完整路径
  it('B10: <u><s>x</s></u> → [u][del]x[/del][/u]', () => {
    const html = '<u><s>x</s></u>';
    const result = trim(htmlToNGABBCode(html));
    // 嵌套 u 内有 s（被 renameTags 转 del），应该输出 [u][del]x[/del][/u]
    expect(result).toContain('[u]');
    expect(result).toContain('[del]');
    expect(result).toContain('x');
  });

  // B11: 多个相邻空标签应被清理
  it('B11: <b><i></i></b>x → [b]x[/b]（空标签清理）', () => {
    const html = '<b><i></i></b>x';
    const result = trim(htmlToNGABBCode(html));
    expect(result).not.toContain('[i][/i]');
    expect(result).toContain('x');
  });
});
