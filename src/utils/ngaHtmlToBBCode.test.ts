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
