import type { AndroidAgent } from '@midscene/android';
import type { AgentSession } from './types.js';
import { fieldLocatePrompt, sectionFieldLocatePrompt, sleep } from './utils.js';

const BOTTOM_SHEET_PROMPT =
  'Is a bottom sheet selection modal currently open on the form page? Answer only true or false.';
const BOTTOM_SHEET_CHECK_TTL_MS = 2500;

interface BottomSheetCacheEntry {
  value: boolean;
  checkedAt: number;
}

const bottomSheetCacheByRun = new Map<string, BottomSheetCacheEntry>();

function cacheKey(session: AgentSession): string {
  return session.runId;
}

export function invalidateBottomSheetModalCheck(session: AgentSession): void {
  bottomSheetCacheByRun.delete(cacheKey(session));
}

export function markBottomSheetModalClosed(session: AgentSession): void {
  bottomSheetCacheByRun.set(cacheKey(session), { value: false, checkedAt: Date.now() });
}

async function isBottomSheetModalOpen(session: AgentSession): Promise<boolean> {
  const key = cacheKey(session);
  const now = Date.now();
  const cached = bottomSheetCacheByRun.get(key);
  if (cached && now - cached.checkedAt < BOTTOM_SHEET_CHECK_TTL_MS) {
    return cached.value;
  }

  try {
    const value = await session.agent.aiBoolean(BOTTOM_SHEET_PROMPT);
    bottomSheetCacheByRun.set(key, { value, checkedAt: now });
    return value;
  } catch {
    bottomSheetCacheByRun.set(key, { value: false, checkedAt: now });
    return false;
  }
}

export async function dismissBottomSheet(session: AgentSession): Promise<void> {
  const { agent, page, env } = session;
  const title = page.page.title;
  try {
    await agent.aiTap(
      `The "${title}" title in the top header bar, tap to close any open bottom sheet modal`,
    );
    await sleep(env.timing.afterDismiss);
  } catch {
    // ignore
  } finally {
    markBottomSheetModalClosed(session);
  }
}

/** 仅当底部弹窗仍打开时才点标题关闭，避免下拉选中后多余失焦点击 */
export async function dismissBottomSheetIfOpen(session: AgentSession): Promise<void> {
  if (!(await isBottomSheetModalOpen(session))) return;
  await dismissBottomSheet(session);
}

export async function scrollPage(
  session: AgentSession,
  direction: 'up' | 'down',
): Promise<void> {
  const { agent, env } = session;
  await agent.aiScroll(undefined, {
    direction,
    scrollType: 'singleAction',
    distance: 200,
  });
  await sleep(env.timing.afterScroll);
}

export async function isElementVisible(
  agent: AndroidAgent,
  locatePrompt: string,
): Promise<boolean> {
  try {
    await agent.aiLocate(locatePrompt);
    return true;
  } catch {
    return false;
  }
}

export async function scrollToElement(
  session: AgentSession,
  name: string,
  locatePrompt?: string,
  options?: {
    downFirst?: boolean;
    /** 跳过首屏可见短路，强制先向下滑找（底部字段易误判） */
    alwaysScrollDown?: boolean;
    /** 优先向上滑找（键盘遮挡后常见） */
    upFirst?: boolean;
    /** 不关闭 Bottom Sheet（Create/New Note 等弹层内找按钮） */
    skipDismissSheet?: boolean;
  },
): Promise<void> {
  const { agent, page, env } = session;
  const scroll = env.scroll;
  const prompt = locatePrompt ?? fieldLocatePrompt(page.page.title, name);
  const upFirst = options?.upFirst === true;
  const downFirst = options?.downFirst ?? (!upFirst && scroll.sequentialDownFirst);
  const alwaysScrollDown = options?.alwaysScrollDown ?? false;

  if (!options?.skipDismissSheet) {
    await dismissBottomSheetIfOpen(session);
  }

  if (!alwaysScrollDown && !upFirst && (await isElementVisible(agent, prompt))) {
    await sleep(scroll.settleMs);
    return;
  }

  const scrollDown = async (): Promise<boolean> => {
    console.log(`  向下滑动查找 "${name}"...`);
    for (let i = 0; i < scroll.maxDown; i++) {
      await scrollPage(session, 'down');
      if (await isElementVisible(agent, prompt)) {
        console.log(`  已找到 "${name}"（向下 ${i + 1} 次）`);
        await sleep(scroll.settleMs);
        return true;
      }
    }
    return false;
  };

  const scrollUp = async (): Promise<boolean> => {
    const maxUp = downFirst || upFirst ? scroll.maxUpSequential : scroll.maxUp;
    console.log(`  向上滑动查找 "${name}"...`);
    for (let i = 0; i < maxUp; i++) {
      await scrollPage(session, 'up');
      if (await isElementVisible(agent, prompt)) {
        console.log(`  已找到 "${name}"（向上 ${i + 1} 次）`);
        await sleep(scroll.settleMs);
        return true;
      }
    }
    return false;
  };

  if (upFirst) {
    if (await scrollUp()) return;
    if (await scrollDown()) return;
  } else {
    if (await scrollDown()) return;
    if (await scrollUp()) return;
  }

  console.warn(`  未能定位到 "${name}"，继续尝试操作`);
}

export async function scrollFieldIntoView(
  session: AgentSession,
  fieldLabel: string,
  options?: { skipLocate?: boolean; section?: string; fieldLabel?: string },
): Promise<void> {
  const { page, env } = session;
  const bottomFields = new Set(page.page.bottomFields);
  const label = options?.fieldLabel ?? fieldLabel;
  const section = options?.section;
  const locateName = section ? `${section} ${label}` : fieldLabel;

  if (!options?.skipLocate) {
    const prompt = section
      ? sectionFieldLocatePrompt(page.page.title, section, label)
      : undefined;
    await scrollToElement(session, locateName, prompt);
  }
  // bottomFields 可配字段名（Full Name）或区块名（Third Reference）
  if (bottomFields.has(label) || (section != null && bottomFields.has(section))) {
    await scrollPage(session, 'down');
    await sleep(env.scroll.settleMs);
  }
}

/** 同一次 run 内对同一区块只滑找一次（Relationship / Full Name 共用结果） */
const sectionFindCache = new Map<string, boolean>();

/**
 * 上下滑动查找区块标题；找到返回 true，滑完仍没有返回 false。
 * 用于 optional 联系人区块：先下滑再判定是否跳过。
 */
export async function findSectionByScrolling(
  session: AgentSession,
  sectionTitle: string,
): Promise<boolean> {
  const findCacheKey = `${session.runId}::${sectionTitle}`;
  if (sectionFindCache.has(findCacheKey)) {
    return sectionFindCache.get(findCacheKey)!;
  }

  const { agent, page, env } = session;
  const scroll = env.scroll;
  const locatePrompt =
    `The section title "${sectionTitle}" on the "${page.page.title}" page ` +
    `(bold section header text, not a field label)`;

  await dismissBottomSheetIfOpen(session);

  const visibleNow = async () => {
    try {
      return await agent.aiBoolean(
        `Without further scrolling: is the section title "${sectionTitle}" currently visible on screen? Answer only true or false.`,
      );
    } catch {
      return isElementVisible(agent, locatePrompt);
    }
  };

  const finish = async (found: boolean): Promise<boolean> => {
    sectionFindCache.set(findCacheKey, found);
    if (found) await sleep(scroll.settleMs);
    return found;
  };

  if (await visibleNow()) {
    return finish(true);
  }

  console.log(`  向下滑动查找区块 "${sectionTitle}"...`);
  for (let i = 0; i < scroll.maxDown; i++) {
    await scrollPage(session, 'down');
    if (await visibleNow()) {
      console.log(`  已找到区块 "${sectionTitle}"（向下 ${i + 1} 次）`);
      return finish(true);
    }
  }

  console.log(`  向上滑动查找区块 "${sectionTitle}"...`);
  for (let i = 0; i < scroll.maxUpSequential; i++) {
    await scrollPage(session, 'up');
    if (await visibleNow()) {
      console.log(`  已找到区块 "${sectionTitle}"（向上 ${i + 1} 次）`);
      return finish(true);
    }
  }

  console.log(`  滑动后仍未找到区块 "${sectionTitle}"`);
  return finish(false);
}
