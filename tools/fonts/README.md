# Bundled font build

`panel/fonts/` holds the six woff2 files the panel loads. They are committed;
the build does not run at install or in CI.

## Sources

- `@ibm/plex-sans@1.1.0` — IBM Plex Sans Regular/SemiBold, unmodified.
- `@ibm/plex-mono@2.5.0` — IBM Plex Mono Regular/Medium, unmodified.
- `@ibm/plex-sans-sc@1.1.0` — the Simplified Chinese source. The shipped files
  are a subset of the 3500 common characters in `chars-3500.txt` plus CJK
  punctuation. `chars-3500.txt` is the 1988 现代汉语常用字表 list taken from
  `zispace/hanzi-chars@0.18.0` (`data-charlist/《现代汉语常用字表》（1988年）.txt`),
  with duplicate and header lines removed; the 30 punctuation characters are
  appended by the project.

## Reserved font name

IBM Plex's OFL declares the Reserved Font Name "Plex". The Chinese file is a
Modified Version, so its name records are changed to **Magpie Sans SC** and the
CSS family is `Magpie Sans SC`. The Latin and mono files are unmodified and keep
their IBM Plex names. Do not rename the Chinese subset back to an IBM Plex name.

`panel/fonts/OFL.txt` and `panel/fonts/NOTICE.md` must ship with the files.

## Rebuild

Requires Python 3.10+, [fonttools](https://github.com/fonttools/fonttools) and
brotli. The script downloads the pinned npm packages, subsets, renames, verifies
the name records, writes `manifest.json`, and enforces the size budgets.

```bash
python -m pip install fonttools brotli
python tools/fonts/build.py
```

The expected output is six woff2 files, about 1.05 MB total:

| File | Approx. |
|---|---:|
| `plex-sans-400.woff2` / `plex-sans-600.woff2` | 63 / 67 KB |
| `magpie-sans-sc-400.woff2` / `...-600.woff2` | 415 / 430 KB |
| `plex-mono-400.woff2` / `plex-mono-500.woff2` | 49 / 50 KB |

The subset parameters and budgets live in `build.py`. `tests/fonts.test.ts`
checks the local URLs, file sizes, the renamed Chinese family, and the licence
files.
