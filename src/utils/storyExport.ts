interface ExportableStory {
  title: string;
  description?: string;
  chapters?: Array<{
    title: string;
    order_index?: number;
    sections?: Array<{
      title: string;
      order_index?: number;
      content?: string;
    }>;
  }>;
}

function htmlToText(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') {
    // Node environment - simple regex strip
    return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export function exportStoryAsMarkdown(story: ExportableStory): string {
  const lines: string[] = [];
  lines.push(`# ${story.title || '未命名作品'}`);
  lines.push('');
  if (story.description) {
    lines.push(`> ${story.description}`);
    lines.push('');
  }
  const chapters = story.chapters || [];
  for (const ch of chapters) {
    lines.push(`## ${ch.title || '未命名章节'}`);
    lines.push('');
    const sections = ch.sections || [];
    for (const sec of sections) {
      lines.push(`### ${sec.title || '未命名小节'}`);
      lines.push('');
      const text = htmlToText(sec.content || '');
      if (text) {
        lines.push(text);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

export function exportStoryAsPlainText(story: ExportableStory): string {
  const lines: string[] = [];
  lines.push(story.title || '未命名作品');
  lines.push('');
  const chapters = story.chapters || [];
  for (const ch of chapters) {
    lines.push(ch.title || '未命名章节');
    lines.push('');
    const sections = ch.sections || [];
    for (const sec of sections) {
      lines.push(sec.title || '未命名小节');
      const text = htmlToText(sec.content || '');
      if (text) {
        lines.push(text);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
