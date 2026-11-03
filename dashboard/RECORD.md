# Dashboard 录制生成 — 可靠使用手册

目标：用最少的人工步骤，产出 **Midscene 能稳定重放** 的 A 面 YAML + `tests/aside/{id}.test.ts`。

录制器 **不是** 手机操作回放。真机模式下，脚本质量 90% 取决于你怎么记步骤。按本手册记，才接近 T53 那种可跑包；随手点「从当前屏生成 verify」再一键落盘，得到的是流水账，不能当回归。

---

## 1. 先建立正确预期

| 你以为的 | 实际 |
|----------|------|
| 在手机上点，控制台自动出步骤 | **不会。** 真机只截屏/抽文案；步骤靠「追加步骤」 |
| 落盘就能当成品用例 | **不能。** 落盘是脚手架；还要拆页、改 locate、对照 PRD |
| 勾选框控制台会替你勾 | **不会。** 录的时候你在手机上勾；跑的时候脚本才自动勾 |
| Playwright 能录原生 App | **不能。** Playwright 只录弹出的 Chromium 网页 |

两段生命周期：

1. **录**：人在真机走通 → 控制台按屏记账 → 停止 → 转换落盘  
2. **跑**：`npm run test:aside:{id}` 或控制台左侧选用例。这时才是 Midscene 自动点/填

浏览器模式例外：弹出窗口里的 click/fill **会自动记**，但仍要拆页、改 prompt 后才可靠。

---

## 2. 开始前检查单

1. `npm run dashboard`，打开控制台；**不要**同时「开始并行执行」（录制与跑测互斥）。
2. 左侧 **勾选一台 ADB 设备**（真机模式会用你勾的第一台）。
3. 填表（开始后改这些字段 **不会** 写进已开始的会话）：

| 字段 | 怎么填才可靠 |
|------|----------------|
| 模式 | 原生壳 / APK → **真机（Midscene）**；H5/原型 → **浏览器（Playwright）** |
| packageId | 小写稳定 id，如 `t57`。不要每次换名 |
| appLabel | 桌面图标/启动页品牌名，如 `Haveri VahanCredit` |
| androidPackage | **applicationId**，如 `com.xxx.app`，不是应用中文名 |
| kind | T 包选 `loan-shell`；Y 包选 `standalone`。不要留「自动推断」除非 id 已是 `t*`/`y*` |
| TEST_MOBILE / TEST_OTP | 登录包必填。落盘后写入 `tests/aside/{id}.test.ts` |
| 真机跳过启动 | App **已经停在目标页** 才勾；冷启回归不要勾 |
| 覆盖已有 YAML/TS | 同名 `pages/{pageKey}.yaml` 要换掉才勾。默认不覆盖 |

4. 真机：卸载重装或清数据，从 **冷启** 开始录（和以后跑测一致）。不要从半登录状态录「完整登录脚本」。
5. 手边放一份 **PRD/AC 文案**（精确字符串）。记步骤时贴屏幕原文，不要凭记忆缩写。

---

## 3. 真机可靠录制（推荐工作流）

原则：**一屏一页、一步一义、能选动作类型就不要用 verify 凑。**

### 3.1 每进入一个新界面

1. 手机停在该屏，**先不要往下点**。
2. 点 **截屏预览**，确认控制台图就是当前屏。
3. 「新 pageKey」填 **英文短名**（文件系统名），再点 **新页面**：

   | 界面 | pageKey 示例 | 落盘文件 |
   |------|----------------|----------|
   | 冷启协议 | `bootstrap` | `pages/bootstrap.yaml` |
   | Welcome / 登录 | `login` | `pages/login.yaml` |
   | 手机号弹窗 | 可并入 `login`，不必单独页 | — |
   | OTP | 可并入 `login` | — |
   | KYC 第 1 步 | `kyc-personal` | `pages/kyc-personal.yaml` |

   **禁止**：全程只用默认 `recorded`。一页里混协议+登录+KYC，冷启对不上第一屏就会全挂。

   pageKey 规则：`a-z0-9-`，不要用「登录选择页面」这种中文（会变成乱码或非法文件名）。

4. 本页 **第一条** 用 `wait-page`（或冷启第一页用，见下），文案写本页 **标题级** 原文。

冷启第一页额外：开始录制后先追加（可在 bootstrap 页）：

- 不必在面板选（YAML 精修时再加 `wait-app-ready` / `handle-permissions` 也可以）。若只靠录制器：第一屏先 `wait-page`，文案写「Before you continue **或** Welcome **或** 权限弹窗」这种「已离开闪屏」的描述。更稳的是落盘后按 T53 手工加 `wait-app-ready`。

### 3.2 本页只记「以后脚本必须做的事」

手机上你可以随便点着玩；**写入轨迹的只有点了「追加步骤」的。**

推荐顺序（每页）：

1. `wait-page` — 等这页出来  
2. `verify` — **一条**，只断言本页稳定文案（标题 + 2～4 个主按钮）  
3. 操作：`checkbox` / `native-input` / `fill` / `tap-text`  
4. 离开本页的最后一个 `tap-text`（Continue / Send OTP / Verify & Login）

然后手机点到下一屏 → 回到 3.1 开新 pageKey。

### 3.3 六种步骤怎么用（可靠口径）

三个框：

- **类型**：这一步的引擎动作  
- **文案 / 目标**：屏幕上的 **完整原文**（含句号、大小写）  
- **填值**：仅 `fill` 使用  

#### `wait-page`

- **何时**：刚进新屏、点完按钮后画面在转。  
- **文案**：本页最稳的标题，如 `Enter OTP`、`Before you continue`。  
- **不要**：把三屏文案写进一句。  
- 落盘：`action: wait-page`。

#### `verify`

- **何时**：确认没进错页。每页 **最多 1 条**（UI 规范 STRICT 第二条等落盘后再手写）。  
- **文案**：本页关键句，或点一次 **从当前屏生成 verify** 后 **立刻删掉无关内容**（键盘 0–9、其它页标题、OCR 脏字如单独的 `s`）。  
- **禁止**：同一屏连点 4 次「从当前屏生成 verify」。T57 第一次落盘就是这样挂的。  
- **禁止**：断言「Welcome 和 Enter OTP 同时出现」。

#### `checkbox`

- **录的时候**：先在 **手机** 上勾上（好往下走）。  
- **记账**：类型 `checkbox`，文案 = 勾选旁 **整句**。不要用 `tap-text` 点框。  
- **不要**把协议链接行（Terms of Service 那一行 chevron）当成 checkbox。  
- 落盘后建议补 `locatePrompt`：「只点空方框，不要点蓝字链接」。引擎对 T53 登录有特判，**T57 等包必须自己写 locate**，否则可能点成 Anantapur 描述。

#### `tap-text`

- **何时**：按钮、链接、下拉选项。  
- **文案**：按钮上 **一字不差**，如 `Use Mobile Number`、`Verify & Login`、`Send OTP`。  
- **Continue 必须在脑内带场景**：协议弹窗 Continue ≠ KYC Continue。记账时文案仍是 `Continue`，但落盘后 **一定要改 locatePrompt**（「仅 Before you continue 弹窗底部的 Continue，不要点 Decline」）。录制器做不到自动区分。  
- 下拉：先 `tap-text` 字段名（`Gender`），再 `tap-text` **选项**（`Male`）。只点字段名等于没选。

#### `native-input`（登录手机号 / OTP）

- **何时**：走 `TEST_MOBILE` / `TEST_OTP` 的框。  
- **文案**：框的标签。  
- **填值框留空。**  
- **OTP 文案里必须出现 `otp` 三个字母**（大小写均可），落盘才会 `valueKey: otp`。  
  - 好：`OTP`、`Enter OTP`、`One-time code` 不行——**`One-time code` 不含 otp，会变成填手机号！**  
  - 可靠写法：文案填 `Enter OTP` 或 `OTP One-time code`。  
- 手机号：文案 `Mobile Number` 即可（默认 `valueKey: mobile`）。  
- 落盘后给弹窗输入加上 `autoDismissKeyboard: false`（收键盘用 ESC 可能关掉弹窗）。录制器不会写这一项。

#### `fill`

- **何时**：姓名、金额等 **写死字符串**。  
- **文案**：字段名；**填值**：如 `Ravi Kumar`。  
- **不要**用来填登录手机号/验证码。

### 3.4 按钮怎么点（真机 vs 记账）

| 动作 | 手机 | 控制台 |
|------|------|--------|
| 勾协议 | 点空方框 | `checkbox` + 整句 |
| 点 Use Mobile Number | 点按钮 | `tap-text` + `Use Mobile Number` |
| 填手机号 | 可以先手填好往下走 | 仍要追加 `native-input` + `Mobile Number`（跑测会再填一遍） |
| 发 OTP | 点 Send OTP | `tap-text` + `Send OTP` |

跑测是 **冷启重来**，不会接着你录制时的界面。所以「脚本里没记的步骤，跑的时候不会做」。

### 3.5 停止与落盘

1. 步数（右上角）要对：每页至少 wait + 关键操作。`0 步` 落盘会失败。  
2. **停止录制**（转换落盘才会亮）。  
3. 第一次落盘：**不要勾覆盖**。  
4. 同一 `packageId` + 同一 pageKey 再落盘：不勾覆盖会报「已存在」；勾了会 **整文件覆盖** 该 yaml / test.ts。  
5. **新 pageKey** 会追加到 `config/packages.yaml` 的 `pages[]`，不会删旧页。  
6. `cases/{id}-recorded.nl.txt` **每次落盘都覆盖**。

落盘后 **立刻** 做第 5 节精修，不要直接当回归。

---

## 4. 浏览器（Playwright）怎么用才比较稳

1. 模式选浏览器，填 **真实可打开的 URL**（不是 `https://…` 占位）。  
2. 一次性：`npm run playwright:install`。  
3. 开始录制 → 在弹出的 Chromium 里点/填（会自动记 click/fill）。  
4. URL 变化时会尝试按 path 拆 pageKey，不可靠：重要节点仍要点 **新页面**。  
5. 密码框可能记成 `***`。勾选可能被记成 checkbox 或 fill，落盘后核对。  
6. 自动步骤 locates 偏弱（「The clickable control with text …」），**H5 可跑、原生壳不能靠这个。**  
7. 停止 → 转换落盘 → 同样要精修 prompt。

---

## 5. 落盘后必做精修（可靠脚本的分界线）

对照 `packages/t53/pages/bootstrap.yaml`、`login.yaml` 改，至少：

1. **拆页**：`packages.yaml` 里顺序 = 冷启 → 登录 → KYC…；删掉无用的 `recorded.yaml`。  
2. 冷启页加 `wait-app-ready` + `handle-permissions`（optional）。  
3. 每个 `tap-text: Continue` 写清 **哪一层** 的 Continue。  
4. checkbox 补 `locatePrompt` / `checkedPrompt`（本包品牌，不要抄 Anantapur）。  
5. `native-input`：OTP 必须 `valueKey: otp`；手机号弹窗 `autoDismissKeyboard: false`；补 `locatePrompt`（点输入框中央，不要点 Send OTP / X）。  
6. 删重复 verify、删键盘数字、删跨页文案。  
7. KYC：`fill` 姓名；下拉必须「开字段 + 选选项」。  
8. `aiContext` 写本包品牌与易混包（Not RajWise / Not Anantapur）。  
9. 有 PRD 则按 AC 改断言原文；没 PRD 不要假装已验收（在 `cases/*.nl.txt` 写「未按 PRD 映射」）。  
10. 再 `npm run test:aside:{id}`。失败先看 `midscene_run/screenshots/`，再改 prompt，不要放宽到「差不多就行」。

---

## 6. 反模式（T57 已踩过）

- 全程一个 `recorded` 页  
- 同一屏多次「从当前屏生成 verify」  
- OTP 文案写成 `One-time code` → `valueKey: mobile`  
- `tap-text: Continue` 无 locate 限定  
- `tap-text: Marital` 不选具体选项  
- `fill` 登录手机号（应 `native-input`）  
- 文案写 `Mobile Numbe`（漏字母）  
- 把协议弹窗和 Welcome 写进同一条 verify  
- 未停录就点转换落盘  
- 勾覆盖把已精修的 login.yaml 盖成半成品  

---

## 7. 最小可靠示例（登录一页）

手机已在 Welcome，新页面 pageKey = `login`：

1. `wait-page` → `Welcome to Haveri VahanCredit`  
2. `verify` → `Choose how to continue`（或一条生成后删掉多余词）  
3. 手机勾底栏 → `checkbox` → 整句 Terms…  
4. `tap-text` → `Use Mobile Number`  
5. 等到手机号页（可仍在 login 页）→ `wait-page` → `Mobile Number`  
6. `native-input` → `Mobile Number`  
7. `tap-text` → `Send OTP`  
8. `wait-page` → `Enter OTP`  
9. `native-input` → `Enter OTP`（必须含 otp）  
10. `tap-text` → `Verify & Login`  

然后 **新页面** `kyc-personal`，不要把 KYC 接在同一页末尾凑合。

---

## 8. 跑测

```powershell
npm run test:aside:t57
```

或控制台：左侧包用例 → 勾设备 → 加入队列 → 开始并行执行。

跳过启动（已停在目标页）：`$env:ASIDE_SKIP_LAUNCH="1"`。

中间轨迹：`midscene_run/records/{sessionId}.json`。

---

## 9. API（调试用）

- `POST /api/record/start` `{ mode, packageId, url?, deviceId?, ... }`
- `POST /api/record/stop`
- `POST /api/record/step` / `page` / `screenshot` / `suggest-verify`
- `POST /api/record/generate` `{ sessionId?, overwrite? }`
- `GET /api/record/status` · `GET /api/record/trace`

录制与视觉跑测同时进行会 409。
