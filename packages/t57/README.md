# Haveri VahanCredit (`t57`)

- kind: loan-shell
- androidPackage: `com.haveridriveloan.vahancredit.app`
- 来源: Dashboard 录制后按屏拆分精修（非云效 PRD 全量）
- 执行: `npm run test:aside:t57`
- 账号: `9110001559` / OTP `1234`（`tests/aside/t57.test.ts`）

页面：`bootstrap`（Before you continue）→ `login`（Welcome / 手机号 / OTP）→ `kyc-personal`（Step 1）。
Marital / Education 选项文案若与实机不符，步骤标了 `optional`，需对照截图再改 locatePrompt。
