-- ============================================================
-- 安科作者助手 - 数据库 Schema
-- SQLite 3
-- 说明：
--   * 所有 id 为 TEXT (UUID v4)
--   * 所有 JSON 字段用 TEXT 存储，应用层负责序列化/反序列化
--   * created_at / updated_at 为 ISO 8601 字符串（YYYY-MM-DDTHH:mm:ss.sssZ）
--   * order_index 从 0 开始的连续整数，负责同级排序
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ============================================================
-- 元信息表（单例）：存版本号和最后打开时间等
-- ============================================================
CREATE TABLE IF NOT EXISTS app_meta (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version  INTEGER NOT NULL DEFAULT 1,
    last_opened_at  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Story - 故事
-- ============================================================
CREATE TABLE IF NOT EXISTS stories (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_updated_at
    ON stories (updated_at DESC);

-- ============================================================
-- WorldSetting - 世界观设定
--   一条故事可以有多个设定条目（例如：世界规则、势力划分、历史背景）
-- ============================================================
CREATE TABLE IF NOT EXISTS world_settings (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT,          -- 富文本 (NGA 风格 BBCode 或纯文本)
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_settings_story_id
    ON world_settings (story_id, order_index);

-- ============================================================
-- Character - 人物角色
-- ============================================================
CREATE TABLE IF NOT EXISTS characters (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    avatar      TEXT,          -- 图片路径或 base64
    personality TEXT,          -- 性格描述
    attributes  TEXT,          -- JSON: { "HP": 100, "力量": 18, ... }
    notes       TEXT,          -- 自由备注
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_characters_story_id
    ON characters (story_id, order_index);

-- ============================================================
-- Outline - 剧情大纲
-- ============================================================
CREATE TABLE IF NOT EXISTS outlines (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outlines_story_id
    ON outlines (story_id, order_index);

-- ============================================================
-- Chapter - 章
-- ============================================================
CREATE TABLE IF NOT EXISTS chapters (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chapters_story_id
    ON chapters (story_id, order_index);

-- ============================================================
-- Section - 节
-- ============================================================
CREATE TABLE IF NOT EXISTS sections (
    id          TEXT PRIMARY KEY,
    chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sections_chapter_id
    ON sections (chapter_id, order_index);

-- ============================================================
-- ContentBlock - 内容块（核心表）
--
--   type = 'text'   → payload 为 TextBlockJSON
--   type = 'image'  → payload 为 ImageBlockJSON
--   type = 'dice'   → payload 为 DiceBlockJSON
-- ============================================================
CREATE TABLE IF NOT EXISTS content_blocks (
    id          TEXT PRIMARY KEY,
    section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('text', 'image', 'dice')),
    order_index INTEGER NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL,    -- JSON，结构取决于 type
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_blocks_section_id
    ON content_blocks (section_id, order_index);

-- ============================================================
-- 视图：快速获取一个故事的全部章节数和块数
-- ============================================================
CREATE VIEW IF NOT EXISTS story_stats AS
SELECT
    s.id          AS story_id,
    s.title       AS story_title,
    COUNT(DISTINCT c.id)   AS chapter_count,
    COUNT(DISTINCT sec.id) AS section_count,
    COUNT(DISTINCT b.id)   AS block_count
FROM stories s
LEFT JOIN chapters c       ON c.story_id = s.id
LEFT JOIN sections sec    ON sec.chapter_id = c.id
LEFT JOIN content_blocks b ON b.section_id = sec.id
GROUP BY s.id;

-- ============================================================
-- 初始化一条元信息（若不存在）
-- ============================================================
INSERT OR IGNORE INTO app_meta (id, schema_version) VALUES (1, 1);
