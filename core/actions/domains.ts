/**
 * Action 域：按业务包声明可用域，避免日历/贷款等专用动作串味。
 * 物理实现仍在 action-step.ts；此处只做登记与运行时门禁。
 */
import type { PackageKind } from '../package-profile.js';

export type ActionDomain =
  | 'common'
  | 'loan'
  | 'calendar'
  | 'notes'
  | 'gallery'
  | 'stickers';

/** 每个 action 所属域；新增 action 必须登记 */
export const ACTION_DOMAIN_MAP: Record<string, ActionDomain> = {
  // common
  'tap-next': 'common',
  'tap-submit': 'common',
  'tap-allow': 'common',
  'tap-text': 'common',
  'tap-confirm': 'common',
  'fill-input': 'common',
  'wait-app-ready': 'common',
  'wait-page': 'common',
  'dismiss-keyboard': 'common',
  'android-back': 'common',
  'relaunch-if-not': 'common',
  'force-stop-app': 'common',
  'relaunch-app': 'common',
  'uninstall-app': 'common',
  'install-apk': 'common',
  'handle-permissions': 'common',
  'usage-access': 'common',
  'dismiss-home-popup': 'common',
  'wait-h5-home': 'loan',
  'pick-native-contact': 'common',

  // loan（B 面 H5 / 贷款壳）
  'handle-credit-limit-popup': 'loan',
  'dismiss-kyc-urgency-popup': 'loan',
  'kyc-manual-until': 'loan',
  'kyc-photo-manual': 'loan',
  'kyc-selfie-capture': 'loan',
  'handle-auto-disburse-popup': 'loan',
  'tap-repay-loan': 'loan',
  'tap-repay': 'loan',
  'tap-apply-if-visible': 'loan',
  'wait-apply-visible': 'loan',

  // calendar（Y20 / Y26）
  'ensure-calendar-home': 'calendar',
  'ensure-y20-clean-state': 'calendar',
  'ensure-y26-clean-state': 'calendar',
  'ensure-new-schedule-sheet': 'calendar',
  'close-new-schedule-sheet': 'calendar',

  // notes（Y22）
  'ensure-y22-clean-state': 'notes',
  'ensure-new-note-sheet': 'notes',
  'close-new-note-sheet': 'notes',

  // gallery（Y24 / Y27 等）
  'seed-gallery-image': 'gallery',
  'pick-gallery-image': 'gallery',
};

export const ALL_ACTION_DOMAINS: ActionDomain[] = [
  'common',
  'loan',
  'calendar',
  'notes',
  'gallery',
  'stickers',
];

/** 未显式配置 actionDomains 时按 kind 推断 */
export function defaultActionDomainsForKind(kind: PackageKind): ActionDomain[] {
  switch (kind) {
    case 'loan-shell':
    case 'loan-postlogin':
      return ['common', 'loan'];
    case 'standalone':
      return ['common'];
    default:
      return ['common'];
  }
}

/** B 面业务流默认允许的域（共享 H5 模版） */
export const B_SIDE_ACTION_DOMAINS: ActionDomain[] = ['common', 'loan'];

export function getActionDomain(action: string | undefined): ActionDomain | null {
  if (!action) return null;
  return ACTION_DOMAIN_MAP[action] ?? null;
}

export function assertActionDomainAllowed(
  action: string | undefined,
  allowed: ActionDomain[] | undefined | null,
  contextLabel?: string,
): void {
  if (!action) return;
  // 未设置门禁时放行（兼容旧调用路径）
  if (!allowed || allowed.length === 0) return;

  const domain = getActionDomain(action);
  if (!domain) {
    throw new Error(
      `未知 action「${action}」未登记域（core/actions/domains.ts）。` +
        `请登记后再用于 ${contextLabel ?? '当前包'}。`,
    );
  }
  if (!allowed.includes(domain)) {
    throw new Error(
      `action「${action}」属于域「${domain}」，但当前包仅允许 [${allowed.join(', ')}]` +
        (contextLabel ? `（${contextLabel}）` : '') +
        `。请在 packages.yaml 的 actionDomains 中声明，或改用本包业务适用的 action。`,
    );
  }
}
