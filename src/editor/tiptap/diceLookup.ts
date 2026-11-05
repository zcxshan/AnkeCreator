// 判断某个骰子快照是否仍存在于编辑器中（供"恢复骰子"按钮禁用态使用）。
// 从旧 diceCard.ts 抽出，避免编辑器页面通过 barrel 引入整套旧内容编辑器。

const DICE_CARD_SELECTOR = 'div[data-type="dice-card"]';

export function isDiceCardInEditor(editor: HTMLElement, payloadSnapshot: string): boolean {
  if (!editor || !payloadSnapshot) return false;
  let snapshot: any = null;
  try {
    snapshot = JSON.parse(payloadSnapshot);
  } catch {
    return false;
  }
  const snapshotId: string =
    (snapshot && snapshot.config && (snapshot.config.id || snapshot.config.name)) || '';
  const snapshotTimestamp: number | null =
    snapshot && snapshot.lastResult && typeof snapshot.lastResult.timestamp === 'number'
      ? snapshot.lastResult.timestamp
      : null;

  const candidates = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  if (candidates.length === 0) return false;

  let bestScore = -1;
  candidates.forEach((el) => {
    let cur: any = null;
    try {
      cur = JSON.parse(el.getAttribute('data-payload') || '{}');
    } catch {
      return;
    }
    const curId: string =
      (cur && cur.config && (cur.config.id || cur.config.name)) || '';
    const curTimestamp: number | null =
      cur && cur.lastResult && typeof cur.lastResult.timestamp === 'number'
        ? cur.lastResult.timestamp
        : null;

    let score = 0;
    if (snapshotId && curId === snapshotId) score += 100;
    if (
      snapshotTimestamp != null &&
      curTimestamp != null &&
      Math.abs(curTimestamp - snapshotTimestamp) < 1000
    ) {
      score += 50;
    }
    if (score > bestScore) {
      bestScore = score;
    }
  });

  // 有实际匹配（score >= 50）才算"还在"
  return bestScore >= 50;
}
