import { switchPageSession } from './credentials.js';
import { executePageFlow } from './page-executor.js';
import { dismissKycUrgencyPopups } from './kyc-popups.js';
import { recordSkipped } from './test-context.js';
import type { AgentSession } from './types.js';
import { sleep } from './utils.js';

/** B 面 KYC 五步：产品顺序可变，串联时按当前屏识别再执行 */
export const KYC_PAGE_IDS = [
  'basic-info',
  'reference-contacts',
  'kyc-aadhaar',
  'kyc-liveness',
  'bank-info',
] as const;

export const KYC_PAGE_ID_SET = new Set<string>(KYC_PAGE_IDS);

const NOT_PROGRESS_BAR =
  'Judge ONLY the primary visible form/content occupying the screen. ' +
  'Do NOT treat progress-bar / step-indicator labels as the current page. ' +
  'Answer only true or false.';

/** 先匹配特征更强的页，避免进度条文案误判 */
const DETECT_SPECS: { id: string; prompt: string }[] = [
  {
    id: 'kyc-liveness',
    prompt:
      `Is the primary screen KYC "Upload your selfie" (guide with Next, camera capture, or selfie preview with Submit/Retake)? ${NOT_PROGRESS_BAR}`,
  },
  {
    id: 'bank-info',
    prompt:
      `Is the primary screen "Bank information" / "Bank Account" with an IFSC code input? ${NOT_PROGRESS_BAR}`,
  },
  {
    id: 'kyc-aadhaar',
    prompt:
      `Is the primary screen KYC Identity Verification / Aadhaar OCR (Front of Aadhaar upload, camera/OCR, or "Confirm your info" with PAN)? ${NOT_PROGRESS_BAR}`,
  },
  {
    id: 'reference-contacts',
    prompt:
      `Is the primary screen "Reference Contacts" (Primary/Secondary Reference, Relationship, Full Name)? ${NOT_PROGRESS_BAR}`,
  },
  {
    id: 'basic-info',
    prompt:
      `Is the primary screen the "Basic info" form (Personal/Address/Work fields such as Marital Status, Email ID, Pincode, or Employment Type)? ${NOT_PROGRESS_BAR}`,
  },
];

export type FlowSegment =
  | { kind: 'fixed'; pages: string[] }
  | { kind: 'kyc'; pages: string[] };

/** 把流程 pages 拆成固定段 + 连续 KYC 五步段（段内顺序随产品） */
export function splitKycFlexibleSegments(pageIds: string[]): FlowSegment[] {
  const segments: FlowSegment[] = [];
  let i = 0;
  while (i < pageIds.length) {
    if (KYC_PAGE_ID_SET.has(pageIds[i])) {
      const pages: string[] = [];
      while (i < pageIds.length && KYC_PAGE_ID_SET.has(pageIds[i])) {
        pages.push(pageIds[i]);
        i++;
      }
      segments.push({ kind: 'kyc', pages });
    } else {
      const pages: string[] = [];
      while (i < pageIds.length && !KYC_PAGE_ID_SET.has(pageIds[i])) {
        pages.push(pageIds[i]);
        i++;
      }
      segments.push({ kind: 'fixed', pages });
    }
  }
  return segments;
}

async function matchKycSpec(
  session: AgentSession,
  allow: Set<string> | null,
): Promise<string | null> {
  for (const spec of DETECT_SPECS) {
    if (allow && !allow.has(spec.id)) continue;
    try {
      const hit = await session.agent.aiBoolean(spec.prompt);
      if (hit) return spec.id;
    } catch {
      // 单次识别失败则试下一页特征
    }
  }
  return null;
}

export async function detectCurrentKycPage(
  session: AgentSession,
  remaining: Set<string>,
): Promise<string | null> {
  const attempts = 5;
  const delay = session.env.timing.afterSubmit ?? 2000;

  for (let round = 0; round < attempts; round++) {
    if (round > 0) {
      console.log(`  KYC 页面识别重试 ${round}/${attempts - 1}...`);
      await sleep(delay);
    }
    await dismissKycUrgencyPopups(session);
    const hit = await matchKycSpec(session, remaining);
    if (hit) return hit;
  }
  return null;
}

export async function runKycFlexibleCluster(
  session: AgentSession,
  options: { pool: string[]; pageTotal: number; startPageIndex: number },
): Promise<void> {
  const remaining = new Set(options.pool);
  const done: string[] = [];

  console.log(
    `\n========== KYC 五步（按当前屏识别，不依赖产品顺序）: ${options.pool.join(', ')} ==========`,
  );

  while (remaining.size > 0) {
    const pageId = await detectCurrentKycPage(session, remaining);
    if (!pageId) {
      if (done.length > 0) {
        const leftover = [...remaining];
        const stillKyc = await matchKycSpec(session, KYC_PAGE_ID_SET);
        if (stillKyc) {
          throw new Error(
            `仍停在 KYC「${stillKyc}」，提交可能未成功，不能当作已进入申请。` +
              `待执行: ${leftover.join(', ')}`,
          );
        }
        console.log(
          `  已离开 KYC 表单（产品不必跑完五步），跳过未出现的步骤: ${leftover.join(', ')}`,
        );
        for (const id of leftover) {
          recordSkipped(id, '本轮未出现（产品已跳过该步或已进入申请）');
          remaining.delete(id);
        }
        break;
      }
      throw new Error(
        `无法识别当前 KYC 页。仍待执行: ${[...remaining].join(', ')}。` +
          '请确认屏幕已停在基本信息 / 紧急联系人 / OCR / 活体 / 绑卡之一（不要只看进度条标签）。',
      );
    }

    switchPageSession(session, pageId);
    const pageIndex = options.startPageIndex + done.length + 1;
    console.log(
      `\n========== 阶段 3+: 页面 ${pageIndex}/${options.pageTotal} — ${pageId}（识别） ==========`,
    );
    await executePageFlow(session, {
      pageIndex,
      pageTotal: options.pageTotal,
    });
    remaining.delete(pageId);
    done.push(pageId);
  }

  console.log(`  KYC 五步已按实际顺序完成: ${done.join(' → ')}`);
}
