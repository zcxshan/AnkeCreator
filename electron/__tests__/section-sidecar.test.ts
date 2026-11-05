// ============================================================
// 节正文侧车（data/sections/<sectionId>.json）测试
//
// 覆盖三类场景：
//   1. 旧格式：正文仍内联在 bundle 中，读取必须照常可用
//   2. 侧车损坏：主文件损坏时从 .bak 恢复
//   3. 启动迁移：内联正文被拆分到侧车，bundle 只留元数据
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'appData' ? os.tmpdir() : os.tmpdir()),
    getAppPath: () => process.env.APP_ROOT || process.cwd(),
    getName: () => 'test-app',
  },
  ipcMain: {
    handle: () => {},
  },
}));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-sidecar-'));
process.env.APP_ROOT = tmpDir;

import * as db from '../db-main';

const storiesDir = path.join(tmpDir, 'data', 'stories');
const sectionsDir = path.join(tmpDir, 'data', 'sections');

function cleanup() {
  for (const dir of [storiesDir, sectionsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 直接写一份「旧格式」bundle：正文内联在 sections 中 */
function writeLegacyBundle(storyId: string): { chapterId: string; sectionId: string } {
  const now = new Date().toISOString();
  const chapterId = `ch-${storyId}`;
  const sectionId = `sec-${storyId}`;
  const bundle = {
    format: 'anke-creator-story-v2',
    version: '2.0',
    exportedAt: now,
    story: {
      id: storyId,
      title: '旧格式作品',
      description: '',
      category: '',
      order_index: 0,
      is_starred: 0,
      is_pinned: 0,
      is_deleted: 0,
      created_at: now,
      updated_at: now,
    },
    volumes: [],
    chapters: [
      {
        id: chapterId,
        story_id: storyId,
        volume_id: null,
        title: '第1章',
        order_index: 0,
        word_count: 4,
        created_at: now,
        updated_at: now,
      },
    ],
    sections: [
      {
        id: sectionId,
        chapter_id: chapterId,
        title: '第1节',
        content: '<p>旧正文</p>',
        bbcode: '[p]旧正文[/p]',
        order_index: 0,
        word_count: 4,
        created_at: now,
        updated_at: now,
      },
    ],
    world_settings: [],
    characters: [],
    character_relations: [],
    outlines: [],
    dice_history: [],
    stats: { word_count: 4, section_count: 1, chapter_count: 1 },
  };
  if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });
  fs.writeFileSync(path.join(storiesDir, `${storyId}.json`), JSON.stringify(bundle), 'utf-8');
  return { chapterId, sectionId };
}

describe('节正文侧车', () => {
  beforeEach(() => {
    cleanup();
  });

  it('旧格式：bundle 内联正文仍可被 listSections / getSectionContent 读取', () => {
    const { chapterId, sectionId } = writeLegacyBundle('legacy-story');

    const sections = db.listSections(chapterId);
    expect(sections).toHaveLength(1);
    expect(sections[0].content).toBe('<p>旧正文</p>');
    expect(sections[0].bbcode).toBe('[p]旧正文[/p]');
    expect(db.getSectionContent(sectionId)).toBe('<p>旧正文</p>');
  });

  it('迁移后：listSectionMetadata 返回元数据，listSections / getStoryWithAll 从侧车补齐正文', async () => {
    const story = db.createStory({ title: '侧车测试' });
    const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
    const sec = await db.createSection({ chapter_id: ch.id, title: 'S1', content: '<p>hello</p>' });

    // 侧车存在，bundle 内不存正文
    expect(fs.existsSync(path.join(sectionsDir, `${sec.id}.json`))).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(path.join(storiesDir, `${story.id}.json`), 'utf-8'));
    expect(bundle.sections[0].content).toBeNull();

    expect(db.listSectionMetadata(ch.id)[0]).not.toHaveProperty('content');
    expect(db.listSections(ch.id)[0].content).toBe('<p>hello</p>');
    const full = db.getStoryWithAll(story.id);
    expect(full.sections[0].content).toBe('<p>hello</p>');
    expect(full.chapters[0].sections[0].content).toBe('<p>hello</p>');
  });

  it('侧车主文件损坏时从 .bak 恢复', async () => {
    const story = db.createStory({ title: '损坏恢复' });
    const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
    const sec = await db.createSection({ chapter_id: ch.id, title: 'S1', content: '<p>v1</p>' });

    await db.setSectionContent(sec.id, '<p>v2</p>');

    // 此时 .bak 保存的是上一版（v1）
    const sidecarPath = path.join(sectionsDir, `${sec.id}.json`);
    expect(fs.existsSync(`${sidecarPath}.bak`)).toBe(true);
    fs.writeFileSync(sidecarPath, '{"broken":', 'utf-8');

    expect(db.getSectionContent(sec.id)).toBe('<p>v1</p>');
    // 恢复后主文件重新可解析
    expect(() => JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'))).not.toThrow();
  });

  it('删除节 / 删除作品会清理侧车文件', async () => {
    const story = db.createStory({ title: '清理测试' });
    const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
    const sec = await db.createSection({ chapter_id: ch.id, title: 'S1', content: '<p>x</p>' });

    await db.deleteSection(sec.id);
    expect(fs.existsSync(path.join(sectionsDir, `${sec.id}.json`))).toBe(false);

    const sec2 = await db.createSection({ chapter_id: ch.id, title: 'S2', content: '<p>y</p>' });
    db.deleteStory(story.id);
    expect(fs.existsSync(path.join(sectionsDir, `${sec2.id}.json`))).toBe(false);
  });

  it('启动迁移：把旧格式内联正文拆到侧车，且内容不丢', async () => {
    const { sectionId } = writeLegacyBundle('legacy-migrate-story');
    db.initMainDatabase();

    // 迁移在后台按作品分批执行，轮询等待侧车出现
    const sidecarPath = path.join(sectionsDir, `${sectionId}.json`);
    await vi.waitFor(
      () => {
        expect(fs.existsSync(sidecarPath)).toBe(true);
      },
      { timeout: 5000, interval: 50 },
    );

    expect(db.getSectionContent(sectionId)).toBe('<p>旧正文</p>');
    const bundle = JSON.parse(
      fs.readFileSync(path.join(storiesDir, 'legacy-migrate-story.json'), 'utf-8'),
    );
    expect(bundle.sections[0].content).toBeNull();
    expect(bundle.sections[0].bbcode).toBeNull();
    // 正文仍然可读
    expect(db.getStoryWithAll('legacy-migrate-story').sections[0].content).toBe('<p>旧正文</p>');
    // 迁移前备份存在
    expect(
      fs.existsSync(path.join(tmpDir, 'data', 'backup', 'pre-sections-sidecar', 'legacy-migrate-story.json')),
    ).toBe(true);
  });
});
