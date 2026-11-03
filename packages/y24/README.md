# Y24 Glimmer Frame A 面

来源：[云效 PRD — Y24面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=e03110351ae85d71af463beadd)（`e03110351ae85d71af463beadd` / WIFO-1958）

| 字段 | 值 |
|------|-----|
| appLabel | Glimmer Frame |
| androidPackage | `com.glimmer.frameexitpic.app` |
| 定位 | 深色图库：Photos 导入/查看/下载/删除 → Albums CRUD → 加密相册 → 持久化 |
| 底栏 | Photos / Albums |

主流程覆盖 **TC-001~021、024~025、027~030**（TC-022/023 注入与拒权见 NL；TC-026 卸专项）。产品文档明确**不包含图片编辑**。

```powershell
adb shell am force-stop com.glimmer.frameexitpic.app
npm run test:aside:y24

# TC-026 卸载清数据（破坏性）
$env:Y24_APK_PATH = "F:\path\to\app.apk"
$env:Y24_RUN_UNINSTALL = "1"
npm run test:aside:y24:uninstall
```
