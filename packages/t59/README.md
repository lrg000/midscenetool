# T59 Viramgam CardVista A 面

云效：[T59AB面包开发 / WIFO-2110](https://devops.aliyun.com/projex/project/f56f3edd04756632f67acd5450/req#viewIdentifier=d7f112f9d023e2108fa1b0d8&openWorkitemIdentifier=a9c8f29ec7c367447b1d5e9938)

| 字段 | 值 |
|------|-----|
| packageId | t59 |
| kind | loan-shell |
| appLabel | Viramgam CardVista |
| androidPackage | `com.viramgamcard.cardvista.app` |
| 登录手机 | `9110001559` |
| 登录 OTP | `1234` |

| 命令 | 覆盖 |
|------|------|
| `npm run test:aside:t59` | 协议 → Phone OTP → Home/Cards/Activity/My → 加卡/账单/部分还款 → 登出 Cancel 再确认 → 再登录核对数据仍在 |

用例：`cases/t59-prd.nl.txt`

不把 T42 / T46 / T53 登录文案写入本包。Truecaller / Google 真登录、逾期态、拒权见 NL「未自动化」。
密钥、jks、firebase admin、邮箱密码不入库。
