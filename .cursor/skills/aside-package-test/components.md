# A/B 面常用组件约定

生成或改 A 面 YAML 时按组件选型；`locatePrompt` / `assertPrompt` 尽量套用下方句式。

## A 面组件

### `credit-limit-card`（首页额度卡）

- 特征：`AVAILABLE CREDIT LIMIT`、金额、`Get Cash Now`
- verify：额度标题 + 蓝色主按钮可见；底部 Home Tab 选中
- 多数壳包默认**不点击**（进 B 面 H5）；**T42** 须点并走完原生主流程（Personal Information → Document Upload → Face → Result）

### `bottom-tab`（底部导航）

- 特征：Home / Profile（或包内变体）
- locate：`The bottom navigation tab labeled "{Name}" (... icon). Do NOT tap ...`
- 切页：上一页 flow 末步 tap 目标 Tab，下一页首步 verify 选中态

### `service-tile`（Our Services 磁贴）

- 特征：网格图标 + Personal Loan 等文案
- 冒烟：只 verify 区块标题；勿点进深链除非包用例需要

### `settings-row`（Profile 列表行）

- 特征：左图标 + 文案 + 右 chevron
- locate：`The settings row labeled "{Name}" with ... icon and chevron. Do NOT tap ...`

### `destructive-row` + `confirm-dialog`

- 行：红色 `Delete Account`
- 弹窗：标题 `Delete Account?`、红钮 `Yes, Delete My Account`、灰钮 `Cancel`
- 规范：打开 → verify 弹窗 → **Cancel**（除非专项删除用例）

### `form-text-input`（Account Details 等）

- 特征：标签 + 占位符（Nickname / Email）
- `type: input` + `locatePrompt`
- A 面冒烟：`skipEmptyBlurTest` + `skipInvalidBlurTest`（失焦不校验，**不写入跳过记录**；空内容改由 AC-010 flow 测）
- `blurTarget` 指向页头标题；主按钮写入 `bottomFields` 便于点前下滑

### `calendar-home`（Y20 Daily Grid 月历）

- 无登录、无 Tab；Header：Today / 月份 / 切换箭头
- 今日：蓝圈白字；有行程：日期右下角蓝点
- 点日期格进入 day-schedule（勿点 Today 文字除非 AC-004）

### `calendar-home`（月历首页）

- 独立 **UI 首页 PRD 配色字号与 Header** verify：#FFFFFF / #3B82F6 / #111827 / 56dp / 24sp / 48dp / 4dp
- **AC-019** 圆角 16dp + 极简轻阴影
- split UI：月份断言只看顶部 header+grid

### `retro-paper-calendar`（Y26 Aarambh Calendar）

- 米白 #F7F3EA + 墨绿 #245C4A；今日**描边圆**（非蓝实心）；选中 #DDE9E1；Header 64dp Today
- 空态：**Nothing planned** / **Add a schedule for this day.** / **+ Add Schedule**
- Sheet：**What are you planning?** / **Save Schedule** / All Day；删除 **Delete this schedule?**
- 清理：`ensure-y26-clean-state`；勿套用 Y20 蓝白断言
- 参考：`packages/y26/pages/*.yaml`

### `editorial-photo-albums`（Y27 Sakhi Rangoli / PicBox）

- 顶栏 **Photos | Albums**（无底栏 Tab）；背景 #FAFAF8；主色 #FF6B4A；瀑布流非 3 列死 Grid
- 上传：+ → **Choose from Gallery**；预览 **Download** → **Saved to Photos**；删图 **Delete this photo?**
- 相册：**New Album** / **Please enter an album name**；**Download All**；**Delete this album?**（不删图）
- 加密：**Lock Album** / 4 位 / **Incorrect passcode** / 🔒
- 参考：`packages/y27/pages/*.yaml`

### `soft-stationery-stickers`（Y28 MastiMagic Craft）

- 底栏 **Home / Create / My**；奶油白 #F8F6EF + 薄荷绿 #73B9A4；**Sticker Board**
- 详情：**Download Sticker** → **Sticker saved!** / Saved / Downloaded
- Create：**Add a Photo** → **Sticker Name**（默认 My Sticker，≤30）→ **Save Sticker** → **Sticker created!**
- My：**Delete this sticker?**；空态 **Your sticker board is empty**
- 参考：`packages/y28/pages/*.yaml`

### `day-schedule-fab`（当天行程 + Bottom Sheet）

- **UI 行程页 PRD 标题字号与 FAB**：28sp / 16sp / FAB 56dp #3B82F6
- **AC-009 STRICT**：Sheet ~45%、Save 全宽 48dp #3B82F6、16dp 圆角
- **UI 行程卡片 PRD 尺寸与圆角**：56dp / 16dp / 16sp
- **AC-010 / TC-006**：必须 `Please enter schedule.`
- **AC-012**：101 字 + `Maximum 100 characters.` / NN/100
- Bottom Sheet 输入：`skipScrollBeforeInput` + `skipBlurAfterInput`；超限用 `fill-input`
- Save：`scrollBeforeTap: false`
- 卡片列表 / 空状态 No Schedule
- 删除：垃圾桶 → Delete this schedule? → Delete（Y20 PRD 要求测删除）
- 回月历后校验 4dp 蓝点出现/消失

### `form-picker-row`（带 chevron / +91）

- 如 Emergency Contact：tap 打开 → `handle-permissions` → `pick-native-contact`（contactIndex）→ verify 回显
- 勿当纯文本输入；Save 后再 verify 联系人未丢失

### `dark-gallery-albums`（Y24 Glimmer Frame）

- 底栏 **Photos / Albums**；深色 #0B0B0D + 紫 #8B5CF6；**无登录、无图片编辑**
- Photos：`+` / Add Photos → 系统选择器；空态 **No Photos** / **Add photos from your device.**
- Viewer：`⋯` → **Download**（Photo saved.）/ **Delete**（Delete this photo?）
- Albums：**New Album** / Album name≤30 / **Create Album**；**Add Photos**；**Download All**；**Delete Album**
- 加密：**Protect this album** → 4–6 位；**Incorrect password.** / **Password must be 4-6 digits.**
- 参考：`packages/y24/pages/*.yaml`

### `primary-button`

- 如 `Save changes` / `Get Cash Now`：写清 solid blue + 底部/卡片位置

### `header-back`

- locate：`The back arrow (<) in the top-left of the "{Page}" header (not Android system Back)`

### `rajwise-otp-login`（T42.RajWise Welcome + OTP）

- 特征：Welcome + Truecaller / Google / **Login with Mobile Number** + 底部协议勾选
- 协议弹窗：`Accept & Continue` 或 `Agree & Continue`（optional，居中勿 scroll）
- OTP：`Login with OTP`（+91 / Send OTP）→ `Enter OTP` / `Verify & Login`
- 实现：`checkbox` + `tap-text` + `native-input`（mobile/otp）；凭证 `TEST_MOBILE`/`TEST_OTP`
- 参考：`packages/t42/pages/bootstrap.yaml` + `login.yaml`；Figma T42.RajWise

### `sree-dhan-phone-code-login`（T46 Sree Dhan Lekha）

- **勿复用 T42 登录前**：无 Welcome to RajWise / Login with Mobile Number / Verify & Login 弹窗
- 协议：`Before You Continue` → 黑钮 `ACCEPT & CONTINUE`（勿点 DECLINE / 金链）
- 实机可选：`Charter of Operation` 勾选 + `CONTINUE`
- Welcome：`Sree Dhan Lekha` + `CINTINUE WITH PHONE CODE` + Terms 勾选（只点方框）
- 发码页（`login-otp.png`）：`Phone Code` / `Verification` + `10-digit handset ID` + `SEND CODE`
- OTP（`fill-otp.png`）：`Code dispatched to:` + `Enter code` + `VERIFY CODE` + `RESEND IN`
- 参考：`packages/t46/pages/bootstrap.yaml` + `login.yaml`

### `finance-journal-home`（T46 首页）

- `TOTAL INCOME` / `TOTAL EXPENSE` + `TRANSACTIONS JOURNAL` + `+ ADD ACTION`
- 记一笔：`Record Transaction` / `COMMIT TRANSACTION ACTION`（冒烟进页后返回）

### `finance-statistics`（T46 统计）

- 底栏中间 pie 图标；无独立 PNG 时软断言图表/标题

### `chamber-profile`（T46 我的）

- `User`；`ACCOUNT CONFIGURATION` / `VIEW PROTOCOLS` / `PURGE` / `TERMINATE`
- 账户配置：`CHAMBER USERNAME` / `COMMIT REGISTRY REWRITE`（冒烟进页后返回）

## B 面组件（对照，勿写进 packages/*/）

| 组件 | 示例文案 | 归属 |
|------|----------|------|
| `h5-progress-header` | Personal Information + 顶栏进度条 | `data/*.yaml` |
| `h5-continue` | Continue | B 面 submit / tap-text |
| `h5-upload-zone` | Upload PAN Card / Aadhaar | KYC 类 |
| `h5-selfie` | Face Verification / Take a picture | kyc-liveness |

B 面继续用现有 `dropdown` / `input` / `contact` / `submit` 规范，不要复制到 A 面包目录。

## 包目录约定

```
packages/{packageId}/
  README.md          # 可选
  pages/
    home.yaml
    profile.yaml
    ...
tests/aside/{packageId}.test.ts
config/packages.yaml  # 注册 pages 顺序
```
