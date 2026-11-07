# 贡献指南

本仓库是 OpenChamber guest 扩展。宿主不编译 TypeScript，只读取已提交的 `panel/main.js` 与 `service/main.js`。如果你有本地检出，运行时契约见 `AGENTS.md`（该文件有意不跟踪）；下面这些公开规则是贡献时必须遵守的部分。

## 范围

本仓库是 OpenChamber guest 扩展：一个沙箱面板加一个本地 Node 服务。改动必须保持面板与服务契约同步。面板只能使用 `host.*`；不能 `fetch`、不能用 XHR、不能碰 `localStorage`、`sessionStorage`、IndexedDB 或 cookie，也不能直连本地服务。它唯一用到的存储是经 `host.storage` 写入的实例作用域首开标记（见[配置文件](#配置文件)）。

## 本地环境

- Bun 1.4 或更高版本。
- OpenChamber 2.5.0 或更高版本。
- 本仓库的检出。没有开发服务器、监听模式或发布脚本。
- Bun 只用于构建已提交的产物：OpenChamber 不编译 TypeScript，安装时只读取磁盘上的 `panel/main.js` 与 `service/main.js`。

```bash
bun install
```

锁文件必须同步。CI 使用 `bun install --frozen-lockfile` 安装。

## 构建

```bash
bun run build          # panel/main.js 与 service/main.js
bun run build:panel    # 只构建面板
bun run build:service  # 只构建服务
bun run typecheck      # tsc --noEmit
```

- `panel/main.js` 是 classic IIFE。沙箱 iframe 不能加载 ESM。
- `service/main.js` 用 `--node` 构建；保留 ESM 与 Node 内置模块。
- 两个产物都要提交。改了源码却没有重建产物，视为未完成。
- 构建脚本不创建输出目录。新增输出目录时，先提交其中的第一个产物，或在构建前手动建目录。
- `bun run build` 只产出上面两个 JS 文件。`panel/index.html` 与 `panel/styles.css` 是静态包文件：`index.html` 链接样式表。它们不是构建产物。没有任何字体资产：样式表没有 `@font-face` 规则。

面板入口是 `src/panel/main.ts`（`connectHost()` 与挂载）。面板实现是 `src/panel/app.ts`（`mountPanel`）。运行时语言包由 `app.ts` 导入，并在构建期内联进 `panel/main.js`。

## 字号（fontScale）

面板使用宿主的字体栈：`--oc-font` 与 `--oc-mono` 来自 OpenChamber 的主题。扩展不携带任何字体、`@font-face` 规则或字体许可文件；`fontScale` 只控制大小，不决定用哪款字体。

`config.jsonc` 接受 `fontScale`：50–200 的整数，默认 100。100 对应 14px 基准；字号按 12px 设计稿编写，因此 100 是旧尺寸的 14/12。根字号为 `14px × fontScale / 100`，面板所有字号均为 rem。

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "fontScale": 100,
  "language": "auto"
}
```

它是面板对 OpenChamber 界面字号设置的手动等价物。宿主不会把该百分比传给 guest 帧：SDK 2.5.1 的 `HostReadyContext` 只带 font、mono 与 radius，`applyHostReady` 给 guest 根写 `0.875rem`，面板随后在每次 `onReady` 后按缩放值覆盖。因此配置卡显示当前百分比，并提示用户把 `fontScale` 设成与 OpenChamber 相同的百分比。

契约：

- 非法值（非整数或越界）回退 100 并置 `fontScaleInvalid`。`GET /config` 回传 `fontScale` 与 `fontScaleInvalid`，面板显示可见提示，端点与 API 密钥不受影响。
- `POST /config/order` 只合并 `cardOrder`，保留 `fontScale`。
- 图表标签与 `fontScale` 无关：30 天 7 个 `MM-DD` 标签，24 小时 6 个 `HH` 标签。
- 覆盖：`tests/config.test.ts`（解析与回退）、`tests/service.test.ts`（`/config` 回报）、`tests/panel-host.test.ts`（重复 ready 后的根字号、无效提示、图表标签的文本、固定数量与 `fontScale` 无关）。

## 配置文件

唯一的配置文件是 `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc`；没有 `XDG_CONFIG_HOME` 时是 `~/.config/openchamber-magpie-usage/config.jsonc`。Windows 使用同一 `~/.config` 布局，例如 `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`。旧的 `config.json` 从不被读取、复制、改名或迁移；两者同时存在时只用 `config.jsonc`。从旧文件名迁移必须手动完成，见 [docs/config-migration.md](docs/config-migration.md)。

文件是 JSONC：

- 允许 `//` 行注释与 `/* */` 块注释；字符串里的 `//` 与 `/*` 不算注释。
- 拒绝尾随逗号。拒绝重复的顶层键（更深层的重复允许）。所有语法错误都会被收集；不检查 `errors` 就绝不信任容错解析器给出的半截值。
- 允许单个前导 UTF-8 BOM，`cardOrder` 编辑会保留它。第二个前导 BOM，或第一个字符之后任何位置出现 BOM，仍按语法错误处理。
- 未知顶层键解析时被忽略，在 `cardOrder` 编辑时逐字节保留。
- 严格 JSON 原样有效，不会被重排格式。保存只替换根级 `cardOrder` 的值，用 `jsonc-parser` 编辑；该数组内部的注释可能丢失，生成的模板对此有说明。

创建与存储：

- 首次打开：文件确实缺失且实例作用域的宿主存储标记 `openchamber-magpie-usage:v1:config-initialized` 不存在时，面板调用一次 `POST /config/create`，拿到完整的双语模板。标记已存在而文件后来被删除时，面板不会重建，配置卡改为显示创建按钮。
- 那个标记是面板唯一存储的东西。没有 `localStorage`、`sessionStorage`、IndexedDB 或 cookie，标记里也绝不放配置、路径、密钥、顺序或折叠状态。标记读写失败时，面板既不自动创建，也不当作首次安装；手动按钮照常可用。
- 文件缺失时重排卡片是明确的例外：它会按当前顺序创建模板。

写入与恢复：

- 同一服务进程内的所有写入跑在同一条 promise 链上。文件保留原权限（读不到时 0600）；服务新建的文件在平台支持时为 0600。
- 只编辑根级 `cardOrder` 的范围。其他字段、未知键、数组之外的注释、缩进与 CRLF/LF 换行逐字节保留。
- 新建是排他的（硬链接，失败时回退到排他 `wx` 打开），期间出现的文件绝不会被覆盖。保存顺序在发布前重读文件，内容已变就返回 409 `config-conflict`；与其他进程的竞态无法被绝对排除。
- 结构损坏的文档（语法错误、重复顶层键、根不是对象）只在保存顺序时重建：完整模板 + 提交的顺序，再把旧原文逐行追加为带双语标记的 `//` 注释。不生成 `.bak`，也不删除旧备份。字段值错误不重建——只改 `cardOrder`。读不到、权限不足或非普通文件的路径绝不被覆盖，也绝不报成功。
- 服务把 `{ at, restored, defaulted, previousText: 'appended-comments' }` 记在内存里直到重启；回报中绝不含旧原文，也绝不含任何由密钥推导出的内容。

覆盖：`tests/config-document.test.ts`（检查、恢复、就地编辑）、`tests/service.test.ts`（`POST /config/create`、`POST /config/order`、`/config` 回报）、`tests/panel-host.test.ts`（卡片外壳与创建流程）。

## 测试

```bash
bun test
bun test tests/quotas.test.ts
bun run check   # 类型检查 -> 全部测试 -> 构建
```

测试全部离线：假网关、临时配置目录，以及测试客户端与 `src/service/server.ts` 服务模块之间的真实 HTTP 往返。面板测试使用 fake host 与 happy-dom；不启动 HTTP server、不连接真实宿主、不读写用户配置目录。套件当前有 280 个通过的测试（13 个文件）。

提交前 `bun run check` 必须通过。CI 还会运行：

```bash
git diff --exit-code -- panel/main.js service/main.js
```

### 测试覆盖

| 文件 | 内容 |
| --- | --- |
| `tests/config.test.ts` | 经 `parseConfigText` 的配置校验：文档级失败（JSON 损坏、根不是对象）、http/https 规则、环回判定、凭据与查询串、密钥字符、刷新区间、未知键；`cardOrder` 宽松解析、顺序键编码、`#2` 后缀、已知/未知/过期键的排序；`language` 默认值、显式值、坏值回退且不降级端点；`fontScale` 默认值、50–200 区间与坏值回退且不降级端点。 |
| `tests/config-document.test.ts` | 严格 JSONC 检查：行/块注释、字符串内的 `//` 与 `/*`、尾随逗号、截断的字符串、空内容、重复顶层键（允许嵌套重复）、根不是对象；单个前导 UTF-8 BOM 被接受且本地 `cardOrder` 编辑保留，第二个/中途 BOM 仍无效；宽松字段错误保留端点而致命错误整体回退；端点/密钥成组的保守恢复、重复字段、无法证明的值、`auto`/`en`/`zh-CN` 语言白名单；只改 `cardOrder` 且保留注释、未知键、缩进与 CRLF；生成的模板本身是合法 JSONC 且只有六个生效键。 |
| `tests/i18n.test.ts` | 注册表合法性、键齐全、占位符一致、CLDR 复数类别（en 的 `one/other`、zh-CN 的 `other`）、插值/回退、`resolveLocale` 的精确匹配与 unsupported 标记；阿拉伯语 `test` 夹具是 RTL 但绝不是运行时匹配。 |
| `tests/format.test.ts` | 数字/成本/积分/百分比/时间格式化，命中率分母为 0，窗口百分比回退链，金额行优先级。 |
| `tests/quotas-view.test.ts` | pool 分组与分层折叠（Antigravity 3 行、9 个分层隐藏）、时长排序、无 pool 窗口共用一行、剩余口径金额行、余额拆分、最紧剩余、图标映射与兜底。 |
| `tests/service.test.ts` | Bearer 校验、`/health` 契约、`/config` 回报（路径、端点、不含密钥的 `apiKeyConfigured`、`fontScale`/`fontScaleInvalid`、`validity`、`recovery`、旧 `config.json` 被忽略、BOM 前缀文件保留端点/密钥）、改文件即时生效、方法与路径组合 405/404；`POST /config/create`（双语六字段模板、空体、显式顺序、已有文件原样保留、坏体、拒绝非普通路径）；`POST /config/order`（只改 `cardOrder`、保留未知键与权限、保留 BOM 与数组外注释、缺失时新建、原地重建且无 `.bak`、BOM 文件重建保留 BOM 并注释去 BOM 的旧正文、字段错误不重建、拒绝坏体与超大体积、并发写入、401）。 |
| `tests/usage.test.ts` | 周期与密钥转发、缺省周期、非法周期、缺失字段不产生 NaN、401/403/500/超时/连不上/非 JSON/结构不符。 |
| `tests/quotas.test.ts` | 全部卡片变体、`kept`/`refresh` 转发、节流、空缓存回退、跨源重定向拒绝、同源重定向跟随。 |
| `tests/secret.test.ts` | 密钥不出现在 `/config`、日志、构建产物；源码无密钥字面量。 |
| `tests/panel-bundle.test.ts` | 面板是 classic IIFE、无 fetch/XHR、不用 `localStorage`/`sessionStorage`/IndexedDB/cookie 且只用宿主实例存储保存首开标记（绝不存配置、路径、密钥、顺序或折叠状态）、只用 `--oc-*`、控件不在 `onReady` 内挂载且只挂一次、图标以 data URI 内联、两列网格与容器查询存在。 |
| `tests/panel-host.test.ts` | 用 fake host 挂载面板：首屏 `/config`、usage、`kept=1` 请求与 KPI/额度卡；`HostRequestError` 各 code、服务错误词汇表、非 JSON 与响应形状错误且不回显上游原文；周期切换只重拉 usage；手动刷新带 `refresh=1`；throttled/stale 文案；键盘排序写入 `/config/order`、写失败显示 `order not saved`、展开/折叠；重复 `onReady` 不重复挂载、`serviceStatus` 四种徽章；`language` 与宿主 locale 的选择、回退与 `languageInvalid`；阿拉伯语回退英文且 `dir=ltr`；重复 ready 后的根字号；无效 `fontScale` 提示；图表标签：MM-DD 与 HH 文本、固定数量、各标签所在格，以及与 `fontScale` 无关；配置卡外壳（页脚前最后一张、默认收起、卡头状态只看文件有效性、重新挂载后复位、路径复制按钮的成功与失败反馈、恢复细节在卡体）；配置创建（首开只创建一次并记住、已有文件绝不覆盖、存储失败既不自动创建也不挡住手动按钮、确认/取消流程只发意图与顺序、创建失败可重试、标记写入失败绝不回滚文件）。 |
| `tests/health.test.ts` | 面板与服务共用的 `/health` 契约。 |
| `tests/manifest.test.ts` | 清单路径、必需构建产物与包元数据。 |
| `tests/harness.ts`、`tests/fixtures.ts` | 假网关与抓取载荷夹具；支撑文件，不是测试套件。 |

## 验证

本记录支撑 README 的行为与截图说明。2026-11-01 验证；该记录早于 `fontScale`、语言回退改动与 `config.jsonc` 切换。套件当前有 280 个通过的测试（13 个文件），`bun run check` 仍是门禁。下面的哈希与字节数属于那次 2026-11-01 的构建，已不能描述当前产物——产物后来为 JSONC 改动重建过：

- `bun run check` 全绿：类型检查、12 个文件共 211 个测试（0 失败、1,783 次断言）、两次构建。
- 连续两次构建字节一致。SHA-256：
  - `panel/main.js`：`EC65B475AE7FAFBD90C639B64EBB2FBCD22C7EA1B9CD1C6DFAF2FD9EEFB4DA81`（110,454 字节）
  - `service/main.js`：`A0535553EF5DE80055BC668721EB1AE9A8C47697E3B403CCFCABF6E8E50C6E95`（28,078 字节）
- 检查后运行 `git diff --exit-code -- panel/main.js service/main.js`，退出码 0。
- 截图：`docs/images/` 共 24 张，覆盖全部 8 个功能组。用量（今天/7 天/30 天）、7 天趋势、额度卡、余额卡、配置/语言均与 magpie 桌面端并排。账户邮箱、API key 片段、绝对配置路径已用实心色块覆盖或裁出画面。
- 真实网关：12 张卡全部渲染，无脚本错误。Antigravity 折成 3 个 pool 行（Claude & GPT、Gemini、Gemini 4 Argon），9 个 `(High)/(Low)/(Medium)` 分层全部隐藏；窗口按 5 小时 → 7 天排序。
- 自定义 OpenAI 兼容端点的余额串拆成 14 行标签/数值；单段余额 `¥21.08` 整体显示；`unlimited`、4 张余额卡与 2 张错误卡行为正确；所有金额行无 `NaN`。
- 容器查询：卡宽约 340px 时 `grid-template-columns` 为 `154px 154px`；240px 时降为单列 `220px`。
- 拖拽第一张卡到第三位：`config.json` 写入 `cardOrder`，`baseUrl` 原样保留，重新打开面板顺序不变；键盘 `End` 移动生效，`aria-live` 播报「moved to position 12 of 12」。
- 手工把 `config.json` 写成非法 JSON 后再拖一张卡：原文逐字复制到 `config.json.bak`，文件被重写为只含 `cardOrder` 的合法 JSON（2 空格缩进、结尾换行），配置卡显示 `config.json was invalid; saved as … and reset`。这一条记录的是 JSONC 之前的行为：当前代码会在原地重建 `config.jsonc`，把旧原文以 `//` 注释追加在同一个文件末尾，不生成 `.bak`，且该路径只有自动化测试覆盖。
- 让写盘失败（配置路径被目录占用）：面板保留新顺序，配额标题旁出现 `order not saved`，提示里带服务给出的原因。

未验证：

- `docs/images/` 里的大部分截图拍摄于 `fontScale`（旧 12px 设计尺寸）与 0.3.1 之前。Command Code 额度卡对、排序对与折叠列表已在 0.4.0 上重拍；其余功能组仍需重拍。
- Electron 右侧栏外壳与权限批准对话框：截图使用真实安装的扩展在 OpenChamber 界面中运行，但宿主窗口外壳被裁掉。
- 完整 `--oc-*` 主题矩阵：截图中的面板是浅色主题；深色宿主主题未逐一对比。
- 其他 magpie 版本的窗口命名与 `pool` 字段：折叠规则只认 `(High|Low|Medium)`，且只作用于有 pool 的窗口。
- 上游 `kept=1` 在其他 magpie 版本下的语义；本机返回空列表。
- 没有针对当前构建做过真实宿主安装：JSONC 文件、默认收起的配置卡、首开自动创建、复制路径按钮、409 `config-conflict` 路径与原地重建，都只由自动化测试（`tests/config-document.test.ts`、`tests/service.test.ts`、`tests/panel-host.test.ts`，配合 fake host、happy-dom 与本地真实 HTTP）覆盖。当前构建没有做过右侧栏像素检查。
- `docs/images/` 里的截图同样早于 `config.jsonc` 与默认收起的配置卡。
- 跨进程写入竞态：写入在单个服务进程内串行，发布前会重读文件，但另一个进程在这次读取与 `rename` 之间写入的情况无法由测试套件排除。

## 调试

没有开发服务器。实际循环是：构建，把目录作为本地扩展安装，打开面板，读配置卡与服务状态徽章。配置卡显示配置路径、文件有效性、生效端点、是否配置密钥、刷新间隔、当前 `fontScale` 百分比、配置问题，以及重建后的恢复详情（哪些字段被恢复、哪些回退默认）。错误卡显示服务给出的类别、状态码与端点。

常用检查：

- `bun test tests/service.test.ts` 检查服务契约。
- `bun test tests/panel-host.test.ts` 检查面板到宿主的桥接。
- `GET /health` 返回 `{ ok, name, apiVersion }`。服务只绑 `127.0.0.1`，要求 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。如果必须探测运行中的服务，使用环境里的宿主 token；不要把 token 粘进 issue、日志或提交。
- `GET /config` 回报 `configPath`、`baseUrl`、`host`、`loopback`、`language`、`languageInvalid`、`cardOrder`、`cardOrderInvalid`、`fontScale`、`fontScaleInvalid`、`refreshSeconds`、`recovery`、`source`、`present`、`validity`、`issue`、`issues`，以及 `apiKeyConfigured`（布尔值，绝不是密钥）。写路由是 `POST /config/create` 与 `POST /config/order`；其他方法/路径组合一律 405 或 404。
- 上游网关是环回地址时可直接探测：`GET http://127.0.0.1:3425/v1/magpie/usage?period=today` 与 `GET http://127.0.0.1:3425/v1/magpie/quotas`。

服务每个请求都重读 `config.jsonc`，改好文件即可生效，不用重启。语言改动在下一轮面板刷新（默认 60 秒）生效。服务不记录 token；不要破坏这一点。

## 安装、版本、CI

在 OpenChamber 的 **Settings → Extensions** 里用文件夹、ZIP 或 Git URL 安装。宿主更新时会整体替换 Git 安装的包目录，所以用户设置必须放在包外。部署就是同一次安装：没有单独的 deploy、publish 或发布脚本。

版本流程：

1. 修改 `package.json` 的 `version`。
2. 运行 `bun run build`。面板导入了 `package.json`，显示的版本跟随构建。
3. 运行 `bun run check`。
4. 提交 `package.json`、`panel/main.js` 与 `service/main.js`。

仓库里没有发布脚本或部署步骤。CI（`.github/workflows/ci.yml`）在推送到 `main` 和拉取请求时运行：

```text
bun install --frozen-lockfile
bun run check
git diff --exit-code -- panel/main.js service/main.js
```

清单是 `package.json` 的 `openchamber` 字段；`panel.id`、`panel.entry`、`service.entry` 由宿主解析。`engines.openchamber` 为 `>=2.5.0`；`@openchamber/sdk` 固定在 `2.5.1`。两者一起升级。

## 截图

截图放在 `docs/images/`，两篇 README 用相对路径与 alt 文本嵌入。

规则：

- 只用本机的真实截图。不要用示意图、mockup、旧图或无关截图。
- 覆盖 8 组：安装入口、用量汇总、趋势、额度卡（套餐卡与折叠列表）、余额卡、错误卡、排序、配置与语言。
- Magpie 桌面端有同一界面时，必须两应用并排：同一功能，尽量同一周期/供应商。确实没有对应界面时，只截 OpenChamber，并在图注说明。
- 裁到相关面板、卡片或设置页。不要带无关项目、会话、终端或桌面。
- 邮箱、账户 ID、API key 片段、本机绝对路径等个人信息用不可逆的实心色块或像素化去掉。不要用可逆效果或假占位。
- 排序的静态图可以只展示可见拖拽手柄与最终顺序，不必捕捉拖动瞬间。
- 文件名为 `<feature>-<app>.png`，`app` 为 `openchamber` 或 `magpie`；需要时加 `-collapsed`、`-english` 等状态后缀。
- 按 GitHub 正文宽度缩放：成对图片每张约 420px，单张约 860px。保证文字可读。
- 每张图都要有描述性 alt 文本，写明应用、界面、周期与状态。
- 脱敏后按 100% 检查；只要还能看见密钥的一个字符，就视为失败。

## 翻译

面板的用户可见文案来自 `panel/locales/`。面板源码里不得硬编码 UI 文案。

### 布局

| 路径 | 用途 |
| --- | --- |
| `panel/locales/index.json` | 注册表：`code`、本地名称 `name` 与文本方向 `dir`。 |
| `panel/locales/en.json` | 英文包，也是所有缺失键的回退。 |
| `panel/locales/zh-CN.json` | 简体中文包。 |
| `src/i18n/messages.ts` | 插值、复数选择、回退链。 |
| `src/i18n/locale.ts` | 注册表解析、locale 解析、语言包加载。 |
| `src/panel/app.ts` | 导入所有语言包并持有当前 translator。 |
| `tests/i18n.test.ts` | 注册表、键、占位符、复数与解析测试。 |

### 构建期内联

面板打包给沙箱 iframe，bundle 测试禁止 `fetch` 与 `XMLHttpRequest`。因此每个运行时语言文件都在构建时导入：

```ts
import en from '../../panel/locales/en.json';
import localeIndex from '../../panel/locales/index.json';
import zhCN from '../../panel/locales/zh-CN.json';
```

只导入 `en` 与 `zh-CN`。`panel/locales/ar.json` 在注册表里标了 `"test": true`，有意不导入：`src/panel/app.ts` 的 `localeCodes()` 会把 `test` 条目从运行时注册表里过滤掉，测试夹具因此永远不会进入 `MESSAGES` 或产物。夹具仍通过 `tests/i18n.test.ts` 参与键、复数与方向检查。

新增语言是数据改动，**加上 `src/panel/app.ts` 里的 import 与一个 map 条目**，然后重建 `panel/main.js`。它不是 Web 应用那种运行时投放。注册表仍是 `code`/`name`/`dir` 的唯一列表；不在 map 里的 code 无法解析。标了 `test: true` 的条目是例外：永远不加 import，也不加 map 条目。

### 键

键是扁平的、点分隔的，例如 `panel.subtitle` 或 `quota.remaining`。没有嵌套。

占位符写成 `{name}`，由 `vars` 参数填充。没有值的占位符保持原样。

每个包必须与 `en.json` 含有完全相同的非复数键。多余键、缺失键、占位符集合不一致都会让 `bun test` 失败。

### 复数

复数文案使用 `key.one`、`key.other`，以及该语言需要的其他 CLDR 类别。`Intl.PluralRules` 是唯一判据。查找顺序是 `key`、`key.<category>`、`key.other`，然后在英文里走同一条链，最后回退到键本身。

| Locale | 类别 |
| --- | --- |
| `en` | `one`、`other` |
| `zh-CN`、`zh-TW`、`ja`、`ko` | `other` |
| `de`、`nl` | `one`、`other` |
| `fr`、`pt-BR`、`es` | `one`、`many`、`other` |
| `pl`、`uk` | `one`、`few`、`many`、`other` |
| `ar` | `zero`、`one`、`two`、`few`、`many`、`other` |

测试在运行时从 `Intl.PluralRules` 读取类别，上表只是方向性参考。

### 新增语言

1. 把 `panel/locales/en.json` 复制为 `panel/locales/<code>.json`，翻译值。键与占位符保持不变。
2. 在 `panel/locales/index.json` 增加一行。
3. 在 `src/panel/app.ts` 导入 JSON，加入 `MESSAGES` map，并把它的 `code` 加入由注册表驱动的解析。这个 map 是唯一知道哪些语言包被打进产物的地方。
4. 运行 `bun install && bun run check`。

测试强制键齐全、复数覆盖、占位符一致与注册表合法。`panel/main.js` 必须重建并提交；CI 检查产物 diff。

### 语言配置

面板没有语言控件。设置放在已安装包之外，因为宿主更新时会替换 Git 安装的包目录：

- `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc`，或
- 没有 `XDG_CONFIG_HOME` 时的 `~/.config/openchamber-magpie-usage/config.jsonc`。Windows 使用同一 `~/.config` 布局，例如 `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`。

文件已经保存 Magpie 端点设置；加上 `language`：

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "language": "auto"
}
```

`language` 为 `auto`、`en` 或 `zh-CN`。大小写敏感，必须等于 `index.json` 中非 `test` 的 `code`；标了 `test` 的条目（如 `ar`）不是运行时语言。`auto` 跟随宿主 locale 的精确匹配（`zh-CN` 显示简体中文）；其他宿主 locale 都显示英文——包括 `ar`，它解析为英文、`dir=ltr`。文字用宿主字体栈渲染，动态数据里显示什么，取决于宿主字体支持什么。

服务每次请求都读文件，并在 `GET /config` 返回 `language` 与 `languageInvalid`。面板每轮刷新（默认 60 秒）读 `/config`，语言改动在下一轮刷新生效，不用重启服务或应用。

| 情况 | 行为 |
| --- | --- |
| `language` 缺失 | `auto`；无提示。 |
| `language` 不是非空字符串 | `auto`；`languageInvalid` 为 true，面板显示带路径的提示。端点与密钥照常生效。 |
| 合法字符串但不是运行时 code（未知，或 `ar` 这类 `test` 夹具） | `auto`；面板显示带路径的 `config.language.unsupported`。 |
| 宿主 locale 为 `ar`（测试夹具） | `auto` 解析为英文、`dir=ltr`；无提示。 |
| 文件缺失 | `auto`；原有的「No config file yet」说明使用宿主语言，卡片同时给出「创建配置文件」按钮。 |
| JSONC 文档非法（语法错误、重复顶层键、根不是对象） | `auto`；原有配置问题说明使用宿主语言。 |
| 服务不可用 | 面板保持英文；服务卡显示原有错误。 |

卸载扩展会留下配置目录。

### 从右到左的布局

`ar` 夹具仍参与 `tests/i18n.test.ts` 的方向检查：键齐全、阿拉伯语的六种 CLDR 复数类别、与英文一致的占位符。`panel/styles.css` 在 `[dir='rtl']` 下会去掉拉丁文案使用的字距（字距会拆开阿拉伯语连写），但当前没有任何运行时语言解析为 `dir="rtl"`。

未覆盖：阿语文案是为测试排版而写，未经母语校对；在只有 `en` 与 `zh-CN` 运行期间，镜像布局无法通过配置触达。原先面板级的阿拉伯语 RTL 测试已被回退测试取代。

## 提交检查

- `bun run check` 通过。
- `git diff --exit-code -- panel/main.js service/main.js` 退出码为 0。
- 新增 UI 文案同时进入 `en.json` 与 `zh-CN.json`（以及其他已注册语言包）。
- 新行为有测试覆盖，没有 skip。
- 截图符合命名、配对、裁切、脱敏与宽度规则。
- tracked 文件里没有密钥、token、邮箱、账户 ID 或本机绝对路径。
- 两篇 README 与两篇 CONTRIBUTING 在命令、路由、限制与行为上一致。

## 许可

提交贡献即表示你同意按本仓库的 MIT 许可授权。
