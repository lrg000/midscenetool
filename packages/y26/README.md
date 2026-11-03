# Y26 Aarambh Calendar A 面

来源：[云效 PRD — Y26面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=11bbbf3e77b6062cba6f067efd)（`11bbbf3e77b6062cba6f067efd` / WIFO-1960）

| 字段 | 值 |
|------|-----|
| appLabel | Aarambh Calendar |
| androidPackage | `com.aarambhdailycalendar.app` |
| 定位 | 复古纸张月历 → Day Schedule → New Schedule Sheet |
| 页面 | 2 页，无底栏 Tab |

主流程覆盖 **TC-001~010、012~022、026~028**（TC-011/020 时间选择器软覆盖；TC-023 卸专项；TC-024/025 注入不测）。

```powershell
adb shell am force-stop com.aarambhdailycalendar.app
npm run test:aside:y26

# TC-023 卸载清数据
$env:Y26_APK_PATH = "F:\path\to\app.apk"
$env:Y26_RUN_UNINSTALL = "1"
npm run test:aside:y26:uninstall
```
