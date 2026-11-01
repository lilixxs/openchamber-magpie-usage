# Contributing

## Scope

This is an OpenChamber guest extension: a sandboxed panel plus a local Node service. Changes must keep the panel and the service contract in sync. The panel may only use `host.*`; it cannot `fetch`, use XHR, touch browser storage, or dial the service directly.

## Local environment

- Bun 1.4 or newer.
- OpenChamber 2.5.0 or newer (the manifest declares `engines.openchamber >= 2.5.0`).
- A checkout of this repository.
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
- Both bundles are committed. A source change without a rebuilt bundle is incomplete.

The panel entry is `src/panel/main.ts` (`connectHost()` and mount). The implementation is `src/panel/app.ts` (`mountPanel`). Locale JSON files are imported by `app.ts` and inlined into `panel/main.js` at build time.

## Test

```bash
bun test
bun test tests/quotas.test.ts
bun run check   # typecheck -> all tests -> build
```

Tests are hermetic: fake gateway, temporary config directory, and real HTTP round-trips between the test client and the built service. Panel tests use a fake host and happy-dom; they start no HTTP server, connect to no real host, and do not touch the user's config directory.

CI runs `bun install --frozen-lockfile`, `bun run check`, and:

```bash
git diff --exit-code -- panel/main.js service/main.js
```

## Debugging

There is no development server. Build, then add this folder as a local extension in OpenChamber's **Settings → Extensions** and open the panel. The Configuration card and the `serviceStatus` badge are the first debugging surfaces.

The service needs both variables from the host:

```text
OPENCHAMBER_SERVICE_PORT
OPENCHAMBER_SERVICE_TOKEN
```

It binds only to `127.0.0.1`, requires `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN` on every request, and never logs the token. `GET /health` returns `{ ok, name, apiVersion }`. `GET /config` reports the effective endpoint, `apiKeyConfigured` (a boolean), `cardOrder`, `language`, and `languageInvalid`.

The service re-reads `config.json` on every request, so a corrected file applies without a restart. Language changes apply on the next panel refresh (default 60 seconds). Never put a token, API key, or upstream response body in a log, issue, or commit.

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

There is no publish or release script. CI is `.github/workflows/ci.yml`: Ubuntu, Bun 1.4.2, frozen lockfile, `bun run check`, and the bundle diff.

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

The README uses 24 images across 8 groups: install, usage (today/7d/30d), trend, quota cards (pooling and collapsed), balance cards (DeepSeek and openai-mm), error cards, ordering, and configuration/language.

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

This panel is packaged for a sandboxed iframe whose bundle test forbids `fetch` and `XMLHttpRequest`. Every locale file is therefore imported at build time:

```ts
import en from '../../panel/locales/en.json';
import localeIndex from '../../panel/locales/index.json';
import zhCN from '../../panel/locales/zh-CN.json';
```

Adding a language is a data change **plus imports and one map entry** in `src/panel/app.ts`, then a rebuild of `panel/main.js`. It is not a runtime drop-in like a web application. The registry is still the single list of `code`/`name`/`dir`; a new code that is not in the map cannot resolve.

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

- `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json`, or
- `~/.config/openchamber-magpie-usage/config.json` when `XDG_CONFIG_HOME` is absent. Windows uses the same `~/.config` layout, for example `%USERPROFILE%\.config\openchamber-magpie-usage\config.json`.

The file already holds the Magpie endpoint settings; add `language`:

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "language": "auto"
}
```

`language` is `auto`, `en`, or `zh-CN`. It is case-sensitive and must equal a `code` in `index.json`. `auto` follows the host locale on an exact match (`zh-CN` shows Simplified Chinese); every other host locale shows English.

The service reads the file on every request and returns `language` and `languageInvalid` in `GET /config`. The panel reads `/config` on every refresh cycle (default 60 seconds), so a language change applies on the next refresh without restarting the service or the app.

| Situation | Behaviour |
| --- | --- |
| `language` missing | `auto`; no notice. |
| `language` is not a non-empty string | `auto`; `languageInvalid` is true and the panel shows a notice with the path. The endpoint and key still apply. |
| A valid string not in `index.json` | `auto`; the panel shows `config.language.unsupported` with the path. |
| File missing | `auto`; the existing "No config file yet" note says the host language is used. |
| Invalid JSON | `auto`; the existing configuration issue says the host language is used. |
| Service unavailable | The panel stays on English; the service card shows the existing error. |

Uninstalling the extension leaves the config directory behind.

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
