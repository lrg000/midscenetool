# 云效 PRD → A 面自动化（标准工作流）

当用户提供 **devops.aliyun.com/projex** 链接，或要求「按云效 PRD 生成 A 面」时，**必须先读本文**再动手。

## 1. 用云效 MCP 拉需求

```
get_current_organization_info          → organizationId
get_work_item(organizationId, workItemId)
list_workitem_attachments(...)         → 附件（jks 等，一般不写进 YAML）
```

从 URL 解析：

| URL 片段 | 用途 |
|----------|------|
| `/project/{projectId}/` | spaceId / 项目 |
| `openWorkitemIdentifier={workItemId}` | get_work_item |

描述字段常为 JSON：`description` → `htmlValue`，需去 HTML 后读 PRD 正文。

## 2. 从 PRD 提取包元信息

在 PRD 或描述开头找：

- **包 id**：如 Y20 → `y20`（小写、短横线）
- **应用名** / appLabel
- **包名** / androidPackage
- **页面结构**（几页、有无登录/Tab）
- **验收标准 AC-xxx** / **测试用例 TC-xxx**
- **UI 链接**（Figma，若有则对齐精确文案）
- **实机与 PRD 差异**（写入 NL 用例「实机差异」栏）

## 3. 生成产物（一包一套，顺序固定）

| # | 路径 | 说明 |
|---|------|------|
| 1 | `packages/{id}/cases/{id}-prd.nl.txt` | 产品可维护 NL 用例（含云效链接、AC 映射） |
| 2 | `packages/{id}/pages/*.yaml` | 每页一个 YAML，`isNative: true`，`submit.enabled: false` |
| 3 | `config/packages.yaml` | 注册 `packages.{id}` + `pages[]` 顺序 |
| 4 | `tests/aside/{id}.test.ts` | `runAsidePackage('{id}')` |
| 5 | `package.json` | `"test:aside:{id}"` |
| 6 | `packages/{id}/README.md` | 包说明 + 云效链接 |

**禁止**为 A 面改 B 面 `data/*.yaml` / `business-*`。

## 4. PRD AC → YAML 映射

| PRD 描述 | flow 类型 |
|----------|-----------|
| 打开即某页 / 文案校验 | `verify` + `assertPrompt`（写 PRD 精确英文） |
| 点击按钮/日期/Tab | `action` `tap-text` + `locatePrompt` + Do NOT tap |
| 输入框 | `input` + `validValue`；Bottom Sheet 内加 skipScroll/skipBlur |
| **空内容 Save（AC-010 / TC-006）** | 先 `tap-text` Save（不填 input）→ `verify` **必须**出现 **Please enter schedule.** 且弹层仍开、未保存 |
| **100 字上限（AC-012）** | `fill-input` 101 字 → verify NN/100 → Save → **Maximum 100 characters.** |
| **AC-008 升序** | 连续 FAB+Save 两条，verify 创建顺序 |
| **AC-013 Cancel** | Delete 弹窗 → Cancel → verify 仍在 → 再 Delete |
| **TC-009 / AC-016** | `relaunch-app`（assertPrompt=包名）→ 再进当天 verify |
| **fill-input** | `inputFieldLabel` + `inputValue` |
| **relaunch-app** | 冷启 launch；assertPrompt 填 androidPackage |
| 通讯录/相册/相机 | `handle-permissions` / `pick-native-contact` / `kyc-manual-until` |
| 冷启等待 | `wait-app-ready` + 自定义 assertPrompt |
| UI/字体/配色（AC-018~AC-019） | 独立 `verify`，label `UI … PRD`，**STRICT** + Fail if |
| 底部主按钮 / FAB | `scrollBeforeTap` 或 `bottomFields` |
| **Bottom Sheet 内输入/按钮** | skipScroll/skipBlur；Save 设 `scrollBeforeTap: false` |
| 删除确认 | Y20 PRD 测 Cancel + Delete 全流程 |

## 5. packageId 命名

- 云效标题「Y20面包开发」→ `y20`
- 与 `androidPackage` 无强制对应；以产品包编号为准

## 6. 参考实现

| 包 | 特点 | 路径 |
|----|------|------|
| T42 | 登录 + 主流程 + Figma 文案 | `packages/t42/` |
| Y20 | 无登录、2 页日历 CRUD | `packages/y20/` |
| Y26 | 无登录、复古纸张日历 Aarambh | `packages/y26/` |
| Y27 | 无登录、杂志风相册 PicBox/Sakhi | `packages/y27/` |
| Y28 | 无登录、Soft Stationery 贴纸 Craft | `packages/y28/` |
| Y22 | 无登录、便签列表 + New Note Sheet | `packages/y22/` |
| Y25 | 无登录、贴纸 Explore + 详情下载 + My | `packages/y25/` |
| Y24 | 无登录、深色图库 Photos/Albums/加密 | `packages/y24/` |
| T46 | 记账壳 Phone Code 登录 | `packages/t46/` |

## 7. 交付检查清单

- [ ] NL 用例含云效 workItemId、AC 映射表
- [ ] 每个可点控件有 `locatePrompt`
- [ ] **UI 严格校验**：每页至少 1 条 `UI … PRD` verify（配色/字号/dp/圆角/按钮全宽高度）
- [ ] `config/packages.yaml` 与 `tests/aside/*.test.ts` 已注册
- [ ] `npm run test:aside:{id}` 可执行（设备已装对应 apk）

## 8. UI 严格校验模板（Y20 参考）

从 PRD「五~七、十一」提取，写入 `verify.assertPrompt`：

| 元素 | PRD 硬指标 | Fail 条件示例 |
|------|-----------|---------------|
| 页面背景 | #FFFFFF | 灰底、彩色底 |
| 品牌蓝 | #3B82F6 | 非该色系蓝、Today/今日/FAB/Save/蓝点错误 |
| 标题字色 | #111827 | 纯黑或过浅 |
| 次级字色 | #4B5563 / #9CA3AF | 对比度明显不对 |
| Header | 56dp | 明显过矮/布局缺失 |
| 月份 | 24sp | 明显小于日期字 |
| 日期格 | 48dp 方格，数字 16sp | 格明显非方形 |
| 行程页标题 | 28sp | 与正文同大 |
| FAB | 56dp 圆 #3B82F6 | 非圆、非蓝、尺寸明显不对 |
| Save | 全宽 × 48dp #3B82F6 字 16sp | 非全宽、明显矮于 48dp、浅灰代替品牌蓝 |
| Bottom Sheet | ~45% 屏高，顶角 16dp | 过高/过低、直角 sheet |
| 行程卡片 | 56dp 高，16dp 圆角，16dp 边距 | 无圆角、明显扁/高 |
| 蓝点 | 4dp #3B82F6 | 缺失、过大、错色 |
| Delete | #EF4444 | 与 Cancel 同色无区分 |
| 输入上限 | 100 字，计数 NN/100 | 可输入 >100、无计数 |
| 超限提示 | **Maximum 100 characters.** | 无提示或仅截断 |

**说明**：Midscene 为视觉 AI 断言，按 PRD 数值做**严格语义校验**（明显偏差判 Fail），非像素量尺。实机与 PRD 冲突写入 NL「实机差异」并在修复 App 前预期 Fail。
