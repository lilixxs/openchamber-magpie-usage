# 贡献指南

本仓库是 OpenChamber guest 扩展。宿主不编译 TypeScript，只读取已提交的 `panel/main.js` 与 `service/main.js`。如果你有本地检出，运行时契约见 `AGENTS.md`（该文件有意不跟踪）；下面这些公开规则是贡献时必须遵守的部分。

## 范围

本仓库是 OpenChamber guest 扩展：一个沙箱面板加一个本地 Node 服务。改动必须保持面板与服务契约同步。面板只能使用 `host.*`；不能 `fetch`、不能用 XHR、不能读写浏览器存储，也不能直连本地服务。

## 本地环境

- Bun 1.4 或更高版本。
- OpenChamber 2.5.0 或更高版本。
- 本仓库的检出。没有开发服务器、监听模式或发布脚本。

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
- `bun run build` 只产出上面两个 JS 文件。`panel/index.html`、`panel/styles.css` 与 `panel/fonts/*` 是静态包文件：`index.html` 链接样式表，样式表的六条 `@font-face` 指向 `./fonts/*.woff2`。它们不是构建产物。

面板入口是 `src/panel/main.ts`（`connectHost()` 与挂载）。面板实现是 `src/panel/app.ts`（`mountPanel`）。运行时语言包由 `app.ts` 导入，并在构建期内联进 `panel/main.js`。

## 字体

面板在 `panel/fonts/` 内置六个 woff2 字面，由 `panel/styles.css` 中包内相对 URL 的 `@font-face` 声明。没有远程字体 CSS，也没有离开本机的字体请求；没有内置阿拉伯字体，资源合计约 1.05 MB。

| 文件 | 固定来源 | 处理方式 |
| --- | --- | --- |
| `plex-sans-400.woff2`、`plex-sans-600.woff2` | `@ibm/plex-sans` 1.1.0 | 未改动，保留原族名，OFL-1.1。 |
| `plex-mono-400.woff2`、`plex-mono-500.woff2` | `@ibm/plex-mono` 2.5.0 | 未改动，保留原族名，OFL-1.1。 |
| `magpie-sans-sc-400.woff2`、`magpie-sans-sc-600.woff2` | `@ibm/plex-sans-sc` 1.1.0 | 3500 常用汉字 + CJK 标点子集，已改名，OFL-1.1。 |

许可规则（OFL 保留字体名）：IBM Plex 的 OFL 声明了保留字体名 "Plex"。拉丁与等宽文件未改动，保留原名；简体中文字体是修改版，任何 name 记录都不得再带保留名——因此以 **Magpie Sans SC** 发布。字形设计不变，只有字符集与 name 记录不同。`panel/fonts/OFL.txt` 是许可全文，`panel/fonts/NOTICE.md` 记录修改声明，`panel/fonts/manifest.json` 记录固定来源、字节数与 SHA-256 摘要。绝不要把子集改回 IBM Plex 的名字。

重新生成：

```bash
python -m pip install fonttools brotli
python tools/fonts/build.py
```

生成器需要 Python 3.10+ 以及访问 jsdelivr 的网络。它下载上面固定的 npm 版本，用 `tools/fonts/chars-3500.txt`（至少 3500 个不重复字符）对两个 SC 字面做子集化，重写 name 记录，任何改名后的记录若仍含 "plex" 就直接失败，然后重写 `OFL.txt`、`NOTICE.md` 与 `manifest.json` 并强制单文件体积预算。重新生成的 `.woff2` 要与这三个文件一起提交。`tests/fonts.test.ts` 会再次检查字面数量、仅本地 URL、改名族名、体积预算与许可文件。

## 字号（fontScale）

`config.json` 接受 `fontScale`：50–200 的整数，默认 100。100 对应 14px 基准；根字号为 `14px × fontScale / 100`，面板所有字号均为 rem。

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
- 超过 125% 时图表标签抽稀：7 天序列隔天显示，24/30 桶序列每 8 桶显示一个。
- 覆盖：`tests/config.test.ts`（解析与回退）、`tests/service.test.ts`（`/config` 回报）、`tests/panel-host.test.ts`（重复 ready 后的根字号、无效提示、100% 与 150% 的标签密度）。

## 测试

```bash
bun test
bun test tests/quotas.test.ts
bun test tests/fonts.test.ts
bun run check   # 类型检查 -> 全部测试 -> 构建
```

测试全部离线：假网关、临时配置目录，以及测试客户端与构建产物服务之间的真实 HTTP 往返。面板测试使用 fake host 与 happy-dom；不启动 HTTP server、不连接真实宿主、不读写用户配置目录。套件当前有 233 个通过的测试。

提交前 `bun run check` 必须通过。CI 还会运行：

```bash
git diff --exit-code -- panel/main.js service/main.js
```

## 调试

没有开发服务器。实际循环是：构建，把目录作为本地扩展安装，打开面板，读配置卡与服务状态徽章。配置卡显示配置路径、生效端点、是否配置密钥、刷新间隔、当前 `fontScale` 百分比、配置问题与重置备份路径。错误卡显示服务给出的类别、状态码与端点。

常用检查：

- `bun test tests/service.test.ts` 检查服务契约。
- `bun test tests/panel-host.test.ts` 检查面板到宿主的桥接。
- `GET /health` 返回 `{ ok, name, apiVersion }`。服务只绑 `127.0.0.1`，要求 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。如果必须探测运行中的服务，使用环境里的宿主 token；不要把 token 粘进 issue、日志或提交。
- `GET /config` 显示 `language`、`languageInvalid`、`cardOrder`、`fontScale`、`fontScaleInvalid`，以及 `apiKeyConfigured`（布尔值，绝不是密钥）。
- 上游网关是环回地址时可直接探测：`GET http://127.0.0.1:3425/v1/magpie/usage?period=today` 与 `GET http://127.0.0.1:3425/v1/magpie/quotas`。

服务每个请求都重读 `config.json`，改好文件即可生效，不用重启。语言改动在下一轮面板刷新（默认 60 秒）生效。服务不记录 token；不要破坏这一点。

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
- 覆盖 8 组：安装入口、用量汇总、趋势、额度卡（池化与分层折叠）、余额卡、错误卡、排序、配置与语言。
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

- `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json`，或
- 没有 `XDG_CONFIG_HOME` 时的 `~/.config/openchamber-magpie-usage/config.json`。Windows 使用同一 `~/.config` 布局，例如 `%USERPROFILE%\.config\openchamber-magpie-usage\config.json`。

文件已经保存 Magpie 端点设置；加上 `language`：

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "language": "auto"
}
```

`language` 为 `auto`、`en` 或 `zh-CN`。大小写敏感，必须等于 `index.json` 中非 `test` 的 `code`；标了 `test` 的条目（如 `ar`）不是运行时语言。`auto` 跟随宿主 locale 的精确匹配（`zh-CN` 显示简体中文）；其他宿主 locale 都显示英文——包括 `ar`，它解析为英文、`dir=ltr`，使用包内英文字体。没有内置阿拉伯字体，动态数据里的阿拉伯字符回退到系统字体。

服务每次请求都读文件，并在 `GET /config` 返回 `language` 与 `languageInvalid`。面板每轮刷新（默认 60 秒）读 `/config`，语言改动在下一轮刷新生效，不用重启服务或应用。

| 情况 | 行为 |
| --- | --- |
| `language` 缺失 | `auto`；无提示。 |
| `language` 不是非空字符串 | `auto`；`languageInvalid` 为 true，面板显示带路径的提示。端点与密钥照常生效。 |
| 合法字符串但不是运行时 code（未知，或 `ar` 这类 `test` 夹具） | `auto`；面板显示带路径的 `config.language.unsupported`。 |
| 宿主 locale 为 `ar`（测试夹具） | `auto` 解析为英文、`dir=ltr`；无提示。 |
| 文件缺失 | `auto`；原有的「No config file yet」说明使用宿主语言。 |
| JSON 非法 | `auto`；原有配置问题说明使用宿主语言。 |
| 服务不可用 | 面板保持英文；服务卡显示原有错误。 |

卸载扩展会留下配置目录。

## 提交检查

- `bun run check` 通过。
- `git diff --exit-code -- panel/main.js service/main.js` 退出码为 0。
- 内置字体与 `panel/fonts/manifest.json` 一致；`panel/styles.css` 里没有远程字体 URL；修改后的子集仍用 `Magpie Sans SC` 族名，绝不带保留名 `Plex`。
- 新增 UI 文案同时进入 `en.json` 与 `zh-CN.json`（以及其他已注册语言包）。
- 新行为有测试覆盖，没有 skip。
- 截图符合命名、配对、裁切、脱敏与宽度规则。
- tracked 文件里没有密钥、token、邮箱、账户 ID 或本机绝对路径。
- 两篇 README 与两篇 CONTRIBUTING 在命令、路由、限制与行为上一致。

## 许可

提交贡献即表示你同意按本仓库的 MIT 许可授权。
