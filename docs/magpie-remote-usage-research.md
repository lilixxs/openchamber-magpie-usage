# magpie「Remote magpie」用量数据调查报告

> 调查日期：2026-11-01（Asia/Shanghai）
> 对象：本机 magpie 网关（`127.0.0.1:3425`，版本 `0.1.2470`）与上游源码 `github.com/yetone/magpie`（浅克隆 HEAD `36af588`，2026-11-01 12:01 +08:00）
> 方式：读取运行中的 HTTP 接口、读取本机 magpie 配置、读取上游前端源码。未修改任何配置，未写入用量日志。
> 置信度：接口与源码结论为“高”；界面外观结论来自随包 CSS/HTML 源码，未截图，为“中高”。

---

## 0. 结论

1. 代码与配置中不存在字符串 `magpie-remote`。实际对象有三个名字：预设 id `remote-magpie`、本机供应商 id `r-magpie`、显示名 `Remote magpie`。
2. 用量数据不由远端推送。本机 magpie 在每次请求经过本地网关时写 `usage.jsonl`，把供应商记为 `r-magpie`、主机记为远端域名、模型记为远端返回的 `provider/model`。
3. 用量接口有两个入口，返回同一份 JSON：
   - 网关：`GET /v1/magpie/usage`（只支持 `period`）与 `GET /v1/magpie/usage/requests`（支持完整筛选与分页）。
   - 界面本地服务：`GET /api/usage`（支持 `period` 与 `tz`）与 `GET /api/usage/requests`。
4. 额度卡单独取数。本机向远端的 `GET /v1/magpie/quotas/cards` 发请求，用供应商的网关密钥鉴权，然后把卡片 id 改写为 `r-magpie/<远端 provider>`，名称追加 ` · Remote magpie`。
5. 界面计算集中在三处：总览 KPI 与占比条（`plugins/usage/page.js`）、请求页表格与图表（同文件）、额度卡的百分比与节奏（`app.js`）。所有百分比都按“已用/总量”计算，再用“Used / Left”开关翻转显示。

---

## 1. 调查对象

| 项目 | 值 | 证据 |
|---|---|---|
| 进程 | `magpie-windows-amd64.exe`，PID 30316 | `Get-Process` |
| 监听 | `127.0.0.1:3425` | `Get-NetTCPConnection` |
| 版本 | `0.1.2470` | `GET /` 返回 `"version":"0.1.2470"` |
| 根响应 | `{"name":"magpie","serves":"app",...,"models":70}` | `GET http://127.0.0.1:3425/` |
| 源码 | `github.com/yetone/magpie` | 浅克隆到临时目录 |
| 前端 | Wails 内嵌 `internal/gui/assets`（`app.js` 1.31 MB、`app.css` 386 KB、`plugins/usage/page.js` 206 KB） | 二进制内含 Wails 与上述资源字符串 |

`GET /` 公布的接口清单包含：

```
/v1/magpie/quotas
/v1/magpie/quotas/history
/v1/magpie/usage
/v1/magpie/usage/requests
/v1/magpie/route
/v1/magpie/trace
/v1/magpie/mcp
```

源码另注册两条远端卡片接口：`/v1/magpie/quotas/cards`、`/v1/magpie/quotas/refresh`。

---

## 2. 命名澄清

| 名称 | 位置 | 含义 |
|---|---|---|
| `remote-magpie` | `provider.RemoteMagpiePreset`（`internal/provider/remote_magpie.go:68`） | 预设类型 id。添加“另一个 magpie”时使用。 |
| `r-magpie` | 本机 `~/.config/magpie/providers.json` 的 `id` | 用户自定义的供应商 id。所有用量行以此值写入 `provider` 字段。 |
| `Remote magpie` | 同一文件的 `name` | 显示名。用量页与请求页显示此名。 |
| `magpie` | 同一文件的 `icon` | 图标名，前端用内置图标集渲染。 |

`providers.json` 中该条目的关键字段（密钥已省略）：

```json
{
  "id": "r-magpie",
  "name": "Remote magpie",
  "icon": "magpie",
  "preset": "remote-magpie",
  "chat": "https://magpie.lilixxs.top/v1",
  "responses": "https://magpie.lilixxs.top/v1",
  "anthropic": "https://magpie.lilixxs.top",
  "proxy": "direct",
  "models": ["opencode-go/deepseek-v4.1-flash", "..."]
}
```

`models` 的每一项都是 `远端 provider/远端 model` 形式。请求时完整模型引用是 `r-magpie/<远端 provider>/<远端 model>`。

---

## 3. 数据来源与落盘

### 3.1 用量日志

- 路径：`~/.config/magpie/usage.jsonl`。接口返回的 `path` 字段为 `~\.config\magpie\usage.jsonl`。
- 写入时机：请求经过本地网关并完成后。
- 记录范围：
  - 经本地网关转发的请求；
  - magpie 读取各 agent 会话文件后补充的用量；
  - 客户端通过 `POST /v1/magpie/usage/requests` 主动上报的请求。
- `r-magpie` 行的事实（实测，2026-11-01 12:09 +08:00）：

```json
{
  "t": "2026-11-01T12:09:11+08:00",
  "agent": "opencode",
  "provider": "r-magpie",
  "host": "magpie.lilixxs.top",
  "providerKeyId": "8b09bbc402",
  "model": "opencode-go/deepseek-v4.1-flash",
  "req": "r-magpie/opencode-go/deepseek-v4.1-flash",
  "served": "deepseek-v4.1-flash",
  "in": 1468, "out": 589, "cache_read": 67840, "cache_write": 0, "reasoning": 248,
  "ms": 3801, "ttft_ms": 1612, "flow_ms": 2185,
  "status": 200, "ep": "/v1/chat/completions",
  "session": "ses_...",
  "cost": 0.000777, "priced": true,
  "providerName": "Remote magpie",
  "access": "api"
}
```

字段含义：

| 字段 | 含义 |
|---|---|
| `provider` | 本机供应商 id，即 `r-magpie`。 |
| `host` | 请求实际发往的主机。远端供应商行固定为远端域名。 |
| `model` | 请求时使用的模型名，远端模型带远端 provider 前缀。 |
| `req` | 完整请求引用，`<本机 provider>/<model>`。 |
| `served` | 上游实际服务的模型名。远端已剥掉 provider 前缀。 |
| `access` | `api`（有密钥）或 `subscription`（订阅账号）。 |

### 3.2 额度与历史

| 文件 | 用途 |
|---|---|
| `quotas.json` | 各账号最近一次读取的额度快照。 |
| `quota-history.json` | 额度窗口的历史读数，用于曲线。 |
| `credits-daily.json` | 按天汇总的 credits。 |
| `balance-history.json` | 余额历史。 |

远端卡片不落远端日志。本机只缓存远端返回的卡片（`remoteCardCache`），并按 `remoteCardsFor` 周期重读。

---

## 4. HTTP API

### 4.1 网关接口（端口 3425）

| 方法与路径 | 作用 | 参数 | 备注 |
|---|---|---|---|
| `GET /v1/magpie/usage` | 某周期的用量汇总 | `period` | 只接受 `period`；不读 `tz`，不读筛选。 |
| `GET /v1/magpie/usage/requests` | 请求明细，一页 | `period`、`offset`、`limit`、`day`、`route`、`model`、`agent`、`provider`、`purpose`、`account`、`callerKey`、`failed`、`retried`、`q`、`computer`、`via` | `limit` 默认 100，上限 500。 |
| `POST /v1/magpie/usage/requests` | 客户端上报请求 | 请求体为请求记录 | 不计入网关密钥限额。 |
| `GET /v1/magpie/quotas` | 额度快照 | `kept=1` 读缓存 | 远端卡片合并进同一响应。 |
| `GET /v1/magpie/quotas/history` | 额度历史 | `days`、`provider`、`user` | 返回每个窗口的读数序列。 |
| `GET /v1/magpie/quotas/cards` | 本机缓存的所有卡片 | 无 | 供另一个 magpie 读取。 |
| `POST /v1/magpie/quotas/refresh` | 让本机重读卡片 | `provider`、`user` | 仅供另一个 magpie 调用。 |

`period` 取值：

- 预设：`today`、`7d`、`30d`、`all`；
- 日期区间：`2026-10-01..2026-10-07`；
- 其他值按 `30d` 处理。

### 4.2 界面本地服务（同进程，`/api/...`）

| 方法与路径 | 作用 |
|---|---|
| `GET /api/usage` | 同 `GET /v1/magpie/usage`，另接受 `tz`（浏览器 IANA 时区）。 |
| `GET /api/usage/requests` | 同网关明细，另接受 `tz`。 |
| `GET /api/usage/heatmap` | 最近 53 周的热力图，按当前筛选。 |
| `GET /api/usage/requests/content` | 打开一行时，从 agent 会话文件读原文。 |
| `GET /api/usage/requests.csv` | 当前筛选结果导出 CSV。 |
| `POST /api/usage/requests/export` | 把全部页写入 Downloads 目录。 |
| `POST /api/usage/clear` | 清空某模型或全部用量的统计。 |
| `POST /api/usage/deleted` | 合并、拆分或重命名已删除供应商。 |

### 4.3 权限

- 本机回环地址：直接放行。
- 其他机器：需要满足两项，否则返回 403：
  1. 本机开启“局域网共享”；
  2. 请求带网关密钥（`Authorization: Bearer <key>` 或 `x-api-key`）。
- 受限额、限定模型或限定账号的密钥：汇总接口返回 403；明细接口只返回该密钥自己的行。
- 远端 magpie 读取本机卡片时使用同一套密钥校验。

### 4.4 返回结构

#### 汇总（`/v1/magpie/usage`）

顶层字段：

```
period, since,
calls, errors, retried, loops,
input, output, cache_read, cache_write, cache_write_1h,
cache_unknown, cache_unknown_calls, reasoning,
cost, unpriced, credits, credited,
timed, ttft_ms, decode_ms, decode_out, decode_n,
floor_out, floor_ms, floor_n,
bucket, series,
agents, models, providerKeys, accounts, callerKeys, sessions, sessionCount,
path
```

分组对象（`agents`、`models`、`providerKeys`、`accounts`、`callerKeys`、`sessions`）共用 `usage.Group` 字段，并加三个显示字段：

| 字段 | 含义 |
|---|---|
| `id` | 分组键。 |
| `name` | 显示名。模型组为模型名。 |
| `sub` | 模型组为供应商名；供应商 id 曾指向多个主机时追加 ` · <host>`。 |
| `icon` | 图标名。远端模型为 `magpie`。 |
| `provider` / `model` / `host` | 模型组的来源信息。 |
| `providerKeyId` / `providerKeyName` | 网关密钥组。 |
| `account` | 订阅账号组。 |
| `callerKeyId` / `callerKeyName` | 调用方密钥组。 |
| `own` | magpie 自身发起的调用（路由分类、搜索、图像描述）的调用数、token、成本。 |

#### 明细页（`/v1/magpie/usage/requests`）

顶层字段：

```
callerKeys, period, rows, offset, total, bucket, series,
by, chartBy,
calls, errors, retried, input, output, cache_read, cache_write, reasoning,
cost, unpriced, credits, credited, timed, ttft_ms, decode_ms, decode_out, decode_n,
through, direct, reported,
agents, providers, purposes, accounts, computers
```

`by` 的维度固定为 `provider`、`agent`、`model`、`modelAt`、`callerKey`。每项是 `Share`：

```
id, calls, errors, retried, input, output, cache_read, cache_write, reasoning,
cost, unpriced, credits, credited, timed, ttft_ms, decode_ms, decode_out, decode_n,
name, icon
```

`through` 是经本地网关的请求，`direct` 是只从会话文件读到的请求，`reported` 是客户端上报的请求。顶层总数是三者之和。

#### 明细行

```
route_id, t, agent, provider, host, providerKeyId,
model, req, served,
in, out, cache_read, cache_write, reasoning,
ms, ttft_ms, first_reasoning_ms, sent_ms, own_ms, flow_ms,
status, response_id, ep, stop, session, native_session,
cost, priced,
agentName, icon, providerName, access
```

注意：明细行用 `in` / `out`，汇总用 `input` / `output`。

### 4.5 实测结果

`GET /v1/magpie/usage?period=7d`（2026-11-01 12:05 +08:00）：

| 字段 | 值 |
|---|---|
| `period` | `7d` |
| `since` | `2026-10-26T00:00:00+08:00` |
| `calls` | 6274 |
| `cost` | 53.2038（USD） |
| `credits` | 1326.22 |
| `providerKeys` | 4 组 |

`r-magpie#8b09bbc402` 一组：

| 字段 | 值 |
|---|---|
| `calls` | 3124 |
| `errors` | 50 |
| `input` | 16,184,969 |
| `output` | 2,622,360 |
| `cache_read` | 607,959,073 |
| `cost` | 14.6789 |
| `credits` | 517.04 |

`GET /v1/magpie/usage/requests?period=7d&provider=r-magpie&limit=1` 返回 `total=3370`。两个数字不同，原因见 8.1。

---

## 5. 服务端计算

### 5.1 总量

`Totals.addFrom`（`internal/usage/usage.go:778-805`）逐条累加：

- `Input`、`Output`、`CacheRead`、`CacheWrite`、`CacheWrite1h`、`Reasoning`：直接相加。
- `Calls`：每条请求加一。被转交给下一次尝试的行不计。
- `Errors`：失败请求数。
- `Retried`：第一次失败、重试后成功的请求数。
- `Timed`：有首 token 时间且未失败的请求数。
- `TTFT`：上述请求的首 token 毫秒数之和。
- `DecodeMs`、`DecodeOut`、`DecodeN`：可测量解码窗口的请求的耗时、输出 token、条数。
- `Cost`：有价格的请求按价格计算。
- `Unpriced`：有 token 但没有已知价格的请求数。

### 5.2 成本

```
CostAt(price) = price.In(r.Time).CostSplit(input, output, cache_read, cache_write, cache_write_1h)
```

- 客户端上报并自带成本的行，直接使用自带值（`OwnCost`）。
- 价格来源顺序（`internal/provider/models.go` 的 `tariffOf`）：
  1. 用户在 magpie 里为该模型设定的价格；
  2. 该供应商的目录价；
  3. 模型厂商的目录价。
- 再乘供应商的 `priceRate`，以及按时间生效的费率窗口。
- 远端模型的 id 自带上游前缀，因此按上游模型定价；这就是 `r-magpie` 行仍有非零成本的原因。
- 查不到价格的请求计入 `unpriced`，不按 0 计。

### 5.3 Credits

- 只统计厂商在响应中回报的 credits。
- `Credited` 是回报了 credits 的请求数。
- `Credits` 是其总和。
- 前端显示时四舍五入到两位；小于 0.01 显示 `<0.01`。

### 5.4 速度

- 平均首 token：`ttft_ms / timed`。
- 解码速度：`decode_out / (decode_ms / 1000)`。
- 解码窗口的成立条件（`DecodeWindow`）：
  - 输出 token 大于 0；
  - 首 token 时间大于 0；
  - 窗口不短于 100 ms；
  - 速度不超过 10,000 token/s。
- 推理请求只统计答案部分。首个正文时间缺失时，不计速度。
- 内容在窗口末段一次性到达（held burst）时，不计速度。

### 5.5 缓存命中率

```
hit = cache_read / (input + cache_read + cache_write - cache_unknown)
```

- `cache_unknown` 是厂商不统计缓存的请求的提示 token。
- 分母不大于 0 时，不显示命中率。

### 5.6 分组与排序

`summary_fold.go:226-299`：

| 分组 | 键 | 说明 |
|---|---|---|
| Agents | agent id | 客户端名。 |
| Models | `provider/model`，必要时追加 ` @ host` | 同一供应商 id 去过多个主机时按主机拆分。 |
| ProviderKeys | `provider#providerKeyId` | 只有存在网关密钥的供应商才出现。 |
| Accounts | `provider@account` | 只有出现订阅账号的供应商才出现。 |
| CallerKeys | 调用方密钥 id | 空 id 不出现。 |
| Sessions | `agent|session` | 默认只返回前 100 个（`usageapi.PageSessions`）。 |

排序：token 总数降序，其次请求数降序，最后 id 升序。

---

## 6. 前端计算

前端源码位置：

- 总览与请求页：`internal/gui/assets/plugins/usage/page.js`
- 额度卡：`internal/gui/assets/app.js`
- 样式：`internal/gui/assets/app.css`

### 6.1 总览 KPI

`renderUsage`（`page.js:522-734`）：

| 指标 | 公式 |
|---|---|
| Tokens | `input + output`，可选用 `+ cache_read + cache_write`。开关存 `localStorage["magpie.usageWithCache"]`。 |
| Cache read | 直接显示 `cache_read`；副行显示命中率与 `cache_write`。 |
| Reasoning | 直接显示 `reasoning`；标注“inside output”。 |
| Calls | 显示 `calls`；副行拼接失败数、重试成功数、无价数。 |
| 成本 | 头部显示 `≈` 加格式化成本；有 `unpriced` 时另显示“N calls unpriced”。 |

### 6.2 时间线

- 柱高以周期内最大值归一化：

```
peak = max(1, max(series.map(tokens)))
inputHeight%  = 100 * (tokens(p) - output) / peak
outputHeight% = 100 * output / peak
```

- 有缓存 token 时，缓存计入输入部分。
- 标签密度：`n<=8` 每根显示；`n<=31` 每 6 根显示一根；更长每 5 根显示一根。最后一根总显示。

### 6.3 列表与占比条

- 占比按 token 计算：

```
total = max(1, tokens(总计))
width = max(1.5, 100 * tokens(g) / total)   // 百分比字符串
percent = round(100 * tokens(g) / total)
```

- 行内显示：图标、名称、副行（供应商、调用数、失败数、循环数、重试数、TTFT、速度）、占比条、token 数（in/out/cached/命中率）、成本。
- 模型行的 `sub` 即后端返回的 `sub`。远端模型的 `sub` 为 `Remote magpie`；同一 id 去过多个主机时追加 ` · <host>`。

### 6.4 请求页

- 筛选器：Purpose、Computer、Agent、Provider、Model、Account、Gateway keys、状态（All/Failed/Retried）。
- 顶部三段或四段计数：全部请求、经 magpie、不经 magpie、客户端上报。每段可点击筛选。
- 行内模型列显示 `providerName`，有 `host` 时追加 ` · host`。远端行显示 `Remote magpie · magpie.lilixxs.top`。
- 趋势图与热力图使用同一份筛选结果。

### 6.5 额度卡

开关：`quotaLeft`。本机设置为“Left”。

百分比（`app.js:14121-14135`）：

```
used = clamp(w.used, 0, 100)
fill = quotaLeft ? 100 - round(used) : round(used)
text = quotaLeft ? "N left" : "N used"
```

注意舍入顺序：进度条先取整再相减，文字使用未取整值保留一位小数。两者可能相差 1 个百分点。

数量（`quotaCount`）：

```
n = quotaLeft ? max(0, limit - amount) : max(0, amount)
显示 "n / limit unit"
```

节奏（`quotaPace`）：

```
d = used - 100 * (now - startsAt) / (resetsAt - startsAt)
显示 d 或 -d（Left 模式）
```

正数标记为 `over`，使用 `--amber` 色。`startsAt` 或 `resetsAt` 缺失时不显示。

重置与到期：

- 重置：`Resets <时刻>` 加 `in Nm/Nh/Nd`。
- 到期：厂商给出 `runsOutAt` 与 `runsOut` 时显示“N credits expire <时刻>”。

### 6.6 远端额度卡

`internal/provider/remote_quotas.go:210-249`：

- 取数：`GET <远端>/v1/magpie/quotas/cards`，带该供应商的网关密钥。
- 改写：
  - `provider` 改为 `r-magpie/<远端 provider>`；
  - `name` 追加 ` · Remote magpie`；
  - `from` 设为 `Remote magpie`；
  - `icon` 设为 `magpie`；
  - 清空 `resets`、`checkins`。
- 实测：

```json
{
  "provider": "r-magpie/workbuddy",
  "name": "WorkBuddy · Remote magpie",
  "from": "Remote magpie",
  "kind": "subscription",
  "plan": "Free plan",
  "windows": [{
    "name": "Credits",
    "used": 19.31,
    "remaining": 80.69,
    "display": "997.5 / 5165",
    "amount": 997.5,
    "limit": 5165,
    "unit": "credits",
    "resetsAt": "2026-11-30T15:59:59Z",
    "runsOutAt": "2026-11-16T04:00:14Z"
  }]
}
```

- 远端读取失败时，本机保留上次卡片，并在卡片上显示错误原因。
- 远端不共享额度时，返回一张错误卡；本机把错误文案翻成“那台电脑的 magpie 还没有共享额度”。

### 6.7 成本格式

`usage.FormatCost`（`internal/usage/usage.go:716-729`）：

| 金额（USD） | 显示 |
|---|---|
| ≥ 100 | 整数 |
| ≥ 1 | 两位小数 |
| < 1 | 三位小数 |

- 货币为 `cny` 且汇率有效时，乘汇率并改用 `¥`。
- 页面统一加 `≈`，表示估算。
- 图表轴用另一套精度（`ledMoney`）：≥10 取整，≥1 一位，其余两位。

---

## 7. 界面样式

### 7.1 主题变量

`app.css:2-70`。默认跟随系统；`data-theme="dark"` 与 `data-theme="light"` 可强制。

| 变量 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--bg` | `#f4f4f6` | `#1a1a1e` | 页面底色 |
| `--card` | `#ffffff` | `#232327` | 卡片 |
| `--card-2` | `#f9f9fb` | `#1f1f23` | 展开区 |
| `--pill` | `#f1f1f4` | `#2d2d33` | 胶囊、进度槽 |
| `--line` | `#e3e3e8` | `#333339` | 边框 |
| `--line-2` | `#ececf0` | `#2c2c32` | 次级分隔 |
| `--fg` | `#1c1c21` | `#ededf1` | 主文字 |
| `--fg-2` | `#4b4b53` | `#b9b9c1` | 次文字 |
| `--muted` | `#85858d` | `#8b8b94` | 说明文字 |
| `--faint` | `#b9b9c2` | `#56565f` | 最弱文字 |
| `--accent` | `#4f46e5` | `#a5b4fc` | 主色（进度条、柱） |
| `--accent-soft` | `#eeedfd` | `#2b2c47` | 主色浅底 |
| `--green` | `#189a58` | `#6fd99b` | 成本 |
| `--red` | `#d64545` | `#f28b82` | 错误 |
| `--amber` | `#b45309` | `#f2b544` | 超额、警告 |

另有 `data-colorblind="1"` 模式。该模式给各数据系列加虚线样式，避免只靠颜色区分。

### 7.2 组件尺寸

| 组件 | 规则 | 来源 |
|---|---|---|
| KPI 区 | 四列网格，1px 间隙，间隙底色为 `--line`，外框 12px 圆角 | `app.css:1200` |
| KPI 单元 | 内边距 12/14/11，数字 20px/600，标签 11px 大写、字距 .05em | `app.css:1203-1208` |
| 图表卡 | 12px 圆角，1px 边框，柱区高 72px，柱间距 3px | `app.css:1216-1223` |
| 图表柱 | 主色填充；输入部分透明度 .38；悬停显示 `--pill` 底 | `app.css:1220-1222` |
| 统计行 | 高 40px，左内边距 11px；名称列固定 180px | `app.css:621, 1227` |
| 占比条 | 高 4px，圆角 2px，主色透明度 .7 | `app.css:1229-1230` |
| 数值列 | 右对齐，最小宽 64px，等宽数字 | `app.css:1231-1233` |
| 成本列 | 右对齐，最小宽 58px，绿色，12px | `app.css:1234` |
| 额度卡 | 内边距 10/12/11，1px 边框，10px 圆角 | `app.css:919` |
| 卡片头 | 图标 17px，标题 12.5px/600 | `app.css:920-922` |
| 额度标签 | 10.5px，`--muted`；数值用 `--fg-2`、600、等宽数字 | `app.css:965-967` |
| 额度进度条 | 高 4px，圆角 2px，`--accent` 填充；用尽时 `--amber` | `app.css:995-996, 1118` |
| 重置行 | 10px，`--faint`，等宽数字 | `app.css:981` |
| 请求表 | 11.5px，等宽数字 | `app.css:1490` |

### 7.3 字体

| 场景 | 字体栈 |
|---|---|
| 默认 | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif` |
| Windows 覆盖 | `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui` |
| 等宽 | `ui-monospace, "SF Mono", Menlo, Consolas, monospace`；Windows 为 `"Cascadia Mono", Consolas, ...` |

字号以 px 写死。界面“文字大小”设置不改变 CSS 字号，而是对页面整体缩放（`applyZoom`）。本机设置为 110%。

### 7.4 响应式

- 浏览器版把 KPI 区改为两列（`body.web .stats`，`app.css:4024`）。
- 六列 KPI 在容器宽度 960px、420px 时分别降为三列、两列（容器查询，`app.css:1631-1632`）。
- 图表标签在窄屏隐藏放不下的日期，保留最后一根。

---

## 8. 已知边界与未验证项

### 8.1 `providerKeys` 与 `provider` 筛选的计数不同

- `providerKeys` 只统计带 `providerKeyId` 的行。
- `provider` 筛选统计该供应商的全部行。
- 实测 7 天：3124 对 3370。
- 做对账时不能用两者互证。

### 8.2 网关汇总没有时区与筛选

- `GET /v1/magpie/usage` 只接受 `period`。
- 日界与小时桶按本机时区。
- 需要读者时区时，只能读界面接口 `/api/usage?tz=`。

### 8.3 远端用量不回流

- 本机只统计经本机网关发往远端的请求。
- 远端为其他客户端完成的请求不在本机 `usage.jsonl` 中。
- 因此本机看到的“Remote magpie 用量”是“本机经远端消耗的用量”，不是远端的全部用量。

### 8.4 成本是估算

- 依赖本地目录价与用户设置。
- 无价格时只计入 `unpriced`，不摊到其他请求。
- 远端模型按上游模型定价，可能与远端实际计费不同。

### 8.5 界面外观未截图验证

- 样式结论来自随包源码。
- 运行中的窗口是 Wails WebView，未截图。
- 公网入口 `https://magpie.lilixxs.top/` 被 Tinyauth 拦截，未进入。
- 若需逐像素核对，应在本机打开 Usage 页截图，再对照本报告第 7 节。

### 8.6 未展开的部分

- 托盘面板与菜单栏的紧凑用量（`internal/gui/trayusage.go`）未逐项分析。
- 会话页（Sessions）的统计口径未展开。
- 路由组（Routing）的用量分摊未展开。

---

## 9. 证据索引

| 主题 | 位置 |
|---|---|
| 用量接口注册 | `internal/gateway/gateway.go:851-856` |
| 接口清单 | `internal/gateway/gateway.go:970` |
| 汇总处理器 | `internal/gateway/usage_api.go:51-64` |
| 明细处理器 | `internal/gateway/usage_api.go:66-82` |
| 上报处理器 | `internal/gateway/usage_ingest.go:90` |
| 汇总结构 | `internal/usageapi/usageapi.go:57-64` |
| 显示名与图标 | `internal/usageapi/usageapi.go:101-132` |
| 筛选参数 | `internal/usageapi/usageapi.go:220-230` |
| 明细分页 | `internal/usageapi/usageapi.go:328-459` |
| 总量字段 | `internal/usage/usage.go:509-559` |
| 速度与解码窗口 | `internal/usage/usage.go:562-617, 654-678` |
| 成本格式 | `internal/usage/usage.go:716-729` |
| 命中率 | `internal/usage/usage.go:766-772` |
| 累加规则 | `internal/usage/usage.go:778-833` |
| 分组规则 | `internal/usage/summary_fold.go:226-299` |
| 分页上限 | `internal/usage/request_page.go:825-830` |
| 定价 | `internal/usage/ledger.go:535`、`internal/provider/models.go` |
| 远端卡片 | `internal/provider/remote_quotas.go:33-38, 178-256` |
| 界面接口 | `internal/gui/usage.go:100-245` |
| 总览渲染 | `internal/gui/assets/plugins/usage/page.js:522-734` |
| 请求页渲染 | `internal/gui/assets/plugins/usage/page.js:2082-2302` |
| 额度百分比 | `internal/gui/assets/app.js:14112-14173` |
| 额度卡渲染 | `internal/gui/assets/app.js:15722-15888, 18391-18513` |
| 主题变量 | `internal/gui/assets/app.css:2-70` |
| KPI 与图表 | `internal/gui/assets/app.css:1200-1234` |
| 额度卡样式 | `internal/gui/assets/app.css:919-996, 1118` |
