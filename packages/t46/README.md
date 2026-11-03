# T46.Sree Dhan Lekha A 面

设计稿：[T46.Sree-Dhan-Lekha Figma](https://www.figma.com/design/K3Y5QORZ3zy8lNkwz0ABIV/T46.Sree-Dhan-Lekha?node-id=0-1&p=f)  
本地 UI：`figma/`（见 `figma-index.json`）

| 字段 | 值 |
|------|-----|
| appLabel | Sree Dhan Lekha |
| androidPackage | `com.sreedhan.lekhabook.app` |
| 登录手机 | `9110001244` |
| 登录 OTP | `123456` |

| 命令 | 覆盖 |
|------|------|
| `npm run test:aside:t46` | 协议 → Charter(可选) → Phone Code 登录 → Home(+记一笔校验返回) → Statistics → Profile(+账户配置返回) |

**业务要点**
- 登录全页：`Phone Code Verification` → `SEND CODE` → `VERIFY CODE`（非 T42 弹窗）
- 记一笔：`Record Transaction` / `COMMIT TRANSACTION ACTION`（冒烟不提交）
- 账户：`Account Configuration` / `COMMIT REGISTRY REWRITE`（冒烟不提交）
- 勿点：协议金链、Welcome Terms 金链、Purge / Terminate

用例：`cases/t46-figma.nl.txt`
