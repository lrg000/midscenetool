# Y28 MastiMagic Craft A 面

来源：[云效 PRD — Y28面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=4f5dad82ee7d00e4f0c02229c7)（`4f5dad82ee7d00e4f0c02229c7` / WIFO-1965）

| 字段 | 值 |
|------|-----|
| appLabel | MastiMagic Craft |
| androidPackage | `com.mastimagic.craftphoto.app` |
| 定位 | Soft Stationery 贴纸：Home 浏览下载 → Create 自制 → My 删除持久化 |
| 底栏 | Home / Create / My |

主流程覆盖 **§30.1~30.5、30.7~30.8**（拒权专项见 NL）。不做 AI 抠图/复杂编辑。

```powershell
adb shell am force-stop com.mastimagic.craftphoto.app
npm run test:aside:y28
```
