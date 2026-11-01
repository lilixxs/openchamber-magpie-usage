# openchamber-magpie-usage

[English](README.md) | **简体中文**

OpenChamber 右侧栏扩展，用于查看 [Magpie](https://usemagpie.ai) 的用量汇总、趋势，以及网关返回的全部额度卡与余额卡。

面板从不直接联网。它只调用 `host.serviceRequest()`；扩展自带的本地服务向配置的 Magpie 端点发起只读 GET，把结果规范化后交回面板。

## 目录

- [安装](#安装)
- [面板显示什么](#面板显示什么)
- [配置](#配置)
- [服务接口](#服务接口)
- [边界与安全](#边界与安全)
- [开发](#开发)
- [验证](#验证)
- [许可](#许可)

## 安装

1. 在 OpenChamber 中打开 **Settings → Extensions**。
2. 在 *Folder, ZIP, or URL* 中填入仓库地址，然后选择 **Add**：

   ```text
   https://github.com/lilixxs/openchamber-magpie-usage.git
   ```

3. 批准 **Run a local service**。
4. 点击右侧栏的柱状图图标打开面板。

<img src="docs/images/install-openchamber-extensions.png" alt="OpenChamber 的 Settings → Extensions 页面：添加扩展卡片和已安装的 Magpie Usage 扩展" width="860">

<p><sub>OpenChamber 的 **Settings → Extensions**。已安装扩展显示为 **Magpie Usage**。截图裁到设置对话框，不含项目或会话内容。magpie 桌面端没有扩展安装界面，因此本组只截 OpenChamber。</sub></p>

本地开发时，在同一个对话框里填入本仓库的绝对路径，而不是 Git URL。OpenChamber 不编译 TypeScript：`panel/main.js` 与 `service/main.js` 是构建产物，必须存在于磁盘上。只有构建时才需要 Bun 1.4 或更高版本。

`package.json` 声明 `engines.openchamber` 为 `>=2.5.0`，并把 `@openchamber/sdk` 固定在 `2.5.1`。

## 面板显示什么

所有数字都来自本地服务。页脚写明了口径：这是本机网关记录的、发往该端点的用量，不是该端点的全部用量，也不包含其他客户端直连该端点产生的请求。

### 用量

`today` / `7d` / `30d` 切换上游统计周期。

- **TOKEN**：输入 + 输出。缓存读取单独显示。
- **缓存命中**：`cache_read / (input + cache_read + cache_write)`。分母为 0 时显示 `—`，不会显示 `0%` 或 `NaN`。
- **调用**：包含失败、重试与循环调用。
- **成本（估算）** 与未计价调用数。
- **积分** 与报告了积分的调用数。
- 上游给出的 `since` 统计起点。

<table>
<tr>
<td width="50%"><img src="docs/images/usage-today-openchamber.png" alt="OpenChamber Magpie Usage 面板，今天：8.47M Token、97.1% 缓存命中、1,494 次调用、约 3.24 美元、110.69 积分" width="420"></td>
<td width="50%"><img src="docs/images/usage-today-magpie.png" alt="magpie 桌面端用量页，今天：Token、请求、费用、缓存命中与输出速度卡片" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>，今天。</sub></td>
<td><sub><b>magpie 桌面端</b>，今天。它的 Token 口径包含缓存读取，所以数值更大；面板把缓存读取放在单独的 KPI 里。</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/usage-7d-openchamber.png" alt="OpenChamber Magpie Usage 面板，7 天：43.49M Token、97.2% 缓存命中、7,579 次调用、约 55.44 美元" width="420"></td>
<td width="50%"><img src="docs/images/usage-7d-magpie.png" alt="magpie 桌面端用量页，7 天：Token、请求、费用、缓存命中与输出速度卡片" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>，7 天。</sub></td>
<td><sub><b>magpie 桌面端</b>，7 天。两次读取不是同一时刻，聚合口径也不完全相同。</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/usage-30d-openchamber.png" alt="OpenChamber Magpie Usage 面板，30 天：57.1M Token、96.7% 缓存命中、10,208 次调用、约 87.94 美元" width="420"></td>
<td width="50%"><img src="docs/images/usage-30d-magpie.png" alt="magpie 桌面端用量页，30 天：Token、请求、费用、缓存命中与输出速度卡片" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>，30 天。</sub></td>
<td><sub><b>magpie 桌面端</b>，30 天。</sub></td>
</tr>
</table>

### 趋势

面板按上游 `series` 的每个桶画一根柱。每根柱分为输入（含缓存）与输出。桶太多时标签抽稀到 6 或 5 个，最后一根始终保留标签。

<table>
<tr>
<td width="50%"><img src="docs/images/trend-7d-openchamber.png" alt="OpenChamber 面板 7 天趋势：10 月 26 日到 11 月 1 日逐日输入与输出柱" width="420"></td>
<td width="50%"><img src="docs/images/trend-7d-magpie.png" alt="magpie 桌面端 7 天用量图：按模型堆叠的彩色柱，下方带 53 周热力图" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>，7 天趋势。输入包含缓存。</sub></td>
<td><sub><b>magpie 桌面端</b>，7 天用量图。Magpie 按模型堆叠，并附带热力图；面板保留较精简的两段桶视图。</sub></td>
</tr>
</table>

### 额度卡

额度卡对齐 Magpie 自己的额度页。每张卡的头部包含：

- 厂商标识（同时是拖拽手柄）。
- 卡名、套餐标签、该卡最紧的剩余百分比。
- 点击头部或箭头展开/收起。默认展开前 2 张；展开状态在当前会话内记忆。
- **错误卡始终完整可见，不能折叠。**

窗口按上游 `pool` 分组。一个 pool 一行，行内两列网格。不足两个窗口的 pool 靠左，第三个窗口自动换行。卡片宽度小于 260px 时，容器查询切换为单列。

每个窗口格显示：

- 窗口名与 `N% left`。
- 填到「剩余」的 4px 进度条；剩余 ≤0.5% 时使用 warning 色。
- `剩余 / 上限 单位`，由 `limit − amount` 算出；没有可减的数时原样显示上游 `display`。
- `resets …`、`runs out …` 与 `pool …`。

同一个 pool 内，名字尾段为 `(High)`、`(Low)`、`(Medium)` 的分层模型不单独渲染。若某个 pool 完全没有时长窗口，则保留其中用得最多的一层，避免该 pool 消失。

<table>
<tr>
<td width="50%"><img src="docs/images/quota-antigravity-openchamber.png" alt="OpenChamber Antigravity 额度卡：Claude &amp; GPT、Gemini、Gemini 4 Argon 三个 pool 行；High、Low、Medium 分层已隐藏" width="420"></td>
<td width="50%"><img src="docs/images/quota-antigravity-magpie.png" alt="magpie 桌面端 Antigravity 额度卡：显示全部 Gemini、Claude &amp; GPT、Gemini 4 Argon 层；账户邮箱被实心黑条遮盖" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>：3 个 pool 行，9 个 <code>(High)/(Low)/(Medium)</code> 分层被折叠；每个时长窗口和 pool 标签都保留。</sub></td>
<td><sub><b>magpie 桌面端</b>：同一账户显示全部层。账户邮箱用不可逆的实心黑条遮盖。</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/quota-opencode-go-openchamber.png" alt="OpenChamber OpenCode Go 额度卡：5 小时、7 天、Month 三个窗口，两列" width="420"></td>
<td width="50%"><img src="docs/images/quota-opencode-go-magpie.png" alt="magpie 桌面端 OpenCode Go 额度卡：5 小时、7 天、月度窗口" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>：同样的三个窗口，两列，剩余优先。</sub></td>
<td><sub><b>magpie 桌面端</b>：同一供应商、同样的窗口。Magpie 多一条剩余额度走势；面板为紧凑省略了它。</sub></td>
</tr>
</table>

<img src="docs/images/quota-collapsed-openchamber.png" alt="OpenChamber 额度列表全部折叠：厂商标识、卡名（其中一处已遮盖）、套餐标签、剩余百分比与余额" width="860">

<p><sub>全部卡片折叠。厂商标识仍作为拖拽手柄显示；点箭头可重新展开。其中一处供应商名称已遮盖。错误卡不在这张裁图里，因为它们从不折叠。</sub></p>

### 余额卡

余额卡把上游用 ` · ` 连接的字符串拆成「标签 / 数值」行：标签是最后一个空格前的文字。单段字符串整体显示。缺失的数字显示为 `—`，不会出现 `NaN`。

<table>
<tr>
<td width="50%"><img src="docs/images/balance-deepseek-openchamber.png" alt="OpenChamber DeepSeek 余额卡：21.08 元与读取时间" width="420"></td>
<td width="50%"><img src="docs/images/balance-deepseek-magpie.png" alt="magpie 桌面端 DeepSeek 余额卡：21.08 元、读取时间与剩余额度走势" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>：单段余额，整体显示为 <code>¥21.08</code>。</sub></td>
<td><sub><b>magpie 桌面端</b>：同一供应商、同一余额，附带剩余额度走势。</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/balance-openai-compatible-openchamber.png" alt="OpenChamber 自定义 OpenAI 兼容端点余额卡，供应商名称已遮盖：余额、已用额度、剩余百分比、今日花费、配额模式与请求计数" width="420"></td>
<td width="50%"><img src="docs/images/balance-openai-compatible-magpie.png" alt="magpie 桌面端同一自定义 OpenAI 兼容端点余额卡，供应商名称已遮盖：余额、已用额度、剩余百分比、今日花费、配额模式与请求计数" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>：自定义 OpenAI 兼容端点；供应商名称已遮盖。上游字符串拆成独立的标签/数值行。本次读取为 $26.36。</sub></td>
<td><sub><b>magpie 桌面端</b>：同一端点，数值为 $25.11，供应商名称同样已遮盖。两次读取不是同一时刻；这一对比较的是布局，不是分币级数值。</sub></td>
</tr>
</table>

### 排序

拖动厂商标识，或聚焦标识后按 <kbd>↑</kbd>、<kbd>↓</kbd>、<kbd>Home</kbd>、<kbd>End</kbd>。顺序写入 `config.json` 的 `cardOrder`。写盘失败时，面板保留新顺序，在「配额」标题旁显示 `order not saved`，下次放下时重试。键盘移动通过 `aria-live` 播报。magpie 桌面端没有等价的卡片排序控件；这一组只截 OpenChamber。

<table>
<tr>
<td width="50%"><img src="docs/images/sort-before-openchamber.png" alt="OpenChamber 额度列表排序前：WorkBuddy 第一、OpenCode Go 第二、Command Code 第三" width="420"></td>
<td width="50%"><img src="docs/images/sort-after-openchamber.png" alt="OpenChamber 额度列表排序后：OpenCode Go 第一、Command Code 第二、WorkBuddy 第三" width="420"></td>
</tr>
<tr>
<td><sub><b>排序前</b>：WorkBuddy 第一。每张卡的厂商标识都是可见的拖拽手柄。</sub></td>
<td><sub><b>排序后</b>：用键盘把 WorkBuddy 移到第三。静态图展示手柄与最终顺序，不需要捕捉拖拽瞬间。</sub></td>
</tr>
</table>

### 错误卡

上游失败会生成错误卡，显示服务给出的错误类别、状态码与端点。上游响应体不会透传给面板。

<img src="docs/images/error-cards-openchamber.png" alt="OpenChamber 的 Our Free Model 与 OpenRouter 错误卡，显示错误文案与来源端点" width="860">

<p><sub><code>Our Free Model</code> 与 <code>OpenRouter</code> 各自失败，其余 10 张卡照常渲染。magpie 桌面端没有对应这种传输错误的卡片——它最接近的状态是额度页的「暂时无法获取额度」，那是另一套契约——因此这一组只截 OpenChamber。</sub></p>

### 配置与语言

配置卡显示配置文件路径、生效端点、是否已配置 API 密钥、刷新间隔、配置问题，以及配置损坏被替换后的备份路径。

<table>
<tr>
<td width="50%"><img src="docs/images/config-openchamber.png" alt="OpenChamber 配置卡：文件路径被黑色遮盖、环回端点、API 密钥未配置、每 60 秒刷新" width="420"></td>
<td width="50%"><img src="docs/images/config-magpie.png" alt="magpie 桌面端设置·常规：语言菜单展开，包含跟随系统、English、简体中文、繁體中文" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>：绝对路径用不可逆黑条遮盖。语言不是面板控件，而是从 <code>config.json</code> 读取。</sub></td>
<td><sub><b>magpie 桌面端</b>：它自己的语言控件。扩展与 Magpie 采用同一思路，但各自保存设置。</sub></td>
</tr>
</table>

面板提供英文与简体中文。把 `config.json` 的 `language` 设为 `en` 或 `zh-CN`；`auto` 跟随宿主语言，只有精确命中 `zh-CN` 才显示中文。下一轮刷新会重读 `/config`，不用重启服务或 OpenChamber。

<img src="docs/images/config-english-openchamber.png" alt="OpenChamber 配置卡在 language 设为 en 后显示英文；绝对文件路径被涂黑" width="860">

<p><sub>设置 <code>language: "en"</code> 后，同一张卡显示英文。路径已遮盖。未知值或非字符串会回退 <code>auto</code> 并提示，不会禁用端点或密钥。</sub></p>

## 配置

唯一的配置来源：

```text
$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json
```

没有 `XDG_CONFIG_HOME` 时用 `~/.config/openchamber-magpie-usage/config.json`。Windows 使用同一布局：`%USERPROFILE%\.config\openchamber-magpie-usage\config.json`。

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "apiKey": "可选；非环回端点通常需要",
  "refreshSeconds": 60,
  "cardOrder": ["r-magpie%2Fworkbuddy|subscription|example-user"],
  "language": "auto"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `baseUrl` | 否 | 绝对 http(s) URL。不得带账号密码、查询串或片段。非环回主机必须用 https。允许带路径前缀。 |
| `apiKey` | 否 | 非空字符串，不含空白与控制字符。只以 `Authorization: Bearer` 发送，绝不放进 URL。 |
| `refreshSeconds` | 否 | 整数 5–3600，默认 60。 |
| `cardOrder` | 否 | 字符串数组，最多 500 项，每项 1–200 字符。宽松解析：值不是数组、含非字符串项、项超长或超量时只丢坏的部分，其余配置照常生效。顺序只影响外观，绝不会让端点降级。 |
| `language` | 否 | `auto`（默认）、`en` 或 `zh-CN`。大小写敏感，必须等于 `panel/locales/index.json` 的 `code`。非字符串或空串回退 `auto` 并提示；端点与密钥照常生效。 |

行为：

- 文件不存在：回退到 `http://127.0.0.1:3425`，不带密钥。
- 文件存在但不可用（JSON 错、字段越界、http 指向远端等）：同样回退到默认端点，并在配置卡显示原因。面板不会因此空白。
- 服务每个请求都重读文件。保存即生效，不用重启服务或应用。
- `apiKey` 可以缺失或为 `null`，两者都表示「未配置」。其他非字符串值不合法；空字符串也不是合法密钥。
- `cardOrder` 的键为 `encodeURIComponent(provider)|encodeURIComponent(kind)|encodeURIComponent(user)`。同一三元组的第二、第三张卡追加 `#2`、`#3`。网关已不存在的键会被忽略；新增卡片按网关顺序排在末尾。
- 写文件统一 2 空格缩进 + 结尾换行，保留未知顶层键，沿用原文件权限（读不到时 0600），先写临时文件再 `rename` 覆盖。
- 写顺序时若文件不是合法 JSON 对象：先把原文复制为 `config.json.bak`（已存在则 `config.json.bak-<UTC 时间戳>`），再写入只含 `cardOrder` 的合法文件，配置卡保留提示。文件缺失时新建，并移除「No config file yet」提示。

密钥只进入服务进程。面板只拿到布尔值 `apiKeyConfigured`；没有密钥输入框，不回显，不写入任何存储、日志、URL 或构建产物。

## 服务接口

服务只监听 `127.0.0.1:<host 分配的端口>`。每个请求都必须带 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。只接受 `GET`，以及写顺序用的 `POST /config/order`；其余方法/路径组合一律 405 / 404。

| 路径 | 作用 |
| --- | --- |
| `GET /health` | 原有契约 `{ ok, name, apiVersion }`，未改动。 |
| `GET /config` | 配置路径、生效端点、`apiKeyConfigured`、刷新间隔、`cardOrder`、`reset`（配置被替换后的 `{ at, backupPath }`，否则 `null`）、`language`、`languageInvalid` 与配置问题。 |
| `POST /config/order` | 体 `{ "order": string[] }`；200 `{ ok: true, order, reset }`。体上限 64 KiB；1–500 个字符串、每个 1–200 字符；其余一律 400 `bad-request`。 |
| `GET /v1/magpie/usage?period=today\|7d\|30d` | 规范化后的用量汇总。 |
| `GET /v1/magpie/quotas?kept=1` | 优先读上游缓存。 |
| `GET /v1/magpie/quotas?refresh=1` | 请求新读数；30 秒内重复请求被节流。 |

写顺序的细节：

- 同一进程内所有写入串成一条 promise 链，两个面板不会交错读-改-写。
- 读文件 → 合并 `cardOrder` → 写 `<path>.<pid>.<rand>.tmp` → 按原文件权限 `chmod` 临时文件（读不到时 0600）→ `rename` 覆盖。
- 文件不是合法 JSON **对象**时：先备份原文（`.bak`，已存在则 `.bak-<UTC 时间戳>`），再写入 `{ "cardOrder": [...] }`，并把 `{ at, backupPath }` 记在内存里供 `/config` 回报。服务重启后提示清空。
- 文件缺失时直接新建；`present` 变为 `true`，面板的「No config file yet」随之消失。

刷新策略：

- 周期自动刷新：用量直接取汇总；额度先请求上游 `?kept=1`。
- 手动刷新：额度请求上游不带 `kept` 的新读数，并以 30 秒窗口节流；窗口内的重复点击返回上一次读数并标记 `throttled`。
- 本机实测：Magpie `0.1.2470` 对 `GET /v1/magpie/quotas?kept=1` 返回空 `data` 数组，而普通请求返回 12 张卡。因此 `kept=1` 返回 0 张卡时，服务回退到最近一次成功读数并标记 `stale`；此前没有读数时做一次普通读取。否则每次自动刷新都会把额度卡清空。

错误映射（HTTP 502/504，逐类区分，绝不与网络错误混同）：

```text
upstream-unauthorized (401)
upstream-forbidden (403)
upstream-status (其他状态码)
upstream-timeout (504)
upstream-network (连不上)
upstream-not-json
upstream-schema (结构不符)
upstream-redirect (跨源重定向被拒)
```

重定向策略：`redirect: "manual"`。只跟随同源重定向（最多 3 次）；任何跨源重定向直接拒绝，密钥不会被带到其他源。

上游错误体不会回传给面板，只回传类别、状态码与端点，避免上游把密钥或内部信息写进响应。

## 边界与安全

- 面板运行在沙箱 iframe，只加载 classic IIFE 的 `panel/main.js`。它不能 `fetch`、不能用 XHR、不能读写浏览器存储，也不能直接拨号到本地服务。顺序保存同样走 `host.serviceRequest`，面板自身不发任何网络请求。
- 面板颜色只用宿主注入的 `--oc-*` 变量；样式表内没有硬编码的浅色或深色值。
- 宿主控件（徽标、刷新按钮）在模块加载时挂载一次；`onReady` 再次触发时只更新值。
- 本地服务以当前用户权限运行，只绑 `127.0.0.1`，每个请求校验 Bearer。token 不记录。
- 密钥只属于服务进程。它不得出现在面板、产物、日志、URL 或提交中。

## 开发

需要 Bun 1.4 或更高版本。

```bash
bun install
bun run check      # 类型检查 -> 测试 -> 构建
bun run build      # 只构建 panel/main.js 和 service/main.js
bun test           # 全部测试
bun test tests/quotas.test.ts
bun run typecheck
```

OpenChamber 不编译 TypeScript。`panel/main.js` 与 `service/main.js` 是提交的构建产物。入口链为 `src/panel/main.ts`（`connectHost()` 与挂载）→ `src/panel/app.ts`（`mountPanel`）→ `panel/main.js`；服务入口为 `src/service/main.ts` → `service/main.js`。

语言包由 `src/panel/app.ts` 静态导入，并在构建期内联进 `panel/main.js`（面板禁止 `fetch`）。新增语言因此要改 JSON、import 与 `MESSAGES` 映射，然后重建。

CI 运行 `bun install --frozen-lockfile`、`bun run check` 和 `git diff --exit-code -- panel/main.js service/main.js`。改源码不重建 bundle 会失败。完整流程、截图约定与翻译规则见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

### 测试覆盖

`bun test` 全部离线：假网关、临时配置目录，以及测试客户端与构建产物服务之间的真实 HTTP 往返。面板测试用 fake host 与 happy-dom，不启动 HTTP server、不连真实宿主、不读写用户配置目录。

| 文件 | 内容 |
| --- | --- |
| `tests/config.test.ts` | 配置校验：JSON 形状、http/https 规则、环回判定、凭据与查询串、密钥字符、刷新区间、未知键；`cardOrder` 宽松解析、顺序键编码、`#2` 后缀、已知/未知/过期键的排序；`language` 默认值、显式值、坏值回退且不降级端点。 |
| `tests/i18n.test.ts` | 注册表合法性、键齐全、占位符一致、CLDR 复数类别（en 的 `one/other`、zh-CN 的 `other`）、插值/回退、`resolveLocale` 的精确匹配与 unsupported 标记。 |
| `tests/format.test.ts` | 数字/成本/积分/百分比/时间格式化，命中率分母为 0，窗口百分比回退链，金额行优先级。 |
| `tests/quotas-view.test.ts` | pool 分组与分层折叠（Antigravity 3 行、9 个分层隐藏）、时长排序、无 pool 窗口共用一行、剩余口径金额行、余额拆分、最紧剩余、图标映射与兜底。 |
| `tests/service.test.ts` | Bearer 校验、`/health` 契约、`/config` 三条路径、改文件即时生效、方法与路径组合 405/404；`POST /config/order` 的写入、保留未知键与权限、缺失时新建、非法文件备份+重置+回报、拒绝坏体与超大体积、并发写入、401。 |
| `tests/usage.test.ts` | 周期与密钥转发、缺省周期、非法周期、缺失字段不产生 NaN、401/403/500/超时/连不上/非 JSON/结构不符。 |
| `tests/quotas.test.ts` | 全部卡片变体、`kept`/`refresh` 转发、节流、空缓存回退、跨源重定向拒绝、同源重定向跟随。 |
| `tests/secret.test.ts` | 密钥不出现在 `/config`、日志、构建产物；源码无密钥字面量。 |
| `tests/panel-bundle.test.ts` | 面板是 classic IIFE、无 fetch/XHR、无存储、只用 `--oc-*`、控件不在 `onReady` 内挂载且只挂一次、图标以 data URI 内联、两列网格与容器查询存在。 |
| `tests/panel-host.test.ts` | 用 fake host 挂载面板：首屏 `/config`、usage、`kept=1` 请求与 KPI/额度卡；`HostRequestError` 各 code、服务错误词汇表、非 JSON 与响应形状错误且不回显上游原文；周期切换只重拉 usage；手动刷新带 `refresh=1`；throttled/stale 文案；键盘排序写入 `/config/order`、写失败显示 `order not saved`、展开/折叠；重复 `onReady` 不重复挂载、`serviceStatus` 四种徽章；`language` 与宿主 locale 的选择、回退与 `languageInvalid`。 |
| `tests/health.test.ts` | 面板与服务共用的 `/health` 契约。 |
| `tests/manifest.test.ts` | 清单路径、必需构建产物与包元数据。 |
| `tests/harness.ts`、`tests/fixtures.ts` | 假网关与抓取载荷夹具；支撑文件，不是测试套件。 |

## 验证

2026-11-01 验证：

- `bun run check` 全绿：类型检查、12 个文件共 211 个测试（0 失败、1,783 次断言）、两次构建。
- 连续两次构建字节一致。SHA-256：
  - `panel/main.js`：`EC65B475AE7FAFBD90C639B64EBB2FBCD22C7EA1B9CD1C6DFAF2FD9EEFB4DA81`（110,454 字节）
  - `service/main.js`：`A0535553EF5DE80055BC668721EB1AE9A8C47697E3B403CCFCABF6E8E50C6E95`（28,078 字节）
- 检查后运行 `git diff --exit-code -- panel/main.js service/main.js`，退出码 0。
- 截图：`docs/images/` 共 24 张，覆盖全部 8 个功能组。用量（今天/7 天/30 天）、7 天趋势、池化额度卡、余额卡、配置/语言均与 magpie 桌面端并排。账户邮箱、API key 片段、绝对配置路径已用实心色块覆盖或裁出画面。
- 真实网关：12 张卡全部渲染，无脚本错误。Antigravity 折成 3 个 pool 行（Claude & GPT、Gemini、Gemini 4 Argon），9 个 `(High)/(Low)/(Medium)` 分层全部隐藏；窗口按 5 小时 → 7 天排序。
- 自定义 OpenAI 兼容端点的余额串拆成 14 行标签/数值；单段余额 `¥21.08` 整体显示；`unlimited`、4 张余额卡与 2 张错误卡行为正确；所有金额行无 `NaN`。
- 容器查询：卡宽约 340px 时 `grid-template-columns` 为 `154px 154px`；240px 时降为单列 `220px`。
- 拖拽第一张卡到第三位：`config.json` 写入 `cardOrder`，`baseUrl` 原样保留，重新打开面板顺序不变；键盘 `End` 移动生效，`aria-live` 播报「moved to position 12 of 12」。
- 手工把 `config.json` 写成非法 JSON 后再拖一张卡：原文逐字复制到 `config.json.bak`，文件被重写为只含 `cardOrder` 的合法 JSON（2 空格缩进、结尾换行），配置卡显示 `config.json was invalid; saved as … and reset`。
- 让写盘失败（配置路径被目录占用）：面板保留新顺序，配额标题旁出现 `order not saved`，提示里带服务给出的原因。

未验证：

- Electron 右侧栏外壳与权限批准对话框：截图使用真实安装的扩展在 OpenChamber 界面中运行，但宿主窗口外壳被裁掉。
- 完整 `--oc-*` 主题矩阵：截图中的面板是浅色主题；深色宿主主题未逐一对比。
- 其他 magpie 版本的窗口命名与 `pool` 字段：折叠规则只认 `(High|Low|Medium)`，且只作用于有 pool 的窗口。
- 上游 `kept=1` 在其他 magpie 版本下的语义；本机返回空列表。

### 从右到左的布局

`panel/locales/ar.json` 是夹具，不是提供给用户的语言。它存在只为让 RTL 路径持续被覆盖：词条齐全（键、阿拉伯语的六种 CLDR 复数类别、与英文一致的占位符），并在注册表里标了 `"test": true`。

在配置文件里写 `"language": "ar"` 并重开面板。`src/panel/app.ts` 把注册表的 `dir` 写到 `<html dir>`，布局随之镜像；`panel/styles.css` 在 `[dir='rtl']` 下去掉拉丁文案使用的字距，因为字距会拆开阿拉伯语连写。

未覆盖：阿语文案是为测试排版而写，未经母语校对；夹具覆盖的是面板，不包括宿主自己的窗口外壳。

## 许可

MIT。见 [LICENSE](LICENSE)。

厂商标识（WorkBuddy、Antigravity、DeepSeek、Kimi、Command Code、opencode、OpenRouter、OpenAI、magpie）来自 [yetone/magpie](https://github.com/yetone/magpie) 的 `internal/gui/assets/icons/`，与 magpie 本身同为 MIT，其中多数出自 lobe-icons。商标与标识归各自所有者，此处仅用于标注额度卡对应的供应商；`generic` 字形是本项目自绘的兜底图形。
