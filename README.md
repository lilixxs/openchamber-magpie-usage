# openchamber-magpie-usage

OpenChamber 右侧栏扩展：显示 magpie 网关的用量汇总、趋势与全部额度卡。

面板从不直接联网。它只经 `host.serviceRequest()` 访问本扩展自带的本地服务；本地服务读取用户配置的端点，向上游 magpie 发起只读 GET，把结果规范化后交回面板。

## 安装

在 OpenChamber 打开 **Settings → Extensions**，把下面的地址填入 *Folder, ZIP, or URL*，然后选择 **Add**：

```text
https://github.com/lilixxs/openchamber-magpie-usage.git
```

安装后批准 **Run a local service**，再点右侧栏的柱状图图标打开面板。

开发时可直接填入本地目录：

```text
D:\学习\git-prj\js_prj\openchamber-magpie-usage
```

## 配置

唯一的配置来源是：

```text
$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json
```

没有 `XDG_CONFIG_HOME` 时用 `~/.config/openchamber-magpie-usage/config.json`。Windows 上即 `C:\Users\<you>\.config\openchamber-magpie-usage\config.json`，三个平台路径相同。

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "apiKey": "可选；非环回端点几乎一定需要",
  "refreshSeconds": 60,
  "cardOrder": ["r-magpie%2Fworkbuddy|subscription|Lilixxs"],
  "language": "auto"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `baseUrl` | 否 | 绝对 http(s) URL，不得带账号密码、查询串或片段；**非环回地址必须用 https**；允许带路径前缀 |
| `apiKey` | 否 | 非空字符串，不含空白与控制字符；只以 `Authorization: Bearer` 发送，绝不进 URL |
| `refreshSeconds` | 否 | 整数 5–3600，默认 60 |
| `cardOrder` | 否 | 额度卡顺序，字符串数组；最多 500 项，每项 1–200 字符。**宽松**：值不是数组、含非字符串项、项超长或超量时只忽略该项，其余配置照常生效——顺序是外观，坏顺序绝不会把端点降级 |
| `language` | 否 | `auto`（默认）、`en` 或 `zh-CN`；大小写敏感，必须与 `panel/locales/index.json` 的 `code` 全等。非字符串或空串回退 `auto` 并提示，端点与密钥照常生效 |

- 文件不存在：回退到 `http://127.0.0.1:3425`，不带密钥。
- 文件存在但不可用（JSON 错、字段越界、http 指向远端等）：同样回退到上述默认端点，并在面板 Configuration 区显示原因。面板不会因此空白。
- 服务**每次请求**都重新读文件，改完保存即生效，不用重启服务或 OpenChamber。
- `apiKey` 不存在、为 `null` 或空串之外的值不合法；`apiKey` 为 `null` 等同于不配置。
- `cardOrder` 由面板拖拽写入（见「服务接口」），格式为 `encodeURIComponent(provider)|encodeURIComponent(kind)|encodeURIComponent(user)`；同一个三元组的第二、第三张卡追加 `#2`、`#3`。网关已不存在的键会被忽略，网关新增的卡片排在末尾。
- 服务写文件时统一 2 空格缩进 + 结尾换行，保留未知顶层键，沿用原文件权限（读不到时 0600），先写临时文件再 `rename` 覆盖。
- 若拖拽时文件已不是合法的 JSON 对象，服务先把原文复制为 `config.json.bak`（已存在则 `config.json.bak-<UTC 时间戳>`），再写入只含 `cardOrder` 的合法文件，并在面板 Configuration 区保留一条提示。文件缺失时则新建，面板的「No config file yet」随之消失。
- `language` 为 `auto` 时跟随 OpenChamber 语言：只有 `zh-CN` 精确命中华语包，`zh-TW`、`ja`、`de` 等一律显示英文。显式写 `en` / `zh-CN` 可覆盖宿主语言；写了 `index.json` 里不存在的值会回退 `auto` 并显示提示。面板每轮刷新（默认 60 秒）重读 `/config`，改完语言最多等一个周期生效。
- 词条与贡献流程见 [docs/translations.md](docs/translations.md)。本仓库把语言包在构建期内联进 `panel/main.js`（面板禁止 `fetch`），所以新增语言除了加 JSON，还要在 `src/panel/app.ts` 增加 import 与 `MESSAGES` 映射，然后重建产物。

密钥只进入服务进程。面板只拿到「是否已配置」这个布尔值，没有输入框，不回显，不写入任何存储、日志、URL 或构建产物。

## 面板显示什么

- **Usage**：`today` / `7d` / `30d` 三段切换。Tokens（in + out）、缓存命中率、调用数（含失败、重试、循环）、估算成本与 unpriced 数、credits、统计起点 `since`。
- **趋势图**：按上游 `series` 逐桶画柱，输入（含缓存）与输出分段，桶过多时按 6/5 个抽稀标签并总保留最后一根。
- **Quotas**：对齐 magpie 自己的额度页。
  - 每张卡一行头：左侧厂商标识（也是拖拽手柄）、卡名、套餐标签、该卡最紧的剩余百分比；点头部展开/收起，展开状态按卡片记忆（刷新后保留），默认展开前 2 张。**错误卡始终完整可见、不可折叠。**
  - 窗口按上游 `pool` 分组，一个 pool 一行，行内两列网格；窗口不足两个时靠左排，第三个自动换行。卡片宽度小于 260px 时（容器查询）改为单列。
  - 每个窗口格：窗口名、`N% left` 数字、填到「剩余」的 4px 进度条（剩余 ≤0.5% 时用 warning 色）、`剩余 / 上限 单位`（由 `limit − amount` 算出，没有可减的数时原样显示上游 `display`）、`resets …`、`runs out …`，以及 `pool …` 行。
  - **同一 pool 里的按模型分层**（`… · Gemini 3.8 Flash (High)` / `(Low)` / `(Medium)`）不单独渲染，避免一面墙的进度条；只有某个 pool 完全没有时长窗口时，才保留其中用得最狠的一层，保证不丢卡。
  - 余额卡把上游那条 ` · ` 连接的字符串拆成「标签 / 数值」行（标签 = 最后一个空格前的文字），单段字符串整体显示。
  - 卡片顺序：拖动左侧厂商标识，或聚焦它后按 ↑ / ↓ / Home / End。顺序写入 `config.json` 的 `cardOrder`；写盘失败时保留当前顺序，并在 Quotas 标题旁显示 `order not saved`，下次放下时重试。键盘移动会通过 `aria-live` 播报新位置。
  - 厂商标识来自 magpie 仓库的图标集（见「许可」）：彩色标记以 data URI `<img>` 渲染，单色标记用 `currentColor` 遮罩，因此跟随主题；不认识的供应商用通用字形，不会出现坏图。
- **Configuration**：配置文件绝对路径、生效端点、密钥是否已配置、刷新间隔、配置错误，以及配置被重置时的提示（备份文件路径）。

命中率口径：

```text
cache_read / (input + cache_read + cache_write)
```

分母为 0 时整行显示 `—`（不显示 0%，也不会出现 NaN）。

数据来源标注：标题下方写明生效端点（loopback/remote）；页脚写明「本机网关统计的、发往该端点的用量，不是该端点的全部用量」。经远端消耗的用量不包括其他客户端直连远端产生的请求。

## 服务接口

服务只监听 `127.0.0.1:<host 分配端口>`，每个请求都校验 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。只接受 `GET`，以及写顺序用的 `POST /config/order`；其余方法/路径组合一律 405 / 404。

| 路径 | 作用 |
| --- | --- |
| `GET /health` | 原有契约 `{ ok, name, apiVersion }`，未改动 |
| `GET /config` | 配置路径、生效端点、`apiKeyConfigured`、刷新间隔、`cardOrder`、`reset`（配置被替换时的 `{ at, backupPath }`，否则 `null`）、配置问题 |
| `POST /config/order` | 体 `{ "order": string[] }`；200 `{ ok: true, order, reset }`。体上限 64 KiB，1–500 个字符串、每个 1–200 字符，其余一律 400 `bad-request` |
| `GET /v1/magpie/usage?period=today\|7d\|30d` | 规范化后的用量汇总 |
| `GET /v1/magpie/quotas?kept=1` | 优先读上游缓存 |
| `GET /v1/magpie/quotas?refresh=1` | 请求新读数，30 秒内重复请求被节流 |

写顺序的细节：

- 同一进程内所有写入串成一条 promise 链，两个面板不会交错读-改-写。
- 读文件 → 合并 `cardOrder` → 写 `<path>.<pid>.<rand>.tmp` → 按原文件权限 `chmod` 临时文件（读不到时 0600）→ `rename` 覆盖。
- 文件不是合法 JSON **对象**时：先备份原文（`.bak`，已存在则 `.bak-<UTC 时间戳>`），再写入 `{ "cardOrder": [...] }`，并把 `{ at, backupPath }` 记在内存里供 `/config` 回报（服务重启后清空）。
- 文件缺失时直接新建；副作用是 `present` 变为 `true`，面板的「No config file yet」随之消失。

刷新策略：

- 周期自动刷新：用量直接取汇总；额度先请求上游 `?kept=1`。
- 手动刷新：额度请求上游不带 `kept` 的新读数，并以 30 秒窗口节流；窗口内的重复点击返回上一次读数并标记 `throttled`。
- **实测差异**：本机 magpie（`0.1.2470`）对 `GET /v1/magpie/quotas?kept=1` 返回空的 `data` 数组，而普通请求返回 12 张卡。因此服务在 `kept=1` 返回 0 张卡时回退到最近一次成功读数并标记 `stale`；若此前没有任何读数，则做一次普通读取。否则每次自动刷新都会把额度卡清空。

错误映射（HTTP 502/504，逐类区分，绝不与网络错误混同）：

`upstream-unauthorized`(401) · `upstream-forbidden`(403) · `upstream-status`(其他) · `upstream-timeout`(504) · `upstream-network`(连不上) · `upstream-not-json` · `upstream-schema`(结构不符) · `upstream-redirect`(跨源重定向被拒)。

重定向策略：`redirect: "manual"`。只跟随同源重定向（最多 3 次）；任何跨源重定向直接拒绝，密钥不会被带到其他源。

上游错误体不会回传给面板，只回传类别、状态码与端点，避免上游把密钥或内部信息写进响应。

## 边界

- 面板运行在沙箱 iframe，只加载 classic IIFE 的 `panel/main.js`，不能 `fetch`、不能用 XHR、不能读写浏览器存储，也不能拨号到本地服务；顺序保存同样走 `host.serviceRequest` 的 POST，面板自身不发任何网络请求。
- 面板颜色只用宿主注入的 `--oc-*` 变量；样式表内没有硬编码色值。
- 宿主控件（徽标、刷新按钮）在模块加载时挂载一次；`onReady` 再次触发时只更新值。
- 本地服务以当前用户权限运行，遵循上面的监听与鉴权约束。

## 开发

需要 Bun 1.4 或更高版本。

```bash
bun install
bun run check     # 类型检查 → 测试 → 构建
bun run build     # 只构建 panel/main.js 和 service/main.js
bun test          # 全部测试
bun test tests/quotas.test.ts
bun run typecheck
```

OpenChamber 不编译 TypeScript。`panel/main.js` 与 `service/main.js` 是构建产物，必须提交。改动 `src/` 或 `panel/locales/` 后运行 `bun run build`（语言包在构建期内联进面板）。

### 测试覆盖

`bun test` 全部离线（hermetic）：假网关、临时配置目录、真实 HTTP 往返；面板测试用 fake host 与 happy-dom，不启动 HTTP、不连接真实宿主。

| 文件 | 内容 |
| --- | --- |
| `tests/config.test.ts` | 配置校验：JSON 形状、http/https 规则、环回判定、凭据与查询串、密钥字符、刷新区间、未知键；`cardOrder` 宽松解析、顺序键编码、`#2` 后缀、已知/未知/过期键的排序；`language` 默认值、显式值、坏值回退且不降级端点 |
| `tests/i18n.test.ts` | 注册表合法性、键齐全、占位符一致、CLDR 复数类别（en 的 `one/other`、zh-CN 的 `other`）、插值/回退、`resolveLocale` 的精确匹配与 unsupported 标记 |
| `tests/format.test.ts` | 数字/成本/credits/百分比/时间格式化，命中率分母为 0，窗口百分比回退链，金额行优先级 |
| `tests/quotas-view.test.ts` | pool 分组与分层折叠（Antigravity 3 行、9 个分层隐藏）、时长排序、无 pool 窗口共用一行、剩余口径金额行、余额拆分、最紧剩余、图标映射与兜底 |
| `tests/service.test.ts` | Bearer 校验、`/health` 契约、`/config` 三条路径、改文件即时生效、方法与路径组合 405/404；`POST /config/order` 的写入、保留未知键与权限、缺失时新建、非法文件备份+重置+回报、拒绝坏体与超大体积、并发写入、401 |
| `tests/usage.test.ts` | 周期与密钥转发、缺省周期、非法周期、缺失字段不产生 NaN、401/403/500/超时/连不上/非 JSON/结构不符 |
| `tests/quotas.test.ts` | 全部卡片变体、`kept`/`refresh` 转发、节流、空缓存回退、跨源重定向拒绝、同源重定向跟随 |
| `tests/secret.test.ts` | 密钥不出现在 `/config`、日志、构建产物；源码无密钥字面量 |
| `tests/panel-bundle.test.ts` | 面板是 classic IIFE、无 fetch/XHR、无存储、只用 `--oc-*`、控件不在 `onReady` 内挂载且只挂一次、图标以 data URI 内联、两列网格与容器查询存在 |
| `tests/panel-host.test.ts` | 面板经 fake host 挂载：首屏 `/config`、usage、`kept=1` 请求与 KPI/额度卡；`HostRequestError` 全 code、服务错误词汇表、非 JSON 与回应形状错误且不回显上游原文；周期切换只重拉 usage、手动刷新带 `refresh=1`、throttled/stale 文案；键盘排序写入 `/config/order`、写失败显示 `order not saved`、展开/折叠；重复 `onReady` 不重复挂载、serviceStatus 四种徽章；`language` 与宿主 locale 的选择、回退与 `languageInvalid` |

## 验证记录（2026-11-01，额度卡改版）

已验证：

- `bun run check` 全绿（typecheck + 全部测试 + 构建）。
- 连续两次 `bun run build` 产物 SHA-256 不变：`panel/main.js` `EC65B475…B4DA81`，`service/main.js` `A0535553…8E50C6E95`；`bun install --frozen-lockfile` 通过。
- 面板桥接层测试 `tests/panel-host.test.ts`（happy-dom + fake host）全部通过：首屏三个请求、错误映射、周期/刷新、键盘排序、展开状态、重复 `onReady` 与语言选择；不启动 HTTP、不连真实宿主、不读写用户配置目录。
- 在真实 Chromium 中用模拟宿主（`service-request` 经本地代理转给**构建产物**服务）读取本机 `127.0.0.1:3425`：12 张卡全部渲染，无脚本错误。
  - Antigravity 折成 3 个 pool 行（Claude & GPT 2 格、Gemini 2 格、Gemini 4 Argon 1 格），9 个 `(High)/(Low)/(Medium)` 分层全部隐藏，窗口按 5 小时 → 7 天排序。
  - `openai-mm` 的余额串拆成 14 行标签/数值；单段余额 `¥21.08` 整体显示；`unlimited`、2 张错误卡、4 张余额卡行为正确；所有金额行无 `NaN`。
  - 容器查询实测：卡宽 ~340px 时 `grid-template-columns` 为 `154px 154px`，卡宽 240px 时降为单列 `220px`。
- 拖拽第一张卡到第三位：`config.json` 写入 `cardOrder`，`baseUrl` 原样保留，重新打开面板顺序不变；键盘 `End` 移动生效，`aria-live` 播报「moved to position 12 of 12」。
- 手工把 `config.json` 写成非法 JSON 后再拖一张卡：原文逐字复制到 `config.json.bak`，文件被重写为只含 `cardOrder` 的合法 JSON（2 空格缩进、结尾换行），Configuration 区显示 `config.json was invalid; saved as … and reset`。
- 让写盘失败（配置路径被目录占用）：面板保留新顺序，Quotas 标题旁出现 `order not saved`，提示里带服务给出的原因。
- 构建体积：`panel/main.js` 110,454 字节。图标内联约 +28 KB，同一处还有本地化文案约 +12 KB；额度卡本身（新标记 + 池化网格）替换掉旧卡片渲染后基本持平。

未验证：

- 安装进 OpenChamber 后的右侧栏实际像素外观与真实宿主交互：`serviceRequest` 的 POST 代理、权限批准流程、自动刷新计时。
- 浅色主题下的对比度：只在深色 token 下截图，主题色全部来自 `--oc-*` 变量。
- 其他 magpie 版本的窗口命名与 `pool` 字段是否仍符合「池内分层」规则；规则只认 `(High|Low|Medium)`，并且只作用于有 pool 的窗口。
- 上游 `kept=1` 的语义在其他 magpie 版本下是否一致；本机表现为空列表。

## 许可

MIT。

厂商标识（WorkBuddy、Antigravity、DeepSeek、Kimi、Command Code、opencode、OpenRouter、OpenAI、magpie）来自 [yetone/magpie](https://github.com/yetone/magpie) 的 `internal/gui/assets/icons/`，与 magpie 本身同为 MIT，其中多数出自 lobe-icons。商标与标识归各自所有者，此处仅用于标注额度卡对应的供应商；`generic` 字形是本项目自绘的兜底图形。
