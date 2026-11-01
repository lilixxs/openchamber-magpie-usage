# Translations

The panel reads its user-visible copy from `panel/locales/`. No UI string is
hard-coded in the panel source.

## Layout

| Path | Purpose |
| --- | --- |
| `panel/locales/index.json` | Registry: `code`, endonym `name`, and text `dir`. |
| `panel/locales/en.json` | English bundle. Also the fallback for every missing key. |
| `panel/locales/zh-CN.json` | Simplified Chinese bundle. |
| `src/i18n/messages.ts` | Interpolation, plural selection, fallback chain. |
| `src/i18n/locale.ts` | Registry parsing, locale resolution, bundle loading. |
| `src/panel/app.ts` | Imports every bundle and owns the active translator. |

## Bundling (read this before adding a language)

This panel is packaged for a sandboxed iframe whose bundle test forbids
`fetch` and `XMLHttpRequest`. Every locale file is therefore imported at build
time:

```ts
import en from '../../panel/locales/en.json';
import localeIndex from '../../panel/locales/index.json';
import zhCN from '../../panel/locales/zh-CN.json';
```

Adding a language is a data change **plus two import lines and one map entry**
in `src/panel/app.ts`, then a rebuild of `panel/main.js`. It is not a runtime
drop-in like a web application. The registry is still the single list of
`code`/`name`/`dir`; a new code that is not in the map cannot resolve.

## Keys

Keys are flat and dot-separated, for example `panel.subtitle` or
`quota.remaining`. There is no nesting.

Placeholders are written `{name}` and filled from the `vars` argument. A
placeholder with no value stays as written.

Every bundle must contain exactly the same non-plural keys as `en.json`.
Extra keys, missing keys, and differing placeholder sets fail `bun test`.

## Plurals

A pluralized string uses `key.one`, `key.other`, and any other CLDR category
the language needs. `Intl.PluralRules` is the only judge. Lookup order is
`key`, `key.<category>`, `key.other`, then the same chain in English, then the
key itself.

CLDR categories for locales this project is likely to add:

| Locale | Categories |
| --- | --- |
| `en` | `one`, `other` |
| `zh-CN`, `zh-TW`, `ja`, `ko` | `other` |
| `de`, `nl` | `one`, `other` |
| `fr`, `pt-BR`, `es` | `one`, `many`, `other` |
| `pl`, `uk` | `one`, `few`, `many`, `other` |
| `ar` | `zero`, `one`, `two`, `few`, `many`, `other` |

The test suite reads the categories from `Intl.PluralRules` at run time, so
the table above is orientation only.

## Adding a language

1. Copy `panel/locales/en.json` to `panel/locales/<code>.json` and translate the
   values. Keep keys and placeholders unchanged.
2. Add one line to `panel/locales/index.json`.
3. Import the JSON in `src/panel/app.ts`, add it to the `MESSAGES` map, and add
   its `code` to the registry-driven resolution. The map is the only place that
   knows which bundle files are packaged.
4. Run `bun install && bun run check`.

Tests enforce key parity, plural coverage, placeholder parity, and a valid
registry. `panel/main.js` must be rebuilt and committed; CI runs
`git diff --exit-code -- panel/main.js service/main.js`.

## Language configuration

There is no language control in the panel. The setting lives outside the
installed package, because the host replaces a git-installed package directory
on update:

- `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json`, or
- `~/.config/openchamber-magpie-usage/config.json` when `XDG_CONFIG_HOME` is
  absent. Windows uses the same `~/.config` layout, for example
  `C:\Users\<user>\.config\openchamber-magpie-usage\config.json`.

The file already holds the Magpie endpoint settings; add `language`:

```json
{
  "baseUrl": "http://127.0.0.1:3425",
  "refreshSeconds": 60,
  "language": "auto"
}
```

`language` is `auto`, `en`, or `zh-CN`. It is case-sensitive and must equal a
`code` in `index.json`. `auto` follows the host locale on an exact match
(`zh-CN` shows Simplified Chinese); every other host locale shows English.

The service reads the file on every request and returns `language` and
`languageInvalid` in `GET /config`. The panel reads `/config` on every refresh
cycle (default 60 seconds), so a language change applies on the next refresh
without restarting the service or the app.

| Situation | Behaviour |
| --- | --- |
| `language` missing | `auto`; no notice. |
| `language` is not a non-empty string | `auto`; `languageInvalid` is true and the panel shows a notice with the path. The endpoint and key still apply. |
| A valid string not in `index.json` | `auto`; the panel shows `config.language.unsupported` with the path. |
| File missing | `auto`; the existing "No config file yet" note says the host language is used. |
| Invalid JSON | `auto`; the existing configuration issue says the host language is used. |
| Service unavailable | The panel stays on English; the service card shows the existing error. |

Uninstalling the extension leaves the config directory behind.
