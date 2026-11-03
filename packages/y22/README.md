# Y22 Daily Scribble Pad A 面

来源：[云效 PRD — Y22面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=9da8087be8f5e358d958a82bb1)（`9da8087be8f5e358d958a82bb1` / WIFO-1862）

| 字段 | 值 |
|------|-----|
| appLabel | Daily Scribble Pad |
| androidPackage | `com.dailyscribble.writepad.app` |
| 定位 | 本地便签，无登录，2 页（Notes 列表 → 详情 / New Note Sheet） |
| Figma | [Y10-Akshar-Note](https://www.figma.com/design/m8elDk0Rg8xCKqNQlTD4HJ/Y10-Akshar-Note)（文案以 PRD 为准） |

主流程覆盖 **TC-001~TC-014、TC-018~019**；见 `cases/y22-prd.nl.txt`。

```powershell
adb shell am force-stop com.dailyscribble.writepad.app
npm run test:aside:y22

# TC-015 卸载清数据（破坏性）
$env:Y22_APK_PATH = "F:\path\to\app.apk"
$env:Y22_RUN_UNINSTALL = "1"
npm run test:aside:y22:uninstall
```
