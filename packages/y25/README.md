# Y25 Chitra Stickers A 面

来源：[云效 PRD — Y25面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=1193c1c5bb9b624cdd83471e07)（`1193c1c5bb9b624cdd83471e07` / WIFO-1959）

| 字段 | 值 |
|------|-----|
| appLabel | Chitra Stickers |
| androidPackage | `com.chitrachitra.stickers.app` |
| 定位 | 本地贴纸：Explore 分类/Grid → 详情下载 → My Stickers（Downloaded/Uploaded） |
| 底栏 | Explore / My |

主流程覆盖 **TC-001~007、TC-015、TC-019、TC-025~026**；见 `cases/y25-prd.nl.txt`。

```powershell
adb shell am force-stop com.chitrachitra.stickers.app
npm run test:aside:y25

# TC-021 卸载清数据（破坏性）
$env:Y25_APK_PATH = "F:\path\to\app.apk"
$env:Y25_RUN_UNINSTALL = "1"
npm run test:aside:y25:uninstall
```
