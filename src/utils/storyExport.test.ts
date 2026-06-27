import { describe, it, expect } from 'vitest';
import { exportStoryAsMarkdown, exportStoryAsPlainText } from './storyExport';

describe('exportStoryAsMarkdown', () => {
  it('输出 # 标题 + ## 章节标题 + ### 节标题 + 内容', () => {
    const story = {
      title: '测试作品',
      description: '描述',
      chapters: [
        {
          title: '第一章',
          order_index: 0,
          sections: [
            { title: '第一节', order_index: 0, content: '<p>段落内容</p>' },
            { title: '第二节', order_index: 1, content: '<p>第二段</p>' },
          ],
        },
      ],
    } as any;
    const md = exportStoryAsMarkdown(story);
    expect(md).toContain('# 测试作品');
    expect(md).toContain('## 第一章');
    expect(md).toContain('### 第一节');
    expect(md).toContain('段落内容');
    expect(md).toContain('第二段');
  });

  it('空 chapters 不报错', () => {
    const story = { title: '空作品', chapters: [] } as any;
    const md = exportStoryAsMarkdown(story);
    expect(md).toContain('# 空作品');
  });

  it('HTML 标签被去除，只保留文本', () => {
    const story = {
      title: 'T',
      chapters: [{ title: 'C', order_index: 0, sections: [{ title: 'S', order_index: 0, content: '<b>粗体</b>文本' }] }],
    } as any;
    const md = exportStoryAsMarkdown(story);
    expect(md).toContain('粗体文本');
    expect(md).not.toContain('<b>');
  });
});

describe('exportStoryAsPlainText', () => {
  it('输出纯文本无 Markdown 标记', () => {
    const story = {
      title: '测试',
      chapters: [{ title: '章', order_index: 0, sections: [{ title: '节', order_index: 0, content: '<p>内容</p>' }] }],
    } as any;
    const txt = exportStoryAsPlainText(story);
    expect(txt).toContain('测试');
    expect(txt).toContain('章');
    expect(txt).toContain('节');
    expect(txt).toContain('内容');
    expect(txt).not.toContain('#');
  });

  it('空内容不报错', () => {
    const story = { title: '空', chapters: [] } as any;
    const txt = exportStoryAsPlainText(story);
    expect(txt).toContain('空');
  });
});
