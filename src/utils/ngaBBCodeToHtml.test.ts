import { describe, it, expect } from 'vitest';
import { bbcodeToHtml, expandNgaImageUrl } from './ngaBBCodeToHtml';

describe('expandNgaImageUrl', () => {
  it('保持 https 完整 URL 不变', () => {
    expect(expandNgaImageUrl('https://img.example.com/x.jpg')).toBe(
      'https://img.example.com/x.jpg',
    );
  });
  it('保持 http 完整 URL 不变', () => {
    expect(expandNgaImageUrl('http://img.example.com/x.jpg')).toBe(
      'http://img.example.com/x.jpg',
    );
  });
  it('保持 // 协议相对 URL 不变', () => {
    expect(expandNgaImageUrl('//img.example.com/x.jpg')).toBe(
      '//img.example.com/x.jpg',
    );
  });
  it('补全 ./ 开头的相对路径', () => {
    expect(expandNgaImageUrl('./mon_202606/19/abc.webp')).toBe(
      'https://img.nga.178.com/attachments/mon_202606/19/abc.webp',
    );
  });
  it('补全 mon_ 开头（无 ./）的相对路径', () => {
    expect(expandNgaImageUrl('mon_202606/19/abc.webp')).toBe(
      'https://img.nga.178.com/attachments/mon_202606/19/abc.webp',
    );
  });
  it('空字符串返回空字符串', () => {
    expect(expandNgaImageUrl('')).toBe('');
  });
});

describe('bbcodeToHtml - [img] URL 补全', () => {
  it('[img]./mon_xxx.webp[/img] 渲染为完整 URL', () => {
    const html = bbcodeToHtml('[img]./mon_202606/19/abc.webp[/img]');
    expect(html).toContain('https://img.nga.178.com/attachments/mon_202606/19/abc.webp');
    expect(html).not.toContain('src="./mon_');
  });
  it('[img]mon_xxx.webp[/img]（无 ./）也补全', () => {
    const html = bbcodeToHtml('[img]mon_202606/19/abc.webp[/img]');
    expect(html).toContain('https://img.nga.178.com/attachments/mon_202606/19/abc.webp');
  });
  it('[img]https://x.com/y.jpg[/img] 完整 URL 不变', () => {
    const html = bbcodeToHtml('[img]https://x.com/y.jpg[/img]');
    expect(html).toContain('src="https://x.com/y.jpg"');
  });
  it('[img]./mon_202606/19/lsQ86-jmorK2cT3cSxc-mu.webp.medium.jpg[/img] 用户实际输入格式', () => {
    const html = bbcodeToHtml('[img]./mon_202606/19/lsQ86-jmorK2cT3cSxc-mu.webp.medium.jpg[/img]');
    expect(html).toContain('data-type="image-block"');
    expect(html).toContain('src="https://img.nga.178.com/attachments/mon_202606/19/lsQ86-jmorK2cT3cSxc-mu.webp.medium.jpg"');
    expect(html).not.toContain('src="./mon_');
  });
});

describe('bbcodeToHtml - [collapse] 可交互折叠块', () => {
  it('[collapse=折叠]X[/collapse] 输出的 HTML 含 data-collapsed / collapse-toggle / collapse-body', () => {
    const html = bbcodeToHtml('[collapse=折叠]X[/collapse]');
    // 数据属性：可被 JS 识别来 toggle
    expect(html).toContain('data-type="collapse-block"');
    expect(html).toContain('data-collapsed="true"');
    // 关键子节点：toggle span + body div + title span
    expect(html).toContain('collapse-toggle');
    expect(html).toContain('collapse-body');
    expect(html).toContain('collapse-title');
    expect(html).toContain('折叠');
  });

  it('[collapse=折叠]X[/collapse] 默认 body 隐藏（display:none）', () => {
    const html = bbcodeToHtml('[collapse=折叠]X[/collapse]');
    // body 必须默认隐藏 —— 用户点 + 才展开
    expect(html).toMatch(/<div class="collapse-body"[^>]*style="[^"]*display:none/);
  });

  it('[collapse]X[/collapse] 不带 = 时用默认标题"折叠"', () => {
    const html = bbcodeToHtml('[collapse]X[/collapse]');
    expect(html).toContain('data-type="collapse-block"');
    expect(html).toContain('折叠');
  });

  it('collapse 块内可嵌套内容（如 [b] 加粗）', () => {
    const html = bbcodeToHtml('[collapse=折叠][b]hi[/b][/collapse]');
    expect(html).toContain('collapse-body');
    expect(html).toContain('<b>hi</b>');
  });
});

describe('bbcodeToHtml - 基础标签', () => {
  it('[b]x[/b] 输出 <b>x</b>', () => {
    expect(bbcodeToHtml('[b]x[/b]')).toContain('<b>x</b>');
  });

  it('[i]x[/i] 输出 <i>x</i>', () => {
    expect(bbcodeToHtml('[i]x[/i]')).toContain('<i>x</i>');
  });

  it('[u]x[/u] 输出 <u>x</u>', () => {
    expect(bbcodeToHtml('[u]x[/u]')).toContain('<u>x</u>');
  });

  it('[b][i]x[/i][/b] 嵌套不交叉', () => {
    const html = bbcodeToHtml('[b][i]x[/i][/b]');
    expect(html).toContain('<b>');
    expect(html).toContain('<i>');
    expect(html).toContain('</i>');
    expect(html).toContain('</b>');
    const openB = html.indexOf('<b>');
    const openI = html.indexOf('<i>');
    const closeI = html.indexOf('</i>');
    const closeB = html.indexOf('</b>');
    expect(openB).toBeLessThan(openI);
    expect(openI).toBeLessThan(closeI);
    expect(closeI).toBeLessThan(closeB);
  });

  it('[b]x[/b][b]y[/b] 两个独立块', () => {
    const html = bbcodeToHtml('[b]x[/b][b]y[/b]');
    const openTags = (html.match(/<b>/g) || []).length;
    const closeTags = (html.match(/<\/b>/g) || []).length;
    expect(openTags).toBe(2);
    expect(closeTags).toBe(2);
  });
});

describe('bbcodeToHtml - NGA 特殊语法', () => {
  it('[d100]5[/d100] 不抛错（NGA 骰子语法）', () => {
    expect(() => bbcodeToHtml('[d100]5[/d100]')).not.toThrow();
  });

  it('[d=100][/d] 不抛错', () => {
    expect(() => bbcodeToHtml('[d=100][/d]')).not.toThrow();
  });

  it('[s:protoss:123][/s] 不抛错（坛友标签）', () => {
    expect(() => bbcodeToHtml('[s:protoss:123][/s]')).not.toThrow();
  });

  it('[s:123:456]用户名[/s] 不抛错', () => {
    expect(() => bbcodeToHtml('[s:123:456]用户名[/s]')).not.toThrow();
  });

  it('[b]祥子: ROLL 1d2=1[/b] 不抛错（骰子命中行）', () => {
    expect(() => bbcodeToHtml('[b]祥子: ROLL 1d2=1[/b]')).not.toThrow();
  });
});

describe('bbcodeToHtml - 容错', () => {
  it('[b]a[b]b[/b]c[/b] 嵌套错误不抛错', () => {
    expect(() => bbcodeToHtml('[b]a[b]b[/b]c[/b]')).not.toThrow();
  });

  it('[b][i]未闭合 不抛错', () => {
    expect(() => bbcodeToHtml('[b][i]未闭合')).not.toThrow();
  });

  it('[/b] 多余闭标签不抛错', () => {
    expect(() => bbcodeToHtml('text[/b]')).not.toThrow();
  });

  it('空字符串返回空字符串', () => {
    expect(bbcodeToHtml('')).toBe('');
  });

  it('null/undefined 返回空字符串', () => {
    expect(bbcodeToHtml(null as any)).toBe('');
    expect(bbcodeToHtml(undefined as any)).toBe('');
  });
});

describe('bbcodeToHtml - 换行处理', () => {
  it('单行文本中的 \\n 应转为 <br>', () => {
    const html = bbcodeToHtml('第一行\n第二行');
    expect(html).toContain('第一行<br>第二行');
  });

  it('段落间的 \\n\\n 应产生两个 <br>（空行视觉效果）', () => {
    const html = bbcodeToHtml('段落一\n\n段落二');
    expect(html).toContain('段落一<br><br>段落二');
  });

  it('[b]加粗[/b]块内的换行也应转为 <br>', () => {
    const html = bbcodeToHtml('[b]第一行\n第二行[/b]');
    expect(html).toContain('<br>');
    expect(html).toContain('第一行');
    expect(html).toContain('第二行');
  });

  it('纯文本无换行时不应产生多余 <br>', () => {
    const html = bbcodeToHtml('普通文本');
    expect(html).not.toContain('<br>');
  });

  it('[code]块内的 \\n 不应转为 <br>（pre 标签原生保留换行）', () => {
    const html = bbcodeToHtml('[code]line1\nline2\nline3[/code]');
    expect(html).toContain('<pre');
    expect(html).toContain('white-space:pre-wrap');
    expect(html).not.toContain('<br>');
    expect(html).toContain('line1\nline2\nline3');
  });
});

describe('bbcodeToHtml - 真实场景', () => {
  it('混合嵌套 [b][i][u]x[/u][/i][/b]', () => {
    const html = bbcodeToHtml('[b][i][u]x[/u][/i][/b]');
    expect(html).toContain('<b>');
    expect(html).toContain('<i>');
    expect(html).toContain('<u>x</u>');
  });

  it('[b]普通文本[/b] 加未闭合的 [i]', () => {
    expect(() => bbcodeToHtml('[b]普通文本[/b] 加未闭合的 [i]')).not.toThrow();
  });
});

describe('bbcodeToHtml - 未识别标签不自动闭合', () => {
  it('[文本文本] 不生成 [/文本文本]', () => {
    const html = bbcodeToHtml('[文本文本]一些内容');
    expect(html).toContain('[文本文本]');
    expect(html).not.toContain('[/文本文本]');
  });

  it('[文本文本]内容[/文本文本] 保留原始文本不处理为标签', () => {
    const html = bbcodeToHtml('[文本文本]内容[/文本文本]');
    expect(html).toContain('[文本文本]');
    expect(html).toContain('[/文本文本]');
    expect(html).toContain('内容');
  });

  it('[d100=xxx] 带属性的未识别标签不自动闭合', () => {
    const html = bbcodeToHtml('[d100=xxx]内容');
    expect(html).toContain('[d100=xxx]');
    expect(html).not.toContain('[/d100]');
  });

  it('[自定义标签]内容[/自定义标签] 保留原始文本', () => {
    const html = bbcodeToHtml('[自定义标签]内容[/自定义标签]');
    expect(html).toContain('[自定义标签]');
    expect(html).toContain('[/自定义标签]');
    expect(html).toContain('内容');
  });

  it('已知标签内嵌套未识别标签正常工作', () => {
    const html = bbcodeToHtml('[b][文本文本]内容[/文本文本][/b]');
    expect(html).toContain('<b>');
    expect(html).toContain('[文本文本]');
    expect(html).toContain('[/文本文本]');
    expect(html).toContain('内容');
    expect(html).toContain('</b>');
  });
});
