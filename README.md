# openchamber-magpie-usage

**English** | [简体中文](README.zh-CN.md)

An OpenChamber right-sidebar extension for [Magpie](https://usemagpie.ai): usage totals, trends, and every quota and balance card the gateway reports.

The panel never fetches application data itself. It calls `host.serviceRequest()`; the extension's local service performs read-only GETs against the configured Magpie endpoint and normalises the payload for the panel. The one external load the browser makes for the panel is the approved interface-font file from jsDelivr (see [Typography](#typography)).

## Contents

- [Install](#install)
- [What the panel shows](#what-the-panel-shows)
- [Configuration](#configuration)
- [Service API](#service-api)
- [Boundaries and security](#boundaries-and-security)
- [Contributing](#contributing)
- [License](#license)

## Install

1. In OpenChamber, open **Settings → Extensions**.
2. Put the repository URL in *Folder, ZIP, or URL* and choose **Add**:

   ```text
   https://github.com/lilixxs/openchamber-magpie-usage.git
   ```

3. Approve **Run a local service**.
4. Open the panel from the bar-chart icon in the right sidebar.

<img src="docs/images/install-openchamber-extensions.png" alt="OpenChamber Settings, Extensions: Add extension card and the installed Magpie Usage extension" width="860">

<p><sub>OpenChamber **Settings → Extensions**. The installed extension is listed as **Magpie Usage**. The screenshot is cropped to the settings dialog; no project or session content is included. Magpie desktop has no extension-installer screen, so this group is OpenChamber-only.</sub></p>

Installing a local checkout works the same way: choose the folder instead of the Git URL. OpenChamber does not compile TypeScript, so the committed `panel/main.js` and `service/main.js` must exist on disk. Building them, running the tests, and cutting a release are covered in [CONTRIBUTING.md](CONTRIBUTING.md).

`package.json` declares `engines.openchamber` `>=2.5.0` and pins `@openchamber/sdk` `2.5.1`.

## What the panel shows

All numbers come from the local service. The footer states the scope: this is usage recorded by the local gateway for requests sent to this endpoint, not the endpoint's total usage. It does not include requests other clients send directly to the endpoint.

### Usage

The `today` / `7d` / `30d` switch changes the upstream period.

- **TOKEN**: input + output. Cache reads are reported separately.
- **Cache hit**: `cache_read / (input + cache_read + cache_write)`. The row shows `—` when the denominator is 0; it never shows `0%` or `NaN`.
- **Calls**: includes failures, retries, and looped calls.
- **Cost (est.)** and the number of unpriced calls.
- **Credits** and the number of calls that reported them.
- The `since` timestamp supplied by the gateway.

<table>
<tr>
<td width="50%"><img src="docs/images/usage-today-openchamber.png" alt="OpenChamber Magpie Usage panel, Today: 8.47M tokens, 97.1% cache hit, 1,494 calls, about 3.24 USD, 110.69 credits" width="420"></td>
<td width="50%"><img src="docs/images/usage-today-magpie.png" alt="Magpie desktop usage page, Today: token, request, cost, cache hit, and output speed cards" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>, Today.</sub></td>
<td><sub><b>magpie desktop</b>, Today. Its Token KPI includes cache reads, so it is larger; the panel keeps cache reads in a separate KPI.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/usage-7d-openchamber.png" alt="OpenChamber Magpie Usage panel, 7 days: 43.49M tokens, 97.2% cache hit, 7,579 calls, about 55.44 USD" width="420"></td>
<td width="50%"><img src="docs/images/usage-7d-magpie.png" alt="Magpie desktop usage page, 7 days: token, request, cost, cache hit, and output speed cards" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>, 7 days.</sub></td>
<td><sub><b>magpie desktop</b>, 7 days. The two reads are not simultaneous; the aggregation rules are not identical.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/usage-30d-openchamber.png" alt="OpenChamber Magpie Usage panel, 30 days: 57.1M tokens, 96.7% cache hit, 10,208 calls, about 87.94 USD" width="420"></td>
<td width="50%"><img src="docs/images/usage-30d-magpie.png" alt="Magpie desktop usage page, 30 days: token, request, cost, cache hit, and output speed cards" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>, 30 days.</sub></td>
<td><sub><b>magpie desktop</b>, 30 days.</sub></td>
</tr>
</table>

### Trend

The panel draws one bar per upstream `series` bucket. Each bar is split into input (including cache) and output. Each bar has a label cell beneath it. The chart shows a fixed number of labels: seven for the 30-day period (`MM-DD`, from each bucket's date) and six for the 24-hour period (`HH`, the hour). The first label is aligned to the first bar's left edge, the last to the last bar's right edge, and the rest are centred under their bars. Labels are horizontal and do not depend on `fontScale`. Wrapping of labels that would crowd each other is not implemented yet, so at a large `fontScale` the gap between two labels can shrink below two characters.

<table>
<tr>
<td width="50%"><img src="docs/images/trend-7d-openchamber.png" alt="OpenChamber panel 7-day trend: input and output bars per day from October 26 to November 1" width="420"></td>
<td width="50%"><img src="docs/images/trend-7d-magpie.png" alt="Magpie desktop 7-day usage chart with stacked model colours and a weekly heat map below" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>, 7-day trend. Input includes cache.</sub></td>
<td><sub><b>magpie desktop</b>, 7-day usage chart. Magpie stacks by model and adds a 53-week heat map; the panel keeps the two-series bucket view.</sub></td>
</tr>
</table>

### Quota cards

Quota cards follow Magpie's own quota page. Each card has a header row:

- The provider mark is the drag handle.
- Card name, plan label, and the tightest remaining percentage.
- Click the header or the chevron to expand or collapse. The first two cards are expanded by default; expansion state is remembered for the session.
- **Error cards stay fully visible and cannot be collapsed.**

The mark resolves in four steps: a `providerIcons` entry in `config.jsonc`, the mapping generated from magpie's own icons, a bundled file named after the provider id (`id`, `id-color`, `id.png`; PNG marks are also registered without the extension), then `generic`. A step only wins with an icon name the bundle actually carries, so a wrong name falls through silently. Custom channels (for example your own OpenAI-compatible endpoint) are not matched automatically; add a `providerIcons` entry when you want a specific mark.

Windows are grouped by the upstream `pool` field. One pool is one row with a two-column grid. A pool with fewer than two windows is left-aligned; a third window wraps. When the card is narrower than 260px, a container query switches to one column.

Each window cell shows:

- Window name and `N% left`.
- A 4px bar filled to the remaining amount; at 0.5% or less it uses the warning colour.
- `remaining / limit unit`, computed as `limit − amount`. When there is no number to subtract, the upstream `display` is shown unchanged.
- `resets …`, `runs out …`, and `pool …`.

Within a pool, layered model names ending in `(High)`, `(Low)`, or `(Medium)` are not rendered separately. If a pool has no duration window at all, the most-used layer is kept so the pool cannot disappear.

The quota-card screenshots below use OpenCode Go and Command Code, which have no `pool`; pool grouping and layered folding are covered by `tests/quotas-view.test.ts` and the real-gateway check recorded in [CONTRIBUTING.md](CONTRIBUTING.md#verification).

<table>
<tr>
<td width="50%"><img src="docs/images/quota-command-code-openchamber.png" alt="OpenChamber Command Code quota card: 5 hours, Weekly, and Credits windows in two columns; the Credits row shows the upstream 43.21 / 70.00 credits string" width="420"></td>
<td width="50%"><img src="docs/images/quota-command-code-magpie.png" alt="Magpie desktop Command Code quota card: 5-hour, weekly, and credits windows" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>: three windows, no pool. Five hours and Weekly share the first row; Credits wraps to the second. The Credits row has no <code>limit − amount</code> pair, so the upstream display is shown unchanged.</sub></td>
<td><sub><b>magpie desktop</b>: the same provider and windows. Magpie's remaining-credit trend sits below the window rows, outside this crop; the panel omits it to keep the card compact.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/quota-opencode-go-openchamber.png" alt="OpenChamber OpenCode Go quota card: 5 hours, 7 days, and Month windows in two columns" width="420"></td>
<td width="50%"><img src="docs/images/quota-opencode-go-magpie.png" alt="Magpie desktop OpenCode Go quota card: 5-hour, 7-day, and monthly windows" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>: OpenCode Go's three windows, two columns, remaining first.</sub></td>
<td><sub><b>magpie desktop</b>: same provider and windows. Magpie adds a remaining-credit trend; the panel omits it to keep the card compact.</sub></td>
</tr>
</table>

<img src="docs/images/quota-collapsed-openchamber.png" alt="OpenChamber quota list with seven cards collapsed, showing handles, names, plan labels, remaining percentages, and balances" width="860">

<p><sub>Seven cards collapsed. The provider marks stay visible as drag handles; the chevron expands a card. No provider name is redacted in this crop. Error cards are not in this crop because they never collapse.</sub></p>

### Balance cards

Balance cards split the upstream ` · `-joined string into label/value rows: the label is the text before the last space. A single-segment string is shown whole. Missing numbers render as `—`; no row shows `NaN`.

<table>
<tr>
<td width="50%"><img src="docs/images/balance-deepseek-openchamber.png" alt="OpenChamber DeepSeek balance card showing 21.08 CNY and the read timestamp" width="420"></td>
<td width="50%"><img src="docs/images/balance-deepseek-magpie.png" alt="Magpie desktop DeepSeek balance card with 21.08 CNY, read time, and remaining-credit trend" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>: a single-segment balance, shown whole as <code>¥21.08</code>.</sub></td>
<td><sub><b>magpie desktop</b>: the same provider and balance, with its remaining-credit trend.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/balance-openai-compatible-openchamber.png" alt="OpenChamber balance card for a custom OpenAI-compatible endpoint, provider name redacted, showing balance, used amount, remaining percentage, daily spend, mode, and request counters" width="420"></td>
<td width="50%"><img src="docs/images/balance-openai-compatible-magpie.png" alt="Magpie desktop balance card for the same custom OpenAI-compatible endpoint, provider name redacted, showing balance, used amount, remaining percentage, daily spend, mode, and request counters" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>: a custom OpenAI-compatible endpoint; the provider name is redacted. The upstream string becomes separate label/value rows. This read is $26.36.</sub></td>
<td><sub><b>magpie desktop</b>: the same endpoint at $25.11, also with the provider name redacted. The reads are not simultaneous; this pair compares the layout, not the cents.</sub></td>
</tr>
</table>

### Ordering

Drag a card by its provider mark, or focus the mark and press <kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Home</kbd>, or <kbd>End</kbd>. The order is written to `cardOrder` in `config.jsonc`. If the write fails, the panel keeps the new order, shows `order not saved` next to the Quotas heading, and retries on the next drop. Keyboard moves are announced through `aria-live`. Magpie desktop has no equivalent card-ordering control; this group is OpenChamber-only.

<table>
<tr>
<td width="50%"><img src="docs/images/sort-before-openchamber.png" alt="OpenChamber quota list before sorting: Command Code first, OpenCode Go second, Command Code balance third" width="420"></td>
<td width="50%"><img src="docs/images/sort-after-openchamber.png" alt="OpenChamber quota list after sorting: OpenCode Go first, Command Code second, Command Code balance third" width="420"></td>
</tr>
<tr>
<td><sub><b>Before</b>: Command Code is first. Every provider mark is a visible drag handle.</sub></td>
<td><sub><b>After</b>: OpenCode Go moved to first with the keyboard. The static frames show the handles and the resulting order; a drag in progress is not required.</sub></td>
</tr>
</table>

### Error cards

An upstream failure becomes an error card with the service's error category, status, and endpoint. The upstream response body is never passed through to the panel.

<img src="docs/images/error-cards-openchamber.png" alt="OpenChamber error cards for Our Free Model and OpenRouter with their messages and source endpoint" width="860">

<p><sub><code>Our Free Model</code> and <code>OpenRouter</code> fail independently; the other 10 cards still render. magpie desktop has no transport-error card for this case — its nearest state is “quota unavailable”, which is a different contract — so this group is OpenChamber-only.</sub></p>

### Typography

The panel uses the host font stack: `--oc-font` and `--oc-mono` come from OpenChamber's theme. OpenChamber loads its interface fonts from jsDelivr into the host document, and a guest frame has its own `FontFaceSet`, so the stack alone would render the local fallback. When the stack names one of OpenChamber's bundled families (Inter, Noto Sans, Fira Code, …), `src/panel/fonts.ts` declares the same `@font-face` rules and loads the Latin WOFF2 from jsDelivr. The package declares `https://cdn.jsdelivr.net` in `contributes.origins`; the install or update dialog asks the user to approve it. A custom or system family needs no face and falls back locally. The extension ships no font files, no font licence text, and no font provenance manifest.

Every type size in the panel is in rem. `fontScale` in `config.jsonc` sets the root font-size to `14px × fontScale / 100`, so 100 renders the 14px base; the type was authored at 12px, so 100% is also 14/12 of the old sizes (about +16.7%). `fontScale` is the panel's manual equivalent of OpenChamber's interface font-size setting: the host does not pass that percentage to guest frames — SDK 2.5.1's `HostReadyContext` carries font, mono, and radius only, and `applyHostReady` writes `0.875rem` on the guest root — so the Configuration card shows the active percentage and a note telling the user to set `fontScale` to the same percentage as OpenChamber. An invalid `fontScale` falls back to 100 and produces a visible issue; the endpoint and the API key are not degraded. Chart labels do not depend on the scale; their count is fixed (see [Trend](#trend)).

### Configuration and language

The Configuration card is the last card before the footer. It is not part of the quota list: it has no drag handle, is never reordered by `cardOrder`, and never moves. It starts collapsed; the open state lives in memory for the lifetime of the panel instance — it survives a refresh, a language switch, and repeated `onReady` calls, and it resets when the panel remounts. The header is a monochrome gear, the word **Configuration**, the current file status, and a chevron. It is a real button carrying `aria-expanded` and `aria-controls`, and the hidden body is not reachable from the keyboard. The status reads **Checking…**, **Not created**, **Valid**, **Invalid**, or **Unreadable** and describes the config file only; gateway connectivity is reported by the `serviceStatus` badge, not by this header.

The body shows the full actual config file path — it wraps instead of being truncated — as a focusable button that copies the path through `host.writeClipboard` and reports success or failure; copying never toggles the card. It also shows the effective endpoint, whether an API key is configured, the refresh interval, the active `fontScale` percentage, configuration issues, and, after a damaged file was rebuilt, which fields were restored and which fell back to defaults. There is no "edit config" button, no OS file association, no host file preview, and no local/remote detection: the panel only reports where the file is and what state it is in. When the file is missing, the body offers a **Create config file** button with a confirm/cancel step instead.

<table>
<tr>
<td width="50%"><img src="docs/images/config-openchamber.png" alt="OpenChamber Configuration card: file path blacked out, loopback endpoint, API key not configured, refresh every 60 seconds" width="420"></td>
<td width="50%"><img src="docs/images/config-magpie.png" alt="Magpie desktop Settings, General: language menu open with System, English, Simplified Chinese, and Traditional Chinese" width="420"></td>
</tr>
<tr>
<td><sub><b>OpenChamber</b>: the absolute path is irreversibly blacked out. Language is not a panel control; it is read from <code>config.jsonc</code>.</sub></td>
<td><sub><b>magpie desktop</b>: its own language control. The extension and Magpie read the same idea but keep separate settings.</sub></td>
</tr>
</table>

The panel has English and Simplified Chinese copy; those are the only runtime locales. Set `language` to `en` or `zh-CN` in `config.jsonc`; `auto` follows the host locale and resolves only an exact `zh-CN` match to Chinese. `panel/locales/ar.json` stays in the repository as a `"test": true` fixture for key, plural, and direction checks, but it is no longer imported into the runtime bundle: a host locale of `ar`, or an explicit `language: "ar"`, resolves to English with `dir=ltr`. Text renders with the host font stack (`--oc-font` / `--oc-mono`); the panel loads the host's Latin webfont for bundled families, and other scripts fall back to the system font, as in the host. The next refresh re-reads `/config`, so the change applies without restarting the service or OpenChamber.

<img src="docs/images/config-english-openchamber.png" alt="OpenChamber Configuration card in English after setting language to en; the absolute file path is blacked out" width="860">

<p><sub>After <code>language: "en"</code>, the same card renders in English. The path is redacted. Unknown or non-string values fall back to <code>auto</code> with a notice; they do not disable the endpoint or the key.</sub></p>

## Configuration

> **Coming from `config.json`?** The extension now reads `config.jsonc` only. The old file is never read, copied, renamed, or migrated, so your endpoint and API key stop applying until you move them. Migrate before your first open of the new panel: see [docs/config-migration.md](docs/config-migration.md).

The only configuration source is:

```text
$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc
```

Without `XDG_CONFIG_HOME`, use `~/.config/openchamber-magpie-usage/config.jsonc`. Windows uses the same layout: `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`.

The file is JSONC: `//` line comments and `/* */` block comments are allowed, trailing commas are not, duplicate top-level keys are rejected, and every syntax error is reported instead of tolerated. A single leading UTF-8 BOM is accepted and preserved when `cardOrder` is edited; a second leading BOM or a BOM anywhere else is still a syntax error. Unknown top-level keys are ignored by the parser and byte-preserved by a `cardOrder` edit. The old `config.json` is never read: if both files exist, only `config.jsonc` is used.

```jsonc
{
  // Comments are allowed; trailing commas are not.
  "baseUrl": "http://127.0.0.1:3425",
  "apiKey": null,
  "refreshSeconds": 60,
  "fontScale": 100,
  "cardOrder": [],
  "language": "auto",
  // A file the extension creates carries only "~keys"; "openai-mm": "openai"
  // below is a custom-override example, not a default value.
  "providerIcons": { "~keys": "magpie", "openai-mm": "openai" }
}
```

A file created by the extension has fixed bilingual comments above each field; the example key and the example order in that template are comments, never active values. Content that was already strict JSON is valid here as it stands and is not reformatted. New files are created with mode `0600` where the platform supports it.

| Field | Required | Rule |
| --- | --- | --- |
| `baseUrl` | No | Absolute http(s) URL. No credentials, query string, or fragment. A non-loopback host must use https. A path prefix is allowed. |
| `apiKey` | No | Non-empty string without whitespace or control characters. Sent only as `Authorization: Bearer`; never placed in the URL. |
| `refreshSeconds` | No | Integer 5–3600. Default 60. |
| `fontScale` | No | Integer 50–200. Default 100, which renders the 14px base; the root font-size is `14px × fontScale / 100` and every panel type size is in rem. A non-integer or out-of-range value falls back to 100 and sets `fontScaleInvalid`; the endpoint and the key still apply. |
| `cardOrder` | No | String array, at most 500 entries, each 1–200 characters. Parsed leniently: a non-array value, a non-string entry, an over-long entry, or too many entries drops only the bad part; the rest of the config still applies. Order is presentation only and never degrades the endpoint. |
| `language` | No | `auto` (default), `en`, or `zh-CN`. Case-sensitive; must equal a non-test `code` in `panel/locales/index.json` (entries marked `test`, such as `ar`, are not runtime languages). A non-string or empty value falls back to `auto` with a notice; the endpoint and key still apply. |
| `providerIcons` | No | Lenient object: the key is the part of the provider name after its last `/`, the value is a bundled icon name. At most 200 entries; keys and values at most 80 characters each; any own string key is kept as a plain mapping. A non-object value is dropped wholesale, bad entries are dropped silently, and unknown icon names are ignored silently; it never sets a new `invalid` and never changes the Configuration card header. A file the extension creates defaults to `{ "~keys": "magpie" }`; an existing file is never rewritten to add it, so add the field yourself when you need it — a file without it resolves to an empty mapping. A rebuild keeps a `providerIcons` mapping it can prove from the old text and only falls back to `{ "~keys": "magpie" }` when that mapping cannot be recovered. |

Behaviour:

- Missing file: the effective config is `http://127.0.0.1:3425` with no key, `present` is false and `validity` is `missing`. The Configuration card shows **Not created** and offers a **Create config file** button with a confirm/cancel step; see *First open and storage* below.
- Present but unusable file (syntax error, duplicate top-level key, non-object root, out-of-range field, http URL pointing at a remote host, and so on): the same default endpoint, with the reason shown in Configuration. The panel does not go blank. An unreadable file, a permission failure, or a non-regular path is reported as `unreadable`, never as missing, and is never overwritten.
- The service reads the file on every request. Saving applies immediately; no service or app restart is needed.
- `apiKey` may be absent or `null`; both mean "not configured". Any other non-string value is invalid, and an empty string is not a valid key.
- `cardOrder` keys are `encodeURIComponent(provider)|encodeURIComponent(kind)|encodeURIComponent(user)`. A second or third card with the same triple gets `#2` or `#3`. Keys the gateway no longer reports are ignored; new cards are appended in gateway order.
- `fontScale` is the panel's manual equivalent of OpenChamber's interface font-size setting; the host does not pass that percentage to guest frames. `GET /config` reports `fontScale` and `fontScaleInvalid`, and `POST /config/order` preserves `fontScale`.
- `providerIcons` is only an icon override mapping: bad values never set a new `invalid` and never change the Configuration card header; `GET /config` reports the mapping, and no field can carry anything derived from the key. The four-step mark resolution is described under [Quota cards](#quota-cards).
- Writes replace only the root `cardOrder`, edited locally with `jsonc-parser`. Other fields, unknown top-level keys, comments outside that array, indentation, and CRLF/LF endings are preserved byte for byte; comments inside the `cardOrder` array may be dropped, which the generated template states. Saving is serialised inside the service process through one promise chain, so two panels cannot interleave read-modify-write. The file keeps its original mode (0600 when it cannot be read), is written to `<path>.<pid>.<rand>.tmp`, and is published with `rename`.
- Before publishing, the service re-reads the file: if it changed on disk the write fails with 409 `config-conflict` and nothing is overwritten. A file that appears while a new one is being created is never replaced — creation is exclusive (a hard link, falling back to an exclusive `wx` open). A race with a writer in another process cannot be excluded absolutely; see [CONTRIBUTING.md](CONTRIBUTING.md#verification).
- A structurally damaged file (syntax error, duplicate top-level key, non-object root) is rebuilt in place only when an order is saved: the full template plus the submitted order, then the previous text appended line by line as `//` comments under a bilingual marker. No `.bak` or other backup file is created, and backups left by older versions are not deleted. Field-value errors do **not** rebuild — only `cardOrder` is edited, and the bad field stays in the file for the user to fix. The service keeps `{ at, restored, defaulted, previousText: 'appended-comments' }` in memory for its lifetime; a restart clears the notice while the file comments persist. The report never contains the old text, the key, the key length, or a key prefix.
- Saving an order while the file is missing creates it, so `present` becomes true and the "No config file yet" note disappears.

First open and storage:

- The panel keeps no `localStorage`, `sessionStorage`, IndexedDB, or cookie. Its one exception is a version-prefixed, instance-scoped host-storage marker, `openchamber-magpie-usage:v1:config-initialized`, which records only that the file has been initialised — never the config, the path, the key, the order, or any fold state.
- First open after install: if the file is genuinely missing and the marker is absent, the panel calls `POST /config/create` once and writes the full bilingual template. If the file already exists, only the marker is written; an existing file is never overwritten.
- If the marker cannot be read or written, the panel neither auto-creates nor treats the state as a first install. The manual button in the Configuration card stays available, and an existing file is never rolled back.
- If the marker exists and the file is later deleted, the panel does not recreate it; the Configuration card shows the create button.
- Reordering cards while the file is missing still creates the full template with the current order — the explicit exception to creating the file only once.

The key only enters the service process. The panel receives the boolean `apiKeyConfigured`; it has no key input, never echoes the key, and never writes it to storage, logs, URLs, or the build output.

## Service API

The service binds only to `127.0.0.1:<port assigned by the host>`. Every request must carry `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`. Only `GET` is accepted, plus `POST /config/create` and `POST /config/order`; every other method/path combination returns 405 (with `Allow: GET, POST`) or 404. Request bodies are limited to 64 KiB.

| Route | Purpose |
| --- | --- |
| `GET /health` | The original contract `{ ok, name, apiVersion }`, unchanged. |
| `GET /config` | The whole file state: `configPath`, `baseUrl`, `host`, `loopback`, `apiKeyConfigured`, `refreshSeconds`, `fontScale`, `fontScaleInvalid`, `cardOrder`, `cardOrderInvalid`, `language`, `languageInvalid`, `providerIcons`, `recovery` (`{ at, restored, defaulted, previousText: 'appended-comments' }` after a rebuild, otherwise `null`), `source` (`file` or `default`), `present`, `validity` (`missing` / `valid` / `invalid` / `unreadable`), `issue` (document-level or fatal, otherwise `null`), and `issues` (array of `{ field, kind, message }`). No field can carry the key. |
| `POST /config/create` | Body `{}` or `{ "order"?: string[] }`; 200 `{ ok: true, created, present: true }`. Idempotent: an existing file is left untouched and `created` is `false`. `order` is 0–500 strings of 1–200 characters; anything else is 400 `bad-request`. |
| `POST /config/order` | Body `{ "order": string[] }`; 200 `{ ok: true, order, recovery }`. 1–500 strings of 1–200 characters; anything else is 400 `bad-request`. Field-value errors do not rebuild the file; structural damage does. |
| `GET /v1/magpie/usage?period=today\|7d\|30d` | Normalised usage summary. |
| `GET /v1/magpie/quotas?kept=1` | Prefer the upstream cached read. |
| `GET /v1/magpie/quotas?refresh=1` | Ask for a fresh read; repeated requests inside 30 seconds are throttled. |

Config-write details:

- All writes in one process are serialised through one promise chain, so two panels cannot interleave read-modify-write. A failed write does not block the queue.
- The merge replaces only the root `cardOrder`, edited locally with `jsonc-parser`; `fontScale`, `language`, `refreshSeconds`, `providerIcons`, unknown keys, and every comment outside that array stay byte for byte.
- Read → edit → write `<path>.<pid>.<rand>.tmp` → `chmod` the temporary file to the original mode (0600 when unreadable) → re-read the original and abort with 409 `config-conflict` if it changed → `rename` over the original.
- Creation is exclusive: a hard link, falling back to an exclusive `wx` open, never overwrites a file that appeared meanwhile. A file created by `POST /config/create` or by an order save gets mode 0600 where the platform supports it.
- A structurally damaged file is rebuilt in place: the full template plus the submitted order, then the old text appended line by line as `//` comments under a bilingual marker. No `.bak` file is written and existing backups are not deleted. The service keeps `{ at, restored, defaulted, previousText: 'appended-comments' }` in memory for `/config`; a restart clears it while the file comments persist.
- Field-value errors do not rebuild: only `cardOrder` is edited and the invalid value stays in the file. Unreadable, permission-denied, and non-regular paths fail the write and are never reported as success.
- A missing file is created; `present` becomes true and the "No config file yet" note disappears.

Refresh policy:

- Automatic cycle: usage takes the summary; quotas request upstream `?kept=1` first.
- Manual refresh: quotas request a fresh read without `kept`, throttled to one read per 30 seconds. A click inside the window returns the previous read and marks it `throttled`.
- Measured on this machine: Magpie `0.1.2470` returns an empty `data` array for `GET /v1/magpie/quotas?kept=1` while a normal request returns 12 cards. When `kept=1` returns zero cards, the service falls back to the last successful read and marks it `stale`; with no previous read it performs one normal read. Without this fallback, every automatic refresh would empty the card list.

Error mapping (HTTP 502/504, one category per cause, never conflated with a network error):

```text
upstream-unauthorized (401)
upstream-forbidden (403)
upstream-status (other status)
upstream-timeout (504)
upstream-network (connection failed)
upstream-not-json
upstream-schema (shape mismatch)
upstream-redirect (cross-origin redirect rejected)
```

Redirect policy: `redirect: "manual"`. Same-origin redirects are followed up to three times; any cross-origin redirect is rejected and the key is never sent to another origin.

The upstream error body is not returned to the panel. Only the category, status, and endpoint are returned, so an upstream cannot leak a key or internal detail through its response body.

## Boundaries and security

- The panel runs in a sandboxed iframe and loads a classic IIFE `panel/main.js`. It cannot `fetch`, use XHR, touch `localStorage`, `sessionStorage`, IndexedDB, or cookies, or dial the local service directly. The only thing it stores is the instance-scoped first-open marker `openchamber-magpie-usage:v1:config-initialized` through the host's own storage API — never the config, the path, the key, the order, or a fold state. Order saves and config creation also go through `host.serviceRequest`; the panel makes no fetch or XHR request. Its only external load is the interface-font WOFF2 that the browser requests from the approved jsDelivr origin.
- Panel colours come only from the host's `--oc-*` variables. The stylesheet contains no hard-coded light or dark values.
- Host controls (badge, refresh button) are mounted once at module load. A repeated `onReady` snapshot only updates values.
- The local service runs with the current user's privileges, binds only to `127.0.0.1`, and checks the Bearer token on every request. The token is never logged.
- Keys belong only to the service process. They must not appear in the panel, the bundles, logs, URLs, or a commit.

## Contributing

The local environment, build and bundle rules, test commands and coverage, verification record, screenshot rules, translation workflow, and release steps live in [CONTRIBUTING.md](CONTRIBUTING.md); the Chinese edition is [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md).

This README documents what the extension does and how to install and configure it. Development, deployment, and test material belongs in the contributing guides.

## License

MIT. See [LICENSE](LICENSE).

Provider marks are synced from [yetone/magpie](https://github.com/yetone/magpie) (`main`, MIT) into the generated sources `src/shared/provider-icons.generated.ts` and `src/panel/logos.generated.ts` by `tools/icons/sync.ts`; those files record the source repository, branch, and commit — currently `4436b7d98f7abd0ca1b54d76ef1c7afc87367531` — plus the attribution line. Many of the marks originate from lobe-icons. The marks remain the property of their owners and are used only to label the provider of a quota card. PNG marks and `-color` marks keep their brand colours; the others follow the host theme. The `generic` fallback is drawn by this project.
