import { describe, expect, it } from 'vitest';
import { htmlToNGABBCode } from './ngaHtmlToBBCode';

describe('ngaHtmlToBBCode - 折叠块内含骰子/正文不丢失（roundtrip）', () => {
  it('折叠块内含骰子卡,往返不丢正文且骰子位置正确', () => {
    const html = `<div data-type="collapse-block" data-title="细则"><div class="collapse-body"><p>正文A</p><div data-type="dice-card" data-payload="{&quot;config&quot;:{&quot;kind&quot;:&quot;numeric&quot;,&quot;id&quot;:&quot;d1&quot;,&quot;count&quot;:1,&quot;numericFaces&quot;:6,&quot;modifier&quot;:0},&quot;lastResult&quot;:null,&quot;style&quot;:null}"></div></div></div>`;
    const bb = htmlToNGABBCode(html);
    expect(bb).toContain('[collapse=细则]');
    expect(bb).toContain('正文A');
    expect(bb).toContain('ROLL 1d6');
    // 折叠块整体保留,不应被清洗规则误删
    expect(bb).toContain('[/collapse]');
  });

  it('正文含字面 [b] 文本不误删闭标签、不抛错', () => {
    const bb = htmlToNGABBCode('<p>测试[未结束标签</p>');
    expect(bb.length).toBeGreaterThan(0);
    expect(bb).toContain('测试');
  });

  it('多层折叠嵌套 + 引用块往返不丢正文', () => {
    const html =
      `<div data-type="collapse-block" data-title="外"><div class="collapse-body">` +
      `<p>外层正文</p>` +
      `<div data-type="collapse-block" data-title="内"><div class="collapse-body"><p>内层正文</p></div></div>` +
      `<blockquote><p>引用正文</p></blockquote>` +
      `</div></div>`;
    const bb = htmlToNGABBCode(html);
    expect(bb).toContain('[collapse=外]');
    expect(bb).toContain('[collapse=内]');
    expect(bb).toContain('外层正文');
    expect(bb).toContain('内层正文');
    expect(bb).toContain('引用正文');
  });

  it('样式嵌套 + 骰子卡 + 正文组合不丢内容', () => {
    const html =
      `<p><b>加粗正文</b></p>` +
      `<div data-type="dice-card" data-payload="{&quot;config&quot;:{&quot;kind&quot;:&quot;numeric&quot;,&quot;id&quot;:&quot;d1&quot;,&quot;count&quot;:1,&quot;numericFaces&quot;:20,&quot;modifier&quot;:0},&quot;lastResult&quot;:null}"></div>` +
      `<p>结尾正文</p>`;
    const bb = htmlToNGABBCode(html);
    expect(bb).toContain('[b]加粗正文[/b]');
    expect(bb).toContain('[b]ROLL 1d20=0[/b]');
    expect(bb).toContain('结尾正文');
    // 跨块禁止误合并:加粗段落闭标签必须紧贴自身,不得吞掉下一行的骰子 ROLL
    expect(bb).not.toMatch(/\[b\]加粗正文\n/);
  });

  it('相邻两个选项骰子卡 = 两个独立 [quote],不得合并成一个', () => {
    const dice = (id: string, a: string, b: string) =>
      `<div data-type="dice-card" data-payload="{&quot;config&quot;:{&quot;kind&quot;:&quot;option&quot;,&quot;id&quot;:&quot;${id}&quot;,&quot;faces&quot;:2,&quot;options&quot;:[{&quot;content&quot;:&quot;${a}&quot;,&quot;values&quot;:[1]},{&quot;content&quot;:&quot;${b}&quot;,&quot;values&quot;:[2]}]},&quot;lastResult&quot;:null}"></div>`;
    const html = dice('d1', '选项甲', '选项乙') + dice('d2', '选项丙', '选项丁');
    const bb = htmlToNGABBCode(html);
    // 两个骰子各自是独立 [quote] 块(跨块禁止 quote 合并,否则骰子位置错位)
    const openCount = (bb.match(/\[quote\]/g) || []).length;
    const closeCount = (bb.match(/\[\/quote\]/g) || []).length;
    expect(openCount).toBe(2);
    expect(closeCount).toBe(2);
    expect(bb).toContain('选项甲');
    expect(bb).toContain('选项丁');
  });
});
