# T53 Anantapur Chakra A 面

云效：[T53AB面包开发 / WIFO-1993](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#openWorkitemIdentifier=d7ca23570f0f4e16da6a4366c1)

| 字段 | 值 |
|------|-----|
| packageId | t53 |
| kind | loan-shell |
| appLabel | Anantapur Chakra |
| androidPackage | `com.anantapurchakra.flexicredit.app` |
| 登录手机 | `9110001501` |
| 登录 OTP | `1234` |

| 命令 | 覆盖 |
|------|------|
| `npm run test:aside:t53` | 协议 → Mobile OTP 登录 → KYC 六步 → 固定额度 → 借款 → 还款 → 我的 → 登出 |

用例：`cases/t53-prd.nl.txt`

不把 T42 / T46 登录文案写入本包。Truecaller / Google 真登录、权限拒绝分支见 NL「未自动化」。
