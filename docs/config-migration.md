# Migrating from `config.json` to `config.jsonc`

[简体中文](#从-configjson-迁移到-configjsonc)

The extension now reads one file only:

```text
$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc
```

Without `XDG_CONFIG_HOME`, that is `~/.config/openchamber-magpie-usage/config.jsonc`. Windows uses the same layout: `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`.

The file extension changed from `.json` to `.jsonc` because the file now accepts comments. Nothing else about your settings moved: the six fields are the same, and the rules for each field are documented in the [Configuration](../README.md#configuration) table.

## What the extension does not do

- It never reads the old `config.json`.
- It never copies it, never renames it, and never migrates it.
- If both files exist, only `config.jsonc` is read. The old file becomes inert; the extension does not delete it either.
- Renaming `config.json` to `config.jsonc` by hand does **not** add the template's bilingual comments. Comments are only written when the extension itself creates a file.
- Content that was already strict JSON is valid at the new path as it stands and is not reformatted. The only edit a save ever makes is to the root `cardOrder` value; everything else — comments, unknown keys, indentation, and line endings — stays byte for byte.

Migration is therefore manual, and it is destructive in one specific sense: **the old endpoint and API key do not apply until you move them yourself.**

## Before you open the new panel

Do this while the old file is still the one you use:

1. Open the old file:

   ```text
   ~/.config/openchamber-magpie-usage/config.json
   ```

2. Create the new file at the same directory with the new name:

   ```text
   ~/.config/openchamber-magpie-usage/config.jsonc
   ```

3. Move or copy these six fields into it:

   | Field | Default if you leave it out |
   | --- | --- |
   | `baseUrl` | `http://127.0.0.1:3425` |
   | `apiKey` | `null` (no key) |
   | `refreshSeconds` | `60` |
   | `fontScale` | `100` |
   | `cardOrder` | `[]` |
   | `language` | `auto` |

4. Delete, rename, or keep the old `config.json` yourself. The extension never touches it.

`apiKey` is the value most at risk: it is the one you are least likely to be able to reconstruct. Move it first.

## If the template was already created

On the first open after install, the panel creates `config.jsonc` with a full bilingual template **when the file is genuinely missing** and it has not already recorded that the file was initialised. That template contains defaults, not your settings. If you find a generated file instead of an empty directory:

1. Open the generated `config.jsonc`.
2. Open the old `config.json` next to it.
3. Paste your valid values over the defaults — `baseUrl` and `apiKey` first, then `refreshSeconds`, `fontScale`, `cardOrder`, and `language`.
4. Save. The service re-reads the file on every request, so the change takes effect without restarting anything.

Nothing is lost by this order: the old file is untouched, and the generated file keeps its comments around the values you replace.

## What happens if you skip all of this

- While no `config.jsonc` exists, the service uses `http://127.0.0.1:3425` with no API key — the documented behaviour for a missing file.
- On the first open the panel then writes a template of defaults there, so you end up on the loopback gateway with no key and your old settings unused. Until a file exists, the Configuration card shows **Not created** and offers a **Create config file** button with a confirm/cancel step.
- Your old `config.json` keeps its contents; it is simply never used again.

## After you migrate

- The old `config.json` is inert. Remove it if you want to avoid confusion; the extension will not do it for you.
- `.bak` and `.bak-<timestamp>` files from older versions are left where they are. Current versions never create a `.bak` file: a structurally damaged `config.jsonc` is rebuilt in place, and the previous text is appended to the same file as `//` comments.
- The new file accepts `//` and `/* */` comments, rejects trailing commas, rejects duplicate top-level keys, and rejects any other syntax error. Unknown top-level keys are ignored by the parser and preserved by a `cardOrder` edit.

---

# 从 `config.json` 迁移到 `config.jsonc`

[English](#migrating-from-configjson-to-configjsonc)

扩展现在只读取一个文件：

```text
$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc
```

没有 `XDG_CONFIG_HOME` 时是 `~/.config/openchamber-magpie-usage/config.jsonc`。Windows 使用同一布局：`%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`。

扩展名从 `.json` 改成 `.jsonc`，是因为文件现在允许写注释。其余设置没有搬家：六个字段完全不变，每个字段的规则见 [配置](../README.zh-CN.md#配置) 的表格。

## 扩展不会做的事

- 不读取旧的 `config.json`。
- 不复制、不重命名、不迁移。
- 两个文件同时存在时只读 `config.jsonc`。旧文件变成死文件，扩展也不会删除它。
- 手工把 `config.json` 改名为 `config.jsonc`，**不会**补上模板里的双语注释。注释只在扩展自己创建文件时写入。
- 原本就是严格 JSON 的内容在新路径上照常有效，也不会被重排格式。保存时唯一会改的是根级 `cardOrder` 的值；其余内容——注释、未知键、缩进、换行符——逐字节保留。

因此迁移必须手动完成，而且在一种特定意义上是破坏性的：**在你自己动手搬之前，旧的端点和 API 密钥不会生效。**

## 在第一次打开新面板之前

趁旧文件还是你在用的那份时完成：

1. 打开旧文件：

   ```text
   ~/.config/openchamber-magpie-usage/config.json
   ```

2. 在同一目录下新建同名新文件：

   ```text
   ~/.config/openchamber-magpie-usage/config.jsonc
   ```

3. 把这六个字段搬过去：

   | 字段 | 缺省时的默认值 |
   | --- | --- |
   | `baseUrl` | `http://127.0.0.1:3425` |
   | `apiKey` | `null`（无密钥） |
   | `refreshSeconds` | `60` |
   | `fontScale` | `100` |
   | `cardOrder` | `[]` |
   | `language` | `auto` |

4. 旧的 `config.json` 由你自己删除、改名或保留，扩展绝不碰它。

`apiKey` 是最容易丢的一项：它也是你最想不起来的值。先搬它。

## 如果模板已经生成了

安装后的第一次打开，只要文件确实缺失、且面板尚未记过「文件已初始化」，就会创建一份带完整双语注释的 `config.jsonc`。那份模板里是默认值，不是你的设置。如果你看到的是已生成的文件而不是空目录：

1. 打开生成的 `config.jsonc`。
2. 打开旁边的旧 `config.json`。
3. 把有效值逐项粘贴覆盖默认值——先 `baseUrl` 与 `apiKey`，再 `refreshSeconds`、`fontScale`、`cardOrder`、`language`。
4. 保存。服务每个请求都会重读文件，不用重启任何东西。

这个顺序不会丢数据：旧文件原封不动，生成的文件会保留你替换值之外的注释。

## 完全不做迁移会怎样

- 只要还没有 `config.jsonc`，服务就使用 `http://127.0.0.1:3425` 且不带 API 密钥——这就是「文件缺失」的既定行为。
- 首次打开时面板会在那里写入一份默认值模板，最终结果是一样的：走环回网关、没有密钥、你的旧设置全部作废。在文件存在之前，配置卡显示 **未创建**，并给出带确认/取消步骤的「创建配置文件」按钮。
- 旧 `config.json` 的内容原样保留，只是从此不再被使用。

## 迁移完成之后

- 旧 `config.json` 已失效。想避免混淆可以自己删掉，扩展不会代劳。
- 旧版本留下的 `.bak` 与 `.bak-<时间戳>` 文件保持原位。当前版本不会再创建 `.bak`：结构损坏的 `config.jsonc` 会在原地重建，旧原文以 `//` 注释的形式追加在同一个文件末尾。
- 新文件允许 `//` 与 `/* */` 注释，拒绝尾随逗号、拒绝重复的顶层键，也拒绝其他任何语法错误。未知的顶层键解析时被忽略，`cardOrder` 编辑时逐字节保留。
