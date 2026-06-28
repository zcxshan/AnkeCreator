/**
 * filterAnjiaPosts 单元测试
 *
 * 背景：Fix #4 — 收集安价正则匹配
 * 在原有"前缀匹配"基础上新增"包含匹配"和"正则匹配"两种模式。
 * - matchMode='prefix'（默认）：content.trim().startsWith(prefix)
 * - matchMode='contains'：content.trim().includes(prefix)
 * - matchMode='regex'：new RegExp(prefix).test(content)，编译失败返回空数组
 * - prefix 为空时返回所有（无论 mode）
 */
import { describe, it, expect } from 'vitest';
import { filterAnjiaPosts, extractPostsFromHtml, type RawPost } from './ngaCrawler';

const makePost = (floor: number, content: string, uid = '1', author = 'tester'): RawPost => ({
  floor,
  author,
  uid,
  content,
});

const samplePosts: RawPost[] = [
  makePost(1, '安价100', 'u1', 'Alice'),
  makePost(2, '今日安价50', 'u2', 'Bob'),
  makePost(3, '安价 200 元', 'u3', 'Carol'),
  makePost(4, '无关内容', 'u4', 'Dave'),
  makePost(5, '安价1000', 'u5', 'Eve'),
];

describe("filterAnjiaPosts - matchMode='prefix'（前缀匹配，默认）", () => {
  it('只返回 content 以 "安价" 开头的楼层', () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '安价', undefined, 'prefix');
    const floors = items.map((i) => i.floor);
    // 1(安价100) / 3(安价 200 元) / 5(安价1000) 命中；2(今日安价50) / 4(无关内容) 不命中
    expect(floors).toEqual([1, 3, 5]);
  });

  it('不传 matchMode 时默认走前缀匹配（向后兼容）', () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '安价');
    const floors = items.map((i) => i.floor);
    expect(floors).toEqual([1, 3, 5]);
  });
});

describe("filterAnjiaPosts - matchMode='contains'（包含匹配）", () => {
  it('返回 content 中包含 "安价" 的所有楼层', () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '安价', undefined, 'contains');
    const floors = items.map((i) => i.floor);
    // 1 / 2(今日安价50) / 3 / 5 命中；4 不命中
    expect(floors).toEqual([1, 2, 3, 5]);
  });
});

describe("filterAnjiaPosts - matchMode='regex'（正则匹配）", () => {
  it('正则 ^安价\\d+ 命中以"安价+数字"开头的楼层', () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '^安价\\d+', undefined, 'regex');
    const floors = items.map((i) => i.floor);
    // 1(安价100) / 5(安价1000) 命中；3(安价 200 元，安价后是空格) 不命中
    expect(floors).toEqual([1, 5]);
  });

  it('正则 安价\\d+ 命中任意位置含"安价+数字"的楼层', () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '安价\\d+', undefined, 'regex');
    const floors = items.map((i) => i.floor);
    // 1(安价100) / 2(今日安价50，中间命中) / 5(安价1000) 命中；3(安价 200 元，安价后是空格) 不命中
    expect(floors).toEqual([1, 2, 5]);
  });

  it('正则编译失败时返回空数组（不抛错）', () => {
    // "[" 是非法正则（未闭合字符类）
    expect(() => filterAnjiaPosts(samplePosts, 1, 20, '[', undefined, 'regex')).not.toThrow();
    const items = filterAnjiaPosts(samplePosts, 1, 20, '[', undefined, 'regex');
    expect(items).toEqual([]);
  });
});

describe('filterAnjiaPosts - 空 prefix 时返回所有（无论 mode）', () => {
  it("prefix='' + mode='prefix' 返回所有范围内楼层", () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '', undefined, 'prefix');
    expect(items.map((i) => i.floor)).toEqual([1, 2, 3, 4, 5]);
  });

  it("prefix='   ' + mode='contains' 返回所有（trim 后为空）", () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '   ', undefined, 'contains');
    expect(items.map((i) => i.floor)).toEqual([1, 2, 3, 4, 5]);
  });

  it("prefix='' + mode='regex' 返回所有（不编译正则）", () => {
    const items = filterAnjiaPosts(samplePosts, 1, 20, '', undefined, 'regex');
    expect(items.map((i) => i.floor)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('filterAnjiaPosts - 换行保留', () => {
  it('多行文本中的 \n 换行符不应被折叠为空格', () => {
    const posts = [makePost(1, '第一行\n第二行\n第三行')];
    const items = filterAnjiaPosts(posts, 1, 10, '', undefined, 'prefix');
    expect(items.length).toBe(1);
    expect(items[0].content).toContain('\n');
    expect(items[0].content).toBe('第一行\n第二行\n第三行');
  });

  it('段落间的 \n\n 空行应保留', () => {
    const posts = [makePost(1, '段落一\n\n段落二')];
    const items = filterAnjiaPosts(posts, 1, 10, '', undefined, 'prefix');
    expect(items[0].content).toContain('\n\n');
  });

  it('ubbref 标签移除后，不应破坏原始换行', () => {
    const posts = [makePost(1, '[pid=123456,123456]引用某人[/pid]\n第一行\n第二行')];
    const items = filterAnjiaPosts(posts, 1, 10, '', undefined, 'prefix');
    expect(items[0].content).toContain('\n');
    expect(items[0].content).toContain('第一行');
    expect(items[0].content).toContain('第二行');
  });

  it('连续空格应被折叠，但换行不被折叠', () => {
    const posts = [makePost(1, '第一行   有空格\n第二行')];
    const items = filterAnjiaPosts(posts, 1, 10, '', undefined, 'prefix');
    expect(items[0].content).toBe('第一行 有空格\n第二行');
  });
});

describe('filterAnjiaPosts - UBB 引用清理顺序', () => {
  it('带 [pid] 引用前缀的楼层应正确匹配 prefix（removeUbbref 在过滤前执行）', () => {
    const posts = [makePost(1, '[pid=123456,123456]引用某人[/pid]安价100')];
    const items = filterAnjiaPosts(posts, 1, 10, '安价', undefined, 'prefix');
    expect(items.length).toBe(1);
    expect(items[0].content).toBe('安价100');
  });

  it('带 [uid] 引用前缀的楼层应正确匹配 prefix', () => {
    const posts = [makePost(1, '[uid=999]某用户[/uid]安价200')];
    const items = filterAnjiaPosts(posts, 1, 10, '安价', undefined, 'prefix');
    expect(items.length).toBe(1);
    expect(items[0].content).toBe('安价200');
  });

  it('引用清理后内容不以 prefix 开头时应被过滤掉', () => {
    const posts = [
      makePost(1, '[pid=123]引用[/pid]无关内容'),
      makePost(2, '[pid=456]引用[/pid]安价300'),
    ];
    const items = filterAnjiaPosts(posts, 1, 10, '安价', undefined, 'prefix');
    expect(items.length).toBe(1);
    expect(items[0].floor).toBe(2);
  });

  it('contains 模式也应在 removeUbbref 之后匹配', () => {
    const posts = [makePost(1, '[uid=999]用户[/uid]今日安价50元')];
    const items = filterAnjiaPosts(posts, 1, 10, '安价', undefined, 'contains');
    expect(items.length).toBe(1);
    expect(items[0].content).toContain('安价50');
  });
});

// ============================================================
// extractPostsFromHtml - 图片爬取
// ============================================================

/** 构造最小 NGA 帖子 HTML，1 楼内容为 imgTag */
function buildHtmlWithImage(floor: number, imgTag: string): string {
  return `
    <table class="forumbox postbox">
      <tr id="post1strow${floor}" class="postrow row2">
        <td class="c1">
          <span id="posterinfo${floor}" class="posterinfo">
            <a href="nuke.php?func=ucp&uid=999" id="postauthor${floor}" class="author b">tester</a>
          </span>
        </td>
        <td class="c2" id="postcontainer${floor}">
          <a id="pid${floor}000Anchor"></a>
          <a name="l${floor}"></a>
          <span id="postcontentandsubject${floor}">
            <span id="postcontent${floor}" class="postcontent ubbcode">${imgTag}</span>
          </span>
        </td>
      </tr>
    </table>
    <script>commonui.postArg.proc( ${floor}, 0, 'uid', 'tester', '', '', '', '', '', '0', '1719201240', '0', '0', '0', '', '0', '', '0', '0');</script>
  `;
}

describe('extractPostsFromHtml - 图片爬取', () => {
  it('./mon_xxx 相对路径补全为完整 URL', () => {
    const html = buildHtmlWithImage(1, '<img src="./mon_202606/18/lsQ57-7bhzK10T3cSsg-fs.jpg.medium.jpg" alt="图片">');
    const posts = extractPostsFromHtml(html);
    expect(posts.length).toBe(1);
    expect(posts[0].content).toContain(
      '[img]https://img.nga.178.com/attachments/mon_202606/18/lsQ57-7bhzK10T3cSsg-fs.jpg.medium.jpg[/img]',
    );
  });

  it('mon_xxx 无 ./ 前缀也补全', () => {
    const html = buildHtmlWithImage(1, '<img src="mon_202606/18/foo.jpg">');
    const posts = extractPostsFromHtml(html);
    expect(posts.length).toBe(1);
    expect(posts[0].content).toContain(
      '[img]https://img.nga.178.com/attachments/mon_202606/18/foo.jpg[/img]',
    );
  });

  it('已带 http(s):// 的 URL 原样保留', () => {
    const html = buildHtmlWithImage(1, '<img src="https://example.com/x.png">');
    const posts = extractPostsFromHtml(html);
    expect(posts.length).toBe(1);
    expect(posts[0].content).toContain('[img]https://example.com/x.png[/img]');
  });

  it('单引号 src 也正确处理', () => {
    const html = buildHtmlWithImage(1, "<img src='./mon_202606/18/single.jpg'>");
    const posts = extractPostsFromHtml(html);
    expect(posts[0].content).toContain(
      '[img]https://img.nga.178.com/attachments/mon_202606/18/single.jpg[/img]',
    );
  });
});
