import { getDropdownField, getInputField } from './config-loader.js';
import { runActionStep, runVerifyStep, testContactField } from './action-step.js';
import { testCheckboxField } from './checkbox.js';
import { testDropdownField } from './dropdown.js';
import { testInputField } from './input-field.js';
import { runNativeInputStep } from './native-input.js';
import { submitAndVerifyNextPage } from './submit.js';
import type { AgentSession, FlowStep, PageVariantConfig } from './types.js';
import { getContactField, getCheckboxField } from './field-resolver.js';
import { recordPassed, recordSkipped } from './test-context.js';
import { findSectionByScrolling } from './scroll.js';
import { progressEmitter } from './progress-emitter.js';
import { isL5Enabled, runL3Explore, runObserve, writeL5Diagnosis } from './l5/index.js';
import { dismissKycUrgencyPopups, KYC_URGENCY_PAGE_IDS } from './kyc-popups.js';

function stepExpectation(step: FlowStep): string | undefined {
  if (step.assertPrompt) return step.assertPrompt;
  if (step.locatePrompt) return step.locatePrompt;
  if (step.action) return `执行 ${step.action}`;
  return undefined;
}

export async function runFlowStep(session: AgentSession, step: FlowStep): Promise<void> {
  if (step.skip) {
    recordSkipped(`${step.section} / ${step.label}`, '步骤已配置 skip');
    return;
  }

  // 仅联系人/下拉的 optional 才按「区块标题」下滑查找（如 Third Reference）。
  // action 的 optional（如 Agree & Continue）表示控件可能不出现，由 action-step 内判断，
  // 不能拿 YAML 的 section 名（Onboarding）当页面标题去滑找。
  if (step.optional && (step.type === 'contact' || step.type === 'dropdown')) {
    const found = await findSectionByScrolling(session, step.section);
    if (!found) {
      recordSkipped(
        `${step.section} / ${step.label}`,
        '滑动查找后仍无此联系人区块，已跳过（optional）',
      );
      return;
    }
  }

  switch (step.type) {
    case 'dropdown':
      await testDropdownField(
        session,
        getDropdownField(session.page, step.label, step.section),
      );
      break;
    case 'input':
      await testInputField(
        session,
        getInputField(session.page, step.label, step.section),
      );
      break;
    case 'native-input':
      await runNativeInputStep(session, step);
      break;
    case 'contact':
      await testContactField(
        session,
        getContactField(session.page, step.section, step.label),
      );
      break;
    case 'checkbox':
      if (step.optional) {
        const visible = await session.agent.aiBoolean(
          `Is a consent checkbox visible on the current screen near text containing ` +
            `"${step.label}" or "I agree to the Terms" or "Before you continue"? ` +
            `Answer only true or false.`,
        );
        if (!visible) {
          recordSkipped(`${step.section} / ${step.label}`, '勾选目标未出现（optional）');
          return;
        }
      }
      await testCheckboxField(session, getCheckboxField(session.page, step.label));
      break;
    case 'verify':
      await runVerifyStep(session, step);
      break;
    case 'action':
      await runActionStep(session, step);
      break;
    case 'checkpoint': {
      if (!isL5Enabled()) {
        recordSkipped(`${step.section} / ${step.label}`, 'config/l5.yaml 未启用');
        break;
      }
      await runObserve(session, step.observe ?? {}, step.label);
      break;
    }
    case 'explore':
      await runL3Explore(session);
      break;
    default:
      throw new Error(`未知 flow 步骤类型: ${(step as FlowStep).type}`);
  }
}

function applyVariant(session: AgentSession, variant: PageVariantConfig, versionLabel: string) {
  session.page.flow = variant.flow;
  session.page.submit = variant.submit;
  if (variant.bottomFields) {
    session.page.page.bottomFields = variant.bottomFields;
  }
  console.log(`  → 使用 ${versionLabel} flow（${variant.flow.length} 步）`);
  recordPassed(`版本检测: ${versionLabel}`);
}

/**
 * 若 YAML 配置了 versionDetect + versions.v2，则探测 UI 版本并切换 flow/submit。
 * 未配置时保持 YAML 顶层 flow（向后兼容）。
 */
export async function resolvePageVersion(session: AgentSession): Promise<'v1' | 'v2'> {
  const detect = session.page.page.versionDetect;
  const v2 = session.page.versions?.v2;
  if (!detect?.enabled || !v2) {
    return 'v1';
  }

  console.log('\n========== 检测页面版本 ==========');
  const { agent } = session;

  let isV2 = await agent.aiBoolean(detect.v2Prompt);
  if (!isV2 && detect.v2FallbackPrompt) {
    isV2 = await agent.aiBoolean(detect.v2FallbackPrompt);
  }

  if (isV2) {
    applyVariant(session, v2, 'V2');
    return 'v2';
  }

  console.log('  → 使用 V1 flow（YAML 顶层）');
  recordPassed('版本检测: V1');
  return 'v1';
}

/** 执行单页 flow + submit（不断开设备） */
export async function executePageFlow(
  session: AgentSession,
  pageProgress?: { pageIndex: number; pageTotal: number },
): Promise<void> {
  const title = session.page.page.title;
  console.log(`\n========== ${title}（${session.meta.id}） ==========`);

  if (KYC_URGENCY_PAGE_IDS.has(session.meta.id)) {
    await dismissKycUrgencyPopups(session);
  }

  // 必须先做版本探测再取 flow：applyVariant 会替换 session.page.flow，
  // 若先缓存旧引用，全流程/KYC 串联会继续跑 V1（如 Street address），在 V2 上卡死。
  await resolvePageVersion(session);

  const runId = progressEmitter.getActiveRunId();
  const flow = session.page.flow;
  if (runId) {
    progressEmitter.emitEvent({
      type: 'page:start',
      runId,
      pageId: session.meta.id,
      title,
      pageIndex: pageProgress?.pageIndex ?? 1,
      pageTotal: pageProgress?.pageTotal ?? 1,
      stepTotal: flow.length,
    });
  }

  let currentSection = '';
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (step.section !== currentSection) {
      console.log(`\n--- ${step.section} ---`);
      currentSection = step.section;
    }
    if (runId) {
      progressEmitter.emitEvent({
        type: 'step:start',
        runId,
        stepIndex: i + 1,
        stepTotal: flow.length,
        section: step.section,
        label: step.label,
        stepType: step.type,
        expectation: stepExpectation(step),
      });
    }
    try {
      await runFlowStep(session, step);
      if (runId) {
        progressEmitter.emitEvent({ type: 'step:end', runId, stepIndex: i + 1, success: true });
      }
    } catch (err) {
      if (runId) {
        progressEmitter.emitEvent({ type: 'step:end', runId, stepIndex: i + 1, success: false });
      }
      await writeL5Diagnosis(session, {
        kind: 'step-fail',
        title: `${step.section} / ${step.label}`,
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
      throw err;
    }
  }

  await submitAndVerifyNextPage(session);
}
