# Contributing

## Scope

This is an OpenChamber guest extension: a sandboxed panel plus a local Node service. Changes must keep the panel and the service contract in sync. The panel may only use `host.*`; it cannot `fetch`, use XHR, touch `localStorage`, `sessionStorage`, IndexedDB, or cookies, or dial the service directly. Its single storage use is the instance-scoped first-open marker through `host.storage` (see [Config file](#config-file)).

## Local environment

- Bun 1.4 or newer.
- OpenChamber 2.5.0 or newer (the manifest declares `engines.openchamber >= 2.5.0`).
- A checkout of this repository.
- Bun is needed only to build the committed bundles: OpenChamber does not compile TypeScript and installs only the checked-in `panel/main.js` and `service/main.js`.
- Node 22+ must be on `PATH` (a prerequisite for local tests): `tests/service-bundle.test.ts` starts the on-disk `service/main.js` with a real Node process and fails (never skips) when Node is missing. CI provides Node 22 via `actions/setup-node@v4`. A host install needs no system Node — the host runtime starts the service; Bun is only the build/test tool, and the source-level service tests still run under Bun.
- No dev server, watcher, or release script exists.

```bash
bun install
```

`bun.lock` is committed. Do not hand-edit it; run `bun install` after changing dependencies.

## Build

```bash
bun run build          # panel/main.js and service/main.js
bun run build:panel    # panel only
bun run build:service  # service only
bun run typecheck      # tsc --noEmit
```

- `panel/main.js` is a classic IIFE. The sandboxed iframe cannot load ESM.
- `service/main.js` is built with `--node`; it keeps ESM and Node built-ins.
- `jsonc-parser` must be imported explicitly from `jsonc-parser/lib/esm/main.js` (see `src/shared/config-document.ts`). The package-root import resolves to the UMD entry under Bun's `--node` target and leaves internal relative `require('./impl/*')` calls in the single-file bundle, so the host's Node dies at startup with `MODULE_NOT_FOUND`. A successful build does not mean the bundle runs under Node; `tests/service-bundle.test.ts` is the regression test for exactly this trap.
- Both bundles are committed. A source change without a rebuilt bundle is incomplete.
- `bun run build` only produces those two JS files. `panel/index.html` and `panel/styles.css` are static package files: `index.html` links the stylesheet. They are not build outputs. There are no font assets in the package: the stylesheet has no `@font-face` rules; the panel declares `@font-face` at runtime for the bundled interface families and loads the files from the approved jsDelivr origin.

The panel entry is `src/panel/main.ts` (`connectHost()` and mount). The implementation is `src/panel/app.ts` (`mountPanel`). Runtime locale JSON files are imported by `app.ts` and inlined into `panel/main.js` at build time.

## fontScale

The panel uses the host font stack: `--oc-font` and `--oc-mono` come from OpenChamber's theme. A guest frame cannot see the host document's `FontFace` set, so `src/panel/fonts.ts` declares the matching `@font-face` rules for the families OpenChamber bundles (Inter, Noto Sans, Fira Code, …) and loads the Latin WOFF2 from jsDelivr; `contributes.origins` declares that CDN and the install dialog asks the user to approve it. The extension ships no font files or font licences; a custom or system family falls back locally. `fontScale` controls only the size, never which font is used.

`config.jsonc` accepts `fontScale`: an integer from 50 to 200, default 100. 100 renders the 14px base; the type was authored at 12px, so 100 is 14/12 of the old sizes. The root font-size becomes `14px × fontScale / 100`, and every panel type size is in rem.

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "fontScale": 100,
  "language": "auto"
}
```

It is the panel's manual equivalent of OpenChamber's interface font-size setting. The host does not pass that percentage to guest frames: SDK 2.5.1's `HostReadyContext` carries font, mono, and radius only, and `applyHostReady` writes `0.875rem` on the guest root, which the panel then overrides with the scaled size after every `onReady`. The Configuration card therefore shows the active percentage and a note telling the user to set `fontScale` to the same percentage as OpenChamber.

Contract:

- An invalid value (not an integer, or outside 50–200) falls back to 100 and sets `fontScaleInvalid`. `GET /config` reports `fontScale` and `fontScaleInvalid`, the panel shows a visible issue, and the endpoint and API key are not degraded.
- `POST /config/order` merges only `cardOrder` and preserves `fontScale`.
- Chart labels are independent of `fontScale`: seven `MM-DD` labels for the 30-day period, six `HH` labels for the 24-hour period.
- Coverage: `tests/config.test.ts` (parse and fallback), `tests/service.test.ts` (`/config` report), `tests/panel-host.test.ts` (root font-size after repeated ready, invalid notice, chart labels: text, fixed counts, independence from `fontScale`).

## Config file

The only configuration file is `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc`, or `~/.config/openchamber-magpie-usage/config.jsonc` when `XDG_CONFIG_HOME` is absent. Windows uses the same `~/.config` layout, for example `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`. The old `config.json` is never read, copied, renamed, or migrated; when both exist only `config.jsonc` is used. Moving from the old name is a manual job: see [docs/config-migration.md](docs/config-migration.md).

The file is JSONC:

- `//` line comments and `/* */` block comments are allowed; `//` and `/*` inside a string are not comments.
- Trailing commas are rejected. Duplicate top-level keys are rejected (duplicates nested deeper are allowed). Every syntax error is collected; the tolerant parser's partial value is never trusted without checking `errors`.
- A single leading UTF-8 BOM is accepted and preserved by a `cardOrder` edit. A second leading BOM, or a BOM anywhere after the first character, is still a syntax error.
- Unknown top-level keys are ignored by the parser and byte-preserved by a `cardOrder` edit.
- Strict JSON is valid where it stands and is not reformatted. A save replaces only the root `cardOrder` value, edited with `jsonc-parser`; comments inside that array may be dropped, which the generated template states.

Creation and storage:

- First open: when the file is genuinely missing and the instance-scoped host-storage marker `openchamber-magpie-usage:v1:config-initialized` is absent, the panel posts `POST /config/create` once and gets the full bilingual template. If the marker already exists and the file is later deleted, the panel does not recreate it; the Configuration card shows the create button instead.
- That marker is the only thing the panel stores. There is no `localStorage`, `sessionStorage`, IndexedDB, or cookie, and the marker never holds the config, the path, the key, the order, or a fold state. If the marker cannot be read or written, the panel neither auto-creates nor treats the state as a first install; the manual button stays available.
- Reordering cards while the file is missing is the explicit exception: it creates the template with the current order.
- When the panel's `/config` read fails (service error or malformed shape), the card header shows `config.status.unchecked` (`Unable to check`, warning tone) rather than the file being `invalid`; `config.loadFailed` states the reason and never echoes upstream text. A failure outranks the previous validity: an old `Valid` never outlives the answer that proved it, and the next successful read restores the real state. Usage/quotas failures never turn a valid config into `Unable to check`; during a failure nothing writes storage, nothing triggers a create, and a stale `missing` report never authorises one.

Writes and recovery:

- All writes in one service process run on one promise chain. The file keeps its original mode (0600 when it cannot be read); a file the service creates gets 0600 where the platform supports it.
- Only the root `cardOrder` range is edited. Other fields, unknown keys, comments outside the array, indentation, and CRLF/LF endings survive byte for byte.
- Creation is exclusive (a hard link, falling back to an exclusive `wx` open), so a file that appears meanwhile is never overwritten. An order save re-reads the file just before publishing and fails with 409 `config-conflict` when the text changed; a race with another process cannot be excluded absolutely.
- A structurally damaged document (syntax error, duplicate top-level key, non-object root) is rebuilt only when an order is saved: the full template plus the submitted order, then the previous text appended line by line as `//` comments under a bilingual marker. No `.bak` file is created and old backups are not deleted. Field-value errors do not rebuild — only `cardOrder` changes. Unreadable, permission-denied, and non-regular paths are never overwritten or reported as success.
- The service keeps `{ at, restored, defaulted, previousText: 'appended-comments' }` in memory until it restarts; the report never contains the old text or anything derived from the key.

Coverage: `tests/config-document.test.ts` (inspection, recovery, local edit), `tests/service.test.ts` (`POST /config/create`, `POST /config/order`, the `/config` report), `tests/service-bundle.test.ts` (`/config`, creation, and order saves after a real Node starts the bundle), `tests/panel-host.test.ts` (card shell, creation flow, and the read-failure status).

## Test

```bash
bun test
bun test tests/quotas.test.ts
bun run check   # typecheck -> build -> tests
```

The order of `bun run check` is fixed by `package.json` as typecheck → build → test: build first, then test, so the tests (especially the bundle test) verify the artifacts generated from the current sources. The total test count is taken from the output of the current `bun run check` rather than hard-coded in this document.

Tests are hermetic: fake gateway, temporary config directory, and real HTTP round-trips between the test client and the service module from `src/service/server.ts`. Panel tests use a fake host and happy-dom; they start no HTTP server, connect to no real host, and do not touch the user's config directory. Except for `tests/service-bundle.test.ts`, the source-level service tests load the service module from `src/` under Bun — together they cover only source/bridge behaviour plus some local HTTP and do not prove that the on-disk `service/main.js` starts under Node.

CI runs `bun install --frozen-lockfile`, `bun run check`, and:

```bash
git diff --exit-code -- panel/main.js service/main.js
```

### Test coverage

| File | Coverage |
| --- | --- |
| `tests/config.test.ts` | Config validation through `parseConfigText`: document-level failures (broken JSON, non-object root), http/https rules, loopback detection, credentials and query strings, key characters, refresh range, unknown keys; lenient `cardOrder`; order-key encoding; `#2` suffixes; known/unknown/expired keys; `language` defaults, explicit values, invalid fallback without endpoint degradation; `fontScale` default, 50–200 range, and invalid fallback without endpoint degradation. |
| `tests/config-document.test.ts` | Strict JSONC inspection: line and block comments, `//` and `/*` inside strings, trailing commas, truncated strings, empty content, duplicate top-level keys (nested duplicates allowed), non-object roots; a single leading UTF-8 BOM accepted and preserved by the local `cardOrder` edit while a second/mid-document BOM stays invalid; lenient field issues that keep the endpoint while a fatal one falls back wholesale; conservative recovery of the endpoint/key pair, duplicated fields, unproven values, and the `auto`/`en`/`zh-CN` language whitelist; the local `cardOrder` edit preserving comments, unknown keys, indentation, and CRLF; the generated template is itself valid JSONC with six active keys. |
| `tests/i18n.test.ts` | Registry validity, key parity, placeholder parity, CLDR plural categories (`one/other` in English, `other` in `zh-CN`), interpolation/fallback, exact `resolveLocale` matching and unsupported markers; the Arabic `test` fixture is RTL but never a runtime match. |
| `tests/format.test.ts` | Number, cost, credit, percentage, and time formatting; zero hit-rate denominator; window-percentage fallback chain; money-row priority. |
| `tests/quotas-view.test.ts` | Pool grouping and layered folding (Antigravity's three rows, nine hidden layers), duration sorting, pool-less windows sharing a row, remaining-amount rows, balance splitting, tightest remaining, icon mapping and fallback. |
| `tests/service.test.ts` | Bearer check, `/health` contract, `/config` report (path, endpoint, `apiKeyConfigured` without the key, `fontScale`/`fontScaleInvalid`, `validity`, `recovery`, the old `config.json` being ignored, and a BOM-prefixed file keeping its endpoint/key), immediate config reload, 405/404 method/path combinations; `POST /config/create` (bilingual six-field template, empty body, explicit order, an existing file left untouched, bad bodies, a non-regular path refused); `POST /config/order` (only `cardOrder` edited, unknown keys and mode preserved, BOM and outside comments preserved, creation when missing, in-place rebuild with no `.bak`, a BOM-prefixed rebuild that keeps the BOM and comments the BOM-free old body, a field error that does not rebuild, bad and oversized bodies, concurrent writes, 401). All of it loads the service module from `src/` under Bun. |
| `tests/service-bundle.test.ts` | Real-Node regression for the on-disk `service/main.js` bundle: the bundle is copied into an isolated temp directory without `node_modules` and started by a real Node child process from `PATH` (never Bun's `process.execPath`), covering bearer auth, the `/health` contract, the missing-file fallback, the bilingual template from `POST /config/create`, `config.jsonc` values reaching `/config`, usage/quotas forwarded to a fake gateway over real HTTP, and a `POST /config/order` save that keeps comments and unknown keys without echoing the key. A bundle that still resolves `./impl/*` fails here instead of only on the host. When Node is missing the test fails, never skips. |
| `tests/usage.test.ts` | Period and key forwarding, default/invalid periods, missing fields without NaN, 401/403/500/timeout/connection failure/non-JSON/schema mismatch. |
| `tests/quotas.test.ts` | All card variants, `kept`/`refresh` forwarding, throttling, empty-cache fallback, cross-origin redirect rejection, same-origin redirect following. |
| `tests/secret.test.ts` | The key never appears in `/config`, logs, or build artifacts; no key literal in source. |
| `tests/panel-bundle.test.ts` | The panel is a classic IIFE, has no fetch/XHR, uses no `localStorage`/`sessionStorage`/IndexedDB/cookie and only host instance storage for the first-open marker (never the config, path, key, order, or fold state), uses only `--oc-*`, mounts controls once outside `onReady`, inlines icons as data URIs, and contains the two-column grid and container query. |
| `tests/panel-fonts.test.ts` | The panel declares the host's bundled interface families itself: the sans and mono stacks become `@font-face` rules at the host weights, Fixel Text uses the host CDN files, Atkinson Hyperlegible loads 400 and 700, a system or custom stack declares nothing, and repeated host snapshots add each family once. No request leaves the process. |
| `tests/panel-host.test.ts` | Mounts the panel with a fake host: first-screen `/config`, usage, and `kept=1` requests; KPI and quota cards; `HostRequestError` codes and the service error vocabulary; non-JSON and shape errors without echoing upstream text; period switching only re-fetches usage; manual refresh sends `refresh=1`; throttled/stale copy; keyboard order writes `/config/order`; `order not saved`; expand/collapse; repeated `onReady` does not remount; four `serviceStatus` badges; `language` and host-locale selection, fallback, and `languageInvalid`; Arabic fallback to English with `dir=ltr`; root font-size after repeated ready; the invalid `fontScale` notice; chart labels: the `MM-DD` and `HH` text, fixed counts, and independence from `fontScale`; the Configuration card shell (last before the footer, collapsed by default, header status from file validity only, remount resets it, path copy button with success and failure feedback, recovery details in the body); configuration creation (first open creates once then remembers, an existing file is never overwritten, a storage failure neither auto-creates nor blocks the manual button, the confirm/cancel flow posts only intent and order, a failed create stays retryable, a marker write failure never rolls back the file); configuration read failures (when `/config` fails or is malformed the card header says `Unable to check`, not `Invalid`/`Checking`, `config.loadFailed` shows the reason without echoing upstream text, the next successful read restores the real validity, usage/quotas failures never turn a valid config into `Unable to check`, and nothing writes storage or triggers a create during the failure). |
| `tests/health.test.ts` | The shared `/health` contract used by the panel and the service. |
| `tests/manifest.test.ts` | Manifest paths, required build artifacts, package metadata, and the declared font origin. |
| `tests/harness.ts`, `tests/fixtures.ts` | Fake gateway and captured payload fixtures; support files, not test suites. |

## Verification

The record behind the README's behaviour and screenshot claims. Verified on 2026-11-01; it predates `fontScale`, the language-fallback change, and the switch to `config.jsonc`. The suite's total test count is taken from the output of the current `bun run check` (the historical record is 280 tests in 13 files), and `bun run check` remains the gate. The hashes and sizes below belong to that 2026-11-01 build and no longer describe the current bundles, which were rebuilt later for the JSONC change:

- `bun run check` passed: typecheck, 211 tests in 12 files (0 fail, 1,783 expectations), and both builds.
- Two consecutive builds were byte-identical. SHA-256:
  - `panel/main.js`: `EC65B475AE7FAFBD90C639B64EBB2FBCD22C7EA1B9CD1C6DFAF2FD9EEFB4DA81` (110,454 bytes)
  - `service/main.js`: `A0535553EF5DE80055BC668721EB1AE9A8C47697E3B403CCFCABF6E8E50C6E95` (28,078 bytes)
- `git diff --exit-code -- panel/main.js service/main.js` exited 0 after the check.
- Screenshots: 24 images across all 8 groups, in `docs/images/`. OpenChamber and magpie desktop are side by side for usage (today/7d/30d), the 7-day trend, quota cards, balance cards, and configuration/language. Account e-mails, the API-key fragment, and the absolute config path were removed with solid fills or excluded from the crop.
- Real gateway: 12 cards rendered with no script errors. Antigravity folded into three pool rows (Claude & GPT, Gemini, Gemini 4 Argon) with all nine `(High)/(Low)/(Medium)` layers hidden; windows sorted 5 hours → 7 days.
- The custom OpenAI-compatible endpoint's balance string split into 14 label/value rows; the single-segment `¥21.08` stayed whole; `unlimited`, the four balance cards, and the two error cards rendered correctly; no money row showed `NaN`.
- Container query: at about 340px card width, `grid-template-columns` was `154px 154px`; at 240px it became a single `220px` column.
- Dragging the first card to third position wrote `cardOrder` while preserving `baseUrl`; reopening the panel kept the order. Keyboard `End` moved a card and `aria-live` announced "moved to position 12 of 12".
- Writing invalid JSON into `config.json` and then dragging a card copied the original byte-for-byte to `config.json.bak` and rewrote a valid file containing only `cardOrder` (two-space indent, trailing newline). Configuration reported `config.json was invalid; saved as … and reset`. This bullet records the pre-JSONC behaviour: the current code rebuilds `config.jsonc` in place with the old text appended as `//` comments and creates no `.bak`, and that path has only automated coverage.
- A forced write failure (config path occupied by a directory) kept the new order, showed `order not saved` next to Quotas, and included the service's reason.
- 2026-11-08 service-startup fix verified: `bun run check` (typecheck → build → test) green with 293 tests in 14 files and byte-identical consecutive builds; `tests/service-bundle.test.ts` copies `service/main.js` into an isolated directory without `node_modules` and starts it with a real Node from `PATH`, covering auth, `/health`, `/config`, `POST /config/create`, fake-gateway usage/quotas forwarding, and `POST /config/order` writes. Panel regressions also cover rechecking config freshness after asynchronous initialization and clearing a resolved automatic-create error after manual success.
- The same fix was also checked against the real loopback Magpie gateway (`127.0.0.1:3425`) using the built service under Node 22.23.4 in a disposable directory: `/config`, usage, and quotas returned 200; quotas returned 14 cards. This probe used neither the user's config nor a real key. It does not verify installation in OpenChamber or sidebar appearance.

Not verified:

- Most screenshots in `docs/images/` were captured before `fontScale` (at the old 12px design size) and before 0.3.1. The Command Code quota pair, the ordering pair, and the collapsed list were re-captured on 0.4.0; the remaining groups still need re-capturing.
- The Electron right-sidebar chrome and the permission-approval dialog: the screenshots use the real installed extension in OpenChamber's UI, but the host window chrome is cropped away.
- The full `--oc-*` theme matrix: the captured panel is in the light theme; the dark host theme was not exhaustively compared.
- Other Magpie versions' window names and `pool` fields: the folding rule only recognises `(High|Low|Medium)` and only applies inside a pool.
- The semantics of upstream `kept=1` on other Magpie versions; on this machine it returns an empty list.
- No real-host install of the current build: the JSONC file, the collapsed Configuration card, the first-open auto-create, the copy-path button, the 409 `config-conflict` path, and the in-place rebuild were exercised only by automated tests (`tests/config-document.test.ts`, `tests/service.test.ts`, `tests/panel-host.test.ts`) with a fake host, happy-dom, and real local HTTP. No right-sidebar pixel check was made for the current build.
- The `Unable to check` status on a failed config read, the `config.loadFailed` notice, and recovery on a successful retry are covered only by `tests/panel-host.test.ts` with a fake host; they have not been verified in a real Electron host.
- The screenshots in `docs/images/` also predate `config.jsonc` and the collapsed Configuration card.
- Cross-process write races: writes are serialised inside one service process and the file is re-read just before publishing, but a write from another process between that read and the `rename` cannot be excluded by the suite.

## Debugging

There is no development server. Build, then add this folder as a local extension in OpenChamber's **Settings → Extensions** and open the panel. The Configuration card and the `serviceStatus` badge are the first debugging surfaces.

Common checks: `bun test tests/service.test.ts` for the service contract; `bun test tests/service-bundle.test.ts` for the on-disk `service/main.js` starting under a real Node (Node must be on `PATH`); `bun test tests/panel-host.test.ts` for the panel-to-host bridge.

The service needs both variables from the host:

```text
OPENCHAMBER_SERVICE_PORT
OPENCHAMBER_SERVICE_TOKEN
```

It binds only to `127.0.0.1`, requires `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN` on every request, and never logs the token. `GET /health` returns `{ ok, name, apiVersion }`. `GET /config` reports `configPath`, the effective endpoint, `apiKeyConfigured` (a boolean, never the key), `refreshSeconds`, `fontScale`, `fontScaleInvalid`, `cardOrder`, `cardOrderInvalid`, `language`, `languageInvalid`, `recovery`, `source`, `present`, `validity` (`missing` / `valid` / `invalid` / `unreadable`), `issue`, and `issues`. The write routes are `POST /config/create` and `POST /config/order`; any other method/path pair is 405 or 404.

The service re-reads `config.jsonc` on every request, so a corrected file applies without a restart. Language changes apply on the next panel refresh (default 60 seconds). Never put a token, API key, or upstream response body in a log, issue, or commit.

## Install, version, CI

Install from OpenChamber's **Settings → Extensions** using a folder, ZIP, or Git URL:

```text
https://github.com/lilixxs/openchamber-magpie-usage.git
```

The host replaces a Git-installed package directory on update. User settings therefore stay outside the package, under `$XDG_CONFIG_HOME` or `~/.config`. Deployment is the same install step: there is no separate deploy, publish, or release script.

Version and artifacts:

1. Change `version` in `package.json`.
2. Run `bun run build`. The panel imports `package.json`, so the displayed version follows the new build.
3. Run `bun run check`.
4. Commit `package.json`, `panel/main.js`, and `service/main.js`.

There is no publish or release script. CI is `.github/workflows/ci.yml`: Ubuntu, `actions/setup-node@v4` with Node 22 (the bundle test needs a real Node), Bun 1.4.2, frozen lockfile, `bun run check`, and the bundle diff.

## Screenshots

Screenshots live in `docs/images/` and are referenced by relative path from both READMEs.

- Name files `<feature>-<app>.png`, where `app` is `openchamber` or `magpie`; add a state suffix such as `-collapsed`, `-before`, `-after`, or `-english` when needed.
- Pair a feature with the Magpie desktop UI when one exists: same feature, and the same period/provider when possible. If Magpie genuinely has no corresponding screen, use an OpenChamber-only image and say so in the caption.
- Crop to the relevant panel, card, or settings page. Do not include unrelated projects, sessions, or the desktop.
- Use real captures only. Do not substitute diagrams, mockups, old images, or unrelated screens.
- Remove e-mail addresses, account IDs, API-key fragments, local absolute paths, and other personal data with an irreversible solid fill or pixelation. Do not use a reversible blur.
- A static ordering image may show the drag handles and the resulting order; a drag in progress is not required.
- Scale for GitHub's content width: about 420 px per image in a two-column pair, 860 px for a full-width image. Keep text readable.
- Every image needs descriptive alt text naming the app, screen, period, and state.
- Check every image at 100% after redaction; a single visible character from a secret is a failure.

The README uses 24 images across 8 groups: install, usage (today/7d/30d), trend, quota cards (plan and balance, plus the collapsed list), balance cards (DeepSeek and a custom OpenAI-compatible endpoint), error cards, ordering, and configuration/language.

## Translations

The panel reads user-visible copy from `panel/locales/`. No UI string is hard-coded in the panel source.

### Layout

| Path | Purpose |
| --- | --- |
| `panel/locales/index.json` | Registry: `code`, endonym `name`, and text `dir`. |
| `panel/locales/en.json` | English bundle. Also the fallback for every missing key. |
| `panel/locales/zh-CN.json` | Simplified Chinese bundle. |
| `src/i18n/messages.ts` | Interpolation, plural selection, fallback chain. |
| `src/i18n/locale.ts` | Registry parsing, locale resolution, bundle loading. |
| `src/panel/app.ts` | Imports every bundle and owns the active translator. |
| `tests/i18n.test.ts` | Registry, key, placeholder, plural, and resolution tests. |

### Bundling

This panel is packaged for a sandboxed iframe whose bundle test forbids `fetch` and `XMLHttpRequest`. Every runtime locale file is therefore imported at build time:

```ts
import en from '../../panel/locales/en.json';
import localeIndex from '../../panel/locales/index.json';
import zhCN from '../../panel/locales/zh-CN.json';
```

Only `en` and `zh-CN` are imported. `panel/locales/ar.json` is marked `"test": true` in the registry and is deliberately not imported: `localeCodes()` in `src/panel/app.ts` filters `test` entries out of the runtime registry, so a test fixture never enters `MESSAGES` or the bundle. The fixture still participates in key, plural, and direction checks through `tests/i18n.test.ts`.

Adding a language is a data change **plus imports and one map entry** in `src/panel/app.ts`, then a rebuild of `panel/main.js`. It is not a runtime drop-in like a web application. The registry is still the single list of `code`/`name`/`dir`; a new code that is not in the map cannot resolve. A `test: true` entry is the exception: it never gets an import or a map entry.

### Keys

Keys are flat and dot-separated, for example `panel.subtitle` or `quota.remaining`. There is no nesting.

Placeholders are written `{name}` and filled from the `vars` argument. A placeholder with no value stays as written.

Every bundle must contain exactly the same non-plural keys as `en.json`. Extra keys, missing keys, and differing placeholder sets fail `bun test`.

### Plurals

A pluralized string uses `key.one`, `key.other`, and any other CLDR category the language needs. `Intl.PluralRules` is the only judge. Lookup order is `key`, `key.<category>`, `key.other`, then the same chain in English, then the key itself.

CLDR categories for locales this project is likely to add:

| Locale | Categories |
| --- | --- |
| `en` | `one`, `other` |
| `zh-CN`, `zh-TW`, `ja`, `ko` | `other` |
| `de`, `nl` | `one`, `other` |
| `fr`, `pt-BR`, `es` | `one`, `many`, `other` |
| `pl`, `uk` | `one`, `few`, `many`, `other` |
| `ar` | `zero`, `one`, `two`, `few`, `many`, `other` |

The test suite reads the categories from `Intl.PluralRules` at run time, so the table above is orientation only.

### Adding a language

1. Copy `panel/locales/en.json` to `panel/locales/<code>.json` and translate the values. Keep keys and placeholders unchanged.
2. Add one line to `panel/locales/index.json`.
3. Import the JSON in `src/panel/app.ts`, add it to the `MESSAGES` map, and add its `code` to the registry-driven resolution. The map is the only place that knows which bundle files are packaged.
4. Run `bun install && bun run check`.

Tests enforce key parity, plural coverage, placeholder parity, and a valid registry. `panel/main.js` must be rebuilt and committed; CI runs the bundle diff.

### Language configuration

There is no language control in the panel. The setting lives outside the installed package, because the host replaces a Git-installed package directory on update:

- `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc`, or
- `~/.config/openchamber-magpie-usage/config.jsonc` when `XDG_CONFIG_HOME` is absent. Windows uses the same `~/.config` layout, for example `%USERPROFILE%\.config\openchamber-magpie-usage\config.jsonc`.

The file already holds the Magpie endpoint settings; add `language`:

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "language": "auto"
}
```

`language` is `auto`, `en`, or `zh-CN`. It is case-sensitive and must equal a non-test `code` in `index.json`; entries marked `test` (such as `ar`) are not runtime languages. `auto` follows the host locale on an exact match (`zh-CN` shows Simplified Chinese); every other host locale shows English — including `ar`, which resolves to English with `dir=ltr`. Text renders with the host font stack, so whatever the host font supports is what appears in dynamic data.

The service reads the file on every request and returns `language` and `languageInvalid` in `GET /config`. The panel reads `/config` on every refresh cycle (default 60 seconds), so a language change applies on the next refresh without restarting the service or the app.

| Situation | Behaviour |
| --- | --- |
| `language` missing | `auto`; no notice. |
| `language` is not a non-empty string | `auto`; `languageInvalid` is true and the panel shows a notice with the path. The endpoint and key still apply. |
| A valid string that is not a runtime code (unknown, or a `test` fixture such as `ar`) | `auto`; the panel shows `config.language.unsupported` with the path. |
| Host locale is `ar` (a test fixture) | `auto` resolves to English, `dir=ltr`; no notice. |
| File missing | `auto`; the "No config file yet" note says the host language is used, and the card offers **Create config file**. |
| Invalid JSONC document (syntax error, duplicate top-level key, non-object root) | `auto`; the existing configuration issue says the host language is used. |
| Service unavailable | The panel stays on English; the service card shows the existing error. |

Uninstalling the extension leaves the config directory behind.

### Right-to-left layout

The `ar` fixture still drives direction checks in `tests/i18n.test.ts`: key parity, the six Arabic CLDR plural categories, and the same placeholders as English. `panel/styles.css` drops the letter-spacing the Latin labels use under `[dir='rtl']`, because tracking breaks Arabic joins, but no runtime locale resolves to `dir="rtl"` today.

Not covered: the Arabic copy was written for layout testing and is not native-proofread, and the mirrored layout is not reachable through configuration while only `en` and `zh-CN` run. The old panel-level Arabic RTL test was replaced by fallback tests.

## Commit checklist

- `bun run check` passes.
- `git diff --exit-code -- panel/main.js service/main.js` exits 0.
- New UI copy is in `en.json` and `zh-CN.json` (and every other registered bundle).
- New tests cover the changed behaviour; no skipped tests.
- Screenshots follow the naming, pairing, cropping, redaction, and width rules.
- No key, token, e-mail, account ID, or absolute local path is in a tracked file.
- The two READMEs and the two CONTRIBUTING files agree on commands, routes, limits, and behaviour.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT license.
