// 临时分析脚本:检查 story JSON 文件的实际数据
const fs = require('fs');
const path = require('path');

const storiesDir = 'e:\\Codes\\else\\AIProject\\AnkeCreator\\data\\stories';
const files = fs.readdirSync(storiesDir).filter(f => f.endsWith('.json'));

for (const file of files) {
  const fullPath = path.join(storiesDir, file);
  const stat = fs.statSync(fullPath);
  console.log(`\n========== ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB) ==========`);

  const raw = fs.readFileSync(fullPath, 'utf-8');
  const bundle = JSON.parse(raw);

  console.log(`story.title: ${bundle.story?.title}`);
  console.log(`format: ${bundle.format}, version: ${bundle.version}`);
  console.log(`volumes count: ${bundle.volumes?.length}`);
  console.log(`chapters count: ${bundle.chapters?.length}`);
  console.log(`sections count: ${bundle.sections?.length}`);

  // 列出所有 volumes
  console.log(`\n--- Volumes ---`);
  for (const v of (bundle.volumes || [])) {
    console.log(`  id=${v.id?.substring(0, 8)} title="${v.title}" order=${v.order_index} word_count=${v.word_count}`);
  }

  // 列出所有 chapters
  console.log(`\n--- Chapters ---`);
  for (const c of (bundle.chapters || [])) {
    console.log(`  id=${c.id?.substring(0, 8)} vol=${c.volume_id?.substring(0, 8)} title="${c.title}" order=${c.order_index} word_count=${c.word_count}`);
  }

  // 列出所有 sections (按 chapter_id 分组)
  console.log(`\n--- Sections (grouped by chapter) ---`);
  const byChapter = {};
  for (const s of (bundle.sections || [])) {
    const k = s.chapter_id?.substring(0, 8) || 'null';
    if (!byChapter[k]) byChapter[k] = [];
    byChapter[k].push(s);
  }
  for (const [chId, secs] of Object.entries(byChapter)) {
    console.log(`\n  Chapter ${chId} (${secs.length} sections):`);
    secs.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    for (const s of secs) {
      const contentLen = s.content?.length ?? 0;
      console.log(`    id=${s.id?.substring(0, 8)} order=${s.order_index} title="${s.title}" content_len=${contentLen} word_count=${s.word_count}`);
    }
  }

  // 找到 title 为"重逢是故事的起点"的章
  const targetCh = (bundle.chapters || []).find(c => c.title === '重逢是故事的起点');
  if (targetCh) {
    console.log(`\n=== Target Chapter: 重逢是故事的起点 ===`);
    console.log(`  id=${targetCh.id}`);
    console.log(`  volume_id=${targetCh.volume_id}`);
    console.log(`  order_index=${targetCh.order_index}`);
    console.log(`  word_count=${targetCh.word_count}`);
    const targetSecs = (bundle.sections || []).filter(s => s.chapter_id === targetCh.id);
    console.log(`  sections count: ${targetSecs.length}`);
    targetSecs.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    let totalContentLen = 0;
    for (const s of targetSecs) {
      const cl = s.content?.length ?? 0;
      totalContentLen += cl;
      console.log(`    id=${s.id?.substring(0, 8)} order=${s.order_index} title="${s.title}" content_len=${cl} word_count=${s.word_count}`);
    }
    console.log(`  total content length: ${totalContentLen} chars`);
  } else {
    console.log(`\n!! Chapter "重逢是故事的起点" NOT FOUND in this story`);
  }
}
