// stripProseMirrorArtifacts 单元测试
// 覆盖 NGA 用户反馈的真实污染形态（v3.5.4 工程文件 23MB 事故）

import { describe, it, expect } from 'vitest';
import { stripProseMirrorArtifacts, hasProseMirrorArtifacts } from './serialize';

describe('stripProseMirrorArtifacts', () => {
  it('无 PM 痕迹的 HTML 原样返回（快速路径）', () => {
    const html = '<p>AAAA</p><p>中间段落内容</p>';
    expect(stripProseMirrorArtifacts(html)).toBe(html);
  });

  it('空串 / null 语义安全', () => {
    expect(stripProseMirrorArtifacts('')).toBe('');
  });

  it('剥离 ProseMirror-separator img（用户数据中的真实形态）', () => {
    const sep = '<img class="ProseMirror-separator" alt="\\" contenteditable="false">';
    const html = `<p>前段${sep}${sep}${sep}内容${sep}</p><p>后段</p>`;
    expect(stripProseMirrorArtifacts(html)).toBe('<p>前段内容</p><p>后段</p>');
  });

  it('剥离连续成片的 separator（截图 3 中成千上万重复串的缩影）', () => {
    const sep = '<img class="ProseMirror-separator" alt="\\" contenteditable="false">';
    const html = `<p>${sep.repeat(50)}正文${sep.repeat(50)}</p>`;
    expect(stripProseMirrorArtifacts(html)).toBe('<p>正文</p>');
  });

  it('剥离 mark-placeholder 元素（无 class 形态）', () => {
    const html = '<p>甲<span mark-placeholder="true"></span>乙</p>';
    expect(stripProseMirrorArtifacts(html)).toBe('<p>甲乙</p>');
  });

  it('剥离 trailingBreak，不影响正常内容', () => {
    const html = '<p>末段<br class="ProseMirror-trailingBreak"></p>';
    expect(stripProseMirrorArtifacts(html)).toBe('<p>末段</p>');
  });

  it('保留合法内容与样式（b / span style / imageBlock data 属性）', () => {
    const html =
      '<p><b>粗体</b><span style="color: red;">红字</span></p>' +
      '<div data-type="image-block" style="text-align: center;"><img src="a.png"></div>';
    expect(stripProseMirrorArtifacts(html)).toBe(html);
  });

  it('只移除 PM 前缀 class 的元素，保留含其他 class 的正常元素', () => {
    const html =
      '<p><span class="my-own">保留</span><span class="ProseMirror-separator">删</span></p>';
    expect(stripProseMirrorArtifacts(html)).toBe('<p><span class="my-own">保留</span></p>');
  });

  it('全部内容都是 separator 时返回空块', () => {
    const sep = '<img class="ProseMirror-separator" alt="\\" contenteditable="false">';
    expect(stripProseMirrorArtifacts(`<p>${sep}</p>`)).toBe('<p></p>');
  });
});

describe('hasProseMirrorArtifacts', () => {
  it('检测污染与干净内容', () => {
    expect(hasProseMirrorArtifacts('<img class="ProseMirror-separator">')).toBe(true);
    expect(hasProseMirrorArtifacts('<p>干净内容</p>')).toBe(false);
    expect(hasProseMirrorArtifacts('')).toBe(false);
  });
});
