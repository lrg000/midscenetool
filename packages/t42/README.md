# T42.RajWise A 面

设计稿：[T42.RajWise Figma](https://www.figma.com/design/WyXM6yVCpAI7TmrgGuYPZY/T42.RajWise?node-id=0-1)

| 命令 | 覆盖 |
|------|------|
| `npm run test:aside:t42` | 冷启/协议 → OTP 登录 → **登录后全文案校验** |
| `npm run test:aside:t42-postlogin` | **仅登录后**（设备已在 A 面 Home） |

登录后校验页：Home → Get Cash Now 主流程 → 贷款详情 → Profile → Help → Account Details。  
文案断言与实机/Figma 对齐；Help 邮箱以实机 `business@rajwiseloanadvisor.com` 为准。用例见 `cases/postlogin-figma.nl.txt`。
