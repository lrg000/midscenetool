---
name: aside-package-test
description: >-
  Generates and maintains A-side (native shell) Midscene tests per Android package.
  Use when adding a new app package A-side script, packages/*/pages YAML, tests/aside/*.test.ts,
  config/packages.yaml entries, AB面/A面壳测试, 自然语言测试用例, 云效 PRD, devops.aliyun.com,
  Yunxiao work item, T42包, Y20包, 非标app, or native UI automation from product requirements.
  Do not rewrite B-side H5 flows under data/*.yaml.
---

# A 面按包测试（aside-package-test）

## 边界（必须遵守）— 三域模型

| 域 | kind | 位置 | 规则 |
|----|------|------|------|
| **独立 App** | `standalone` | `packages/{y*}/` | **禁止** `handoffFlow`；自包含用例 |
| **贷款壳** | `loan-shell` / `loan-postlogin` | `packages/{t*}/` | 可 `handoffFlow` → B 面 |
| **B 面模版** | — | `data/*.yaml` + `business-*` | **禁止**为壳/独立 App 改模版 |

- **禁止**修改 B 面 `data/basic-info.yaml`、`flows.yaml` 业务页列表来「迁就」A 面。
- **一包一脚本**：每个 `config/packages.yaml` 条目对应一个 `tests/aside/{packageId}.test.ts`。
- 复用引擎：`runAsidePackage` → `executePageFlow` / `verify` / `action` / `input`。
- **actionDomains**：在 `packages.yaml` 声明本包可用域（`common`/`loan`/`calendar`/`notes`/`gallery`/`stickers`）；新增专用 action 须先登记 `core/actions/domains.ts`。

## 轨道路线（生成时二选一）

### 轨 A — 独立 App（云效 PRD）

用户提供 **devops.aliyun.com/projex** 链接时：

1. **必读** [yunxiao-prd.md](yunxiao-prd.md)
2. MCP：`get_current_organization_info` → `get_work_item`
3. 写 `packages/{id}/cases/*-prd.nl.txt` → YAML
4. `kind: standalone` + 合适 `actionDomains`（日历→`[common, calendar]`，便签→`notes`，图库→`gallery`，贴纸→`stickers`，其它→`[common]`）
5. **禁止**抄写 T42/RajWise 登录文案；**禁止**配置 `handoffFlow`

### 轨 B — 贷款壳（Figma）

用户提供 **figma.com/design/** 链接时：

1. `get_metadata` / `download_assets` → `packages/{id}/figma/`
2. 精确英文字符串写 assertPrompt
3. `kind: loan-shell`，`actionDomains: [common, loan]`（T 开头包）
4. 登录前页：`pages/bootstrap.yaml`、`pages/login.yaml`（B 全流程会按 androidPackage 优先用包内页）

| 包 | 轨道 | 登录前差异 |
|----|------|----------|
| T42 | 贷款壳 | Welcome to RajWise；OTP 弹窗 |
| T46 | 贷款壳 | Before You Continue；Phone Code 登录 |
| Y20+ | 独立 App | 无贷款登录；PRD 驱动 |

**禁止**把 T42 登录前文案写入 T46 / Y 包 YAML。
**规则**：包 id 以 `t` 开头 → 贷款壳；以 `y` 开头 → 独立 App。

## 自然语言用例 → 脚本

1. 读「包元信息 / 步骤 / AC 映射」
2. 按步骤映射生成 YAML（见下表）
3. 注册 `config/packages.yaml`（含 **kind + actionDomains**）+ `tests/aside/{id}.test.ts` + `package.json` script
4. 用例副本放到 `packages/{id}/cases/*.nl.txt`

| 自然语言 | flow 映射 |
|----------|-----------|
| 打开/进入/验证…页 | `type: verify` + `assertPrompt` |
| 输入… | `type: input` + `validValue`；`skipEmptyBlurTest` + `skipInvalidBlurTest` |
| 点击… | `type: action` `tap-text` + `locatePrompt`（含 Do NOT tap） |
| 可选弹窗 | `optional: true`；居中弹窗**不要** `scrollBeforeTap` |
| 底部主按钮 / FAB | `scrollBeforeTap: true` 或 `bottomFields` |
| Sheet 内按钮禁滑页 | `noScrollRetry: true` |
| 通讯录选择 | `pick-native-contact` + `contactIndex` |
| 冷启就绪 | `wait-app-ready`（默认品牌无关；贷款壳可自写 assertPrompt） |
| 关闭/杀进程 | `force-stop-app` |
| 重开 App | `relaunch-app` |
| 条件重开 | `relaunch-if-not` |
| 弹层恢复 | `ensure-new-schedule-sheet` / `close-new-schedule-sheet`（需 calendar 域） |
| 回到月历 | `ensure-calendar-home`（需 calendar 域） |
| 清理残留 | `ensure-y20/y26-clean-state`（calendar）/ `ensure-y22-clean-state`（notes） |
| 卸载专项 | `test:aside:{id}:uninstall` + `Y*_RUN_UNINSTALL=1` |

## 参考实现

| 包 | kind | 命令 |
|----|------|------|
| **T42** | loan-shell | `test:aside:t42` |
| **T46** | loan-shell | `test:aside:t46` |
| **Y20+** | standalone | `test:aside:y20` 等 |

## 新建包清单

1. `config/packages.yaml`：`kind`、`actionDomains`、`pages[]`、`appLabel`、`androidPackage`
2. `packages/{packageId}/pages/*.yaml`
3. `packages/{packageId}/cases/*.nl.txt`
4. `tests/aside/{packageId}.test.ts`
5. `package.json` → `"test:aside:{packageId}"`
6. 新增专用 action：先登记 `core/actions/domains.ts`

## Prompt 规范

- 一控件一 `locatePrompt` + **Do NOT tap**
- 断言跟 PRD/Figma **精确字符串**
- A→B 仅 **loan-shell**；standalone **禁止** handoff

详见 [components.md](components.md)、[yunxiao-prd.md](yunxiao-prd.md)。
