# T42 B 面页面与脚本

包名 `com.rajwiseguide.loanadvisor.app`。全流程冷启时，登录前用 T42 包内两页，登录后用共享 H5。

## 登录前（T42 包内）

| 页面 | 脚本 | 功能 |
|------|------|------|
| 冷启 / 协议 | `packages/t42/pages/bootstrap.yaml` | 等主界面、系统权限、Accept / Agree & Continue |
| OTP 登录 | `packages/t42/pages/login.yaml` | 勾选协议、手机号、Send OTP、Verify & Login |

## 登录后（共享 H5）

| 页面 | 脚本 | 功能 | 单页命令 |
|------|------|------|----------|
| 申请入口 | `data/apply-entry.yaml` | 权限、Usage Access、Begin Verification 或 Get Started | 无独立命令，走全流程或控制台单页 |
| Basic info | `data/basic-info.yaml` | 个人 / 地址 / 工作信息（V1 一页，V2 三页） | `npm run test:basic-info` |
| 紧急联系人 | `data/reference-contacts.yaml` | Primary、Secondary 联系人 | `npm run test:reference-contacts` |
| Aadhaar OCR | `data/kyc-aadhaar.yaml` | 人工拍照 OCR，再填 PAN | `npm run test:kyc-aadhaar` |
| 静默活体 | `data/kyc-liveness.yaml` | 引导、相机、自拍、Submit | `npm run test:kyc-liveness` |
| 绑卡 | `data/bank-info.yaml` | IFSC、账号、确认账号、授权勾选 | `npm run test:bank-info` |
| 申请成功 | `data/apply-success.yaml` | Apply、权限、Usage Access、Success Confirm | 无独立命令 |
| 还款 | `data/repay.yaml` | Repay Loan、还款详情、Repay、Auto-disburse | `npm run test:repay` |

KYC 五页连跑：`npm run test:kyc-full`（不含登录）。

## 全流程脚本

| 命令 | 脚本 | 串到的页面 |
|------|------|------------|
| `npm run test:business-new-user` | `tests/business-new-user.test.ts` | 冷启 → 登录 → 申请入口 → Basic info → 联系人 → OCR → 活体 → 绑卡 → 申请成功 |
| `npm run test:business-apply` | `tests/business-apply.test.ts` | 冷启 → 登录 → 申请成功 |
| `npm run test:business-repay` | `tests/business-repay.test.ts` | 冷启 → 登录 → 还款 |
| `npm run test:business-auto` | `tests/business-auto.test.ts` | 冷启 → 登录 → 按首页 Next / Apply / Go to repay 进入上面三条之一 |
