# Y20 Daily Grid A 面



来源：[云效 PRD — Y20面包开发](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=0e040308d09761451e8d96019c)（`0e040308d09761451e8d96019c`）



| 字段 | 值 |

|------|-----|

| appLabel | Daily Grid |

| androidPackage | `com.dailygrid.lifecaptured.app` |

| 定位 | 本地日历，无登录，2 页（月历 → 当天行程） |



主流程覆盖 **AC-001~AC-019**（除 AC-020 深色模式）及 **TC-001~TC-010**；见 `cases/y20-prd.nl.txt`。



**AC-016** 使用 `force-stop-app`（`adb am force-stop`）模拟关闭 App 与异常杀进程，再 `relaunch-app` 校验 SQLite 持久化。



**AC-017** 为破坏性专项（卸载 + 重装），需单独执行：



```powershell

npm run test:aside:y20



# AC-017（会卸载 App）

$env:Y20_APK_PATH = "F:\FTP 服务器\恒民的包\Y20\debug\app-debug_优化版.apk"

$env:Y20_RUN_UNINSTALL = "1"

npm run test:aside:y20:uninstall

```



用例见 `cases/y20-prd.nl.txt`。


