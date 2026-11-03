# Y27 Sakhi Rangoli (PicBox) A 面

来源：[云效 PRD — Y27面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=f247cecc0ee66a2ea9b3c7d6aa)（`f247cecc0ee66a2ea9b3c7d6aa` / WIFO-1962）

| 字段 | 值 |
|------|-----|
| appLabel | Sakhi Rangoli |
| androidPackage | `com.sakhiphoto.rangoli.app` |
| 定位 | Editorial 杂志风：My Photos 瀑布流 → 预览下载删除 → Albums/加密 → 持久化 |
| 导航 | 顶栏 Photos \| Albums（无底栏 Tab） |

主流程覆盖 **§33.1~33.8、33.10~33.11**（拒权/两次密码不一致专项软说明见 NL）。正文明确**不包含图片编辑**。

```powershell
adb shell am force-stop com.sakhiphoto.rangoli.app
npm run test:aside:y27
```
