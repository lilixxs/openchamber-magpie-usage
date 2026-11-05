#!/usr/bin/env python3
"""Rebuild the bundled IBM Plex fonts for the panel.

The IBM Plex licence reserves the name "Plex". The Latin and mono files are
shipped unmodified and keep their original names. The Simplified Chinese file
is a modified version (a 3500-character subset), so it is renamed to
"Magpie Sans SC" and must not carry the reserved name in any name record.

Requires Python 3.10+, fonttools and brotli:
    python -m pip install fonttools brotli
    python tools/fonts/build.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
CHARS = Path(__file__).with_name("chars-3500.txt")
OUT = ROOT / "panel" / "fonts"

SANS_VERSION = "1.1.0"
SC_VERSION = "1.1.0"
MONO_VERSION = "2.5.0"

SANS_BASE = f"https://cdn.jsdelivr.net/npm/@ibm/plex-sans@{SANS_VERSION}/fonts/complete/woff2"
SC_BASE = f"https://cdn.jsdelivr.net/npm/@ibm/plex-sans-sc@{SC_VERSION}/fonts/complete/woff2/hinted"
MONO_BASE = f"https://cdn.jsdelivr.net/npm/@ibm/plex-mono@{MONO_VERSION}/fonts/complete/woff2"
LICENSE_URL = f"https://cdn.jsdelivr.net/npm/@ibm/plex-sans@{SANS_VERSION}/LICENSE.txt"

# nameID: value for each SC weight. IDs 0 (copyright), 13/14 (OFL) stay as IBM
# shipped them. "Plex" must not appear in any renamed record.
SC_NAMES = {
    "regular": {
        1: "Magpie Sans SC",
        2: "Regular",
        3: "Magpie;MagpieSansSC;1.000;subset",
        4: "Magpie Sans SC Regular",
        6: "MagpieSansSC-Regular",
        16: "Magpie Sans SC",
        17: "Regular",
        21: "Magpie Sans SC",
        22: "Regular",
    },
    "semibold": {
        1: "Magpie Sans SC",
        2: "SemiBold",
        3: "Magpie;MagpieSansSC-SemiBold;1.000;subset",
        4: "Magpie Sans SC SemiBold",
        6: "MagpieSansSC-SemiBold",
        16: "Magpie Sans SC",
        17: "SemiBold",
        21: "Magpie Sans SC",
        22: "SemiBold",
    },
}

SUBSET_ARGS = [
    "--flavor=woff2",
    "--no-hinting",
    "--layout-features=kern,liga,clig,calt,ccmp,locl,mark,mkmk",
    "--name-IDs=*",
    "--name-legacy",
    "--name-languages=*",
]

BUDGET = {
    "plex-sans-400.woff2": 80 * 1024,
    "plex-sans-600.woff2": 80 * 1024,
    "magpie-sans-sc-400.woff2": 500 * 1024,
    "magpie-sans-sc-600.woff2": 500 * 1024,
    "plex-mono-400.woff2": 60 * 1024,
    "plex-mono-500.woff2": 60 * 1024,
}


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"download {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        destination.write_bytes(response.read())


def subset_sc(source: Path, destination: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source),
            f"--output-file={destination}",
            f"--text-file={CHARS}",
            *SUBSET_ARGS,
        ],
        check=True,
    )


def rename_sc(path: Path, weight: str) -> None:
    font = TTFont(path)
    names = SC_NAMES[weight]
    for record in list(font["name"].names):
        if record.nameID in names:
            font["name"].setName(
                names[record.nameID],
                record.nameID,
                record.platformID,
                record.platEncID,
                record.langID,
            )
    font.flavor = "woff2"
    temporary = path.with_suffix(".renamed.woff2")
    font.save(temporary)
    temporary.replace(path)


def verify_sc(path: Path) -> None:
    font = TTFont(path)
    for record in font["name"].names:
        if record.nameID in (1, 4, 6, 16, 17, 21, 22):
            value = record.toUnicode()
            if "plex" in value.casefold():
                raise RuntimeError(f"{path.name}: reserved name still present in nameID {record.nameID}: {value!r}")
    license_text = next((r.toUnicode() for r in font["name"].names if r.nameID == 13), "")
    if "SIL Open Font License" not in license_text:
        raise RuntimeError(f"{path.name}: OFL name record missing")
    if "IBM" not in next((r.toUnicode() for r in font["name"].names if r.nameID == 0), ""):
        raise RuntimeError(f"{path.name}: IBM copyright record missing")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    chars = CHARS.read_text(encoding="utf-8").strip()
    if len(set(chars)) < 3500:
        raise RuntimeError(f"{CHARS} has only {len(set(chars))} unique characters")

    with tempfile.TemporaryDirectory(prefix="magpie-fonts-") as temporary:
        cache = Path(temporary)
        sources = {
            "sans_regular": (f"{SANS_BASE}/IBMPlexSans-Regular.woff2", cache / "sans-regular.woff2"),
            "sans_semibold": (f"{SANS_BASE}/IBMPlexSans-SemiBold.woff2", cache / "sans-semibold.woff2"),
            "mono_regular": (f"{MONO_BASE}/IBMPlexMono-Regular.woff2", cache / "mono-regular.woff2"),
            "mono_medium": (f"{MONO_BASE}/IBMPlexMono-Medium.woff2", cache / "mono-medium.woff2"),
            "sc_regular": (f"{SC_BASE}/IBMPlexSansSC-Regular.woff2", cache / "sc-regular.woff2"),
            "sc_semibold": (f"{SC_BASE}/IBMPlexSansSC-SemiBold.woff2", cache / "sc-semibold.woff2"),
        }
        for url, path in sources.values():
            download(url, path)

        LICENSE = cache / "LICENSE.txt"
        download(LICENSE_URL, LICENSE)

        outputs: dict[str, tuple[Path, str, str]] = {}

        for weight, source_key in (("regular", "sc_regular"), ("semibold", "sc_semibold")):
            subset = cache / f"sc-{weight}-subset.woff2"
            subset_sc(sources[source_key][1], subset)
            rename_sc(subset, weight)
            verify_sc(subset)
            destination = OUT / f"magpie-sans-sc-{400 if weight == 'regular' else 600}.woff2"
            destination.write_bytes(subset.read_bytes())
            outputs[destination.name] = (sources[source_key][0], "IBM Plex Sans SC subset; renamed Magpie Sans SC", "OFL-1.1")

        for name, source_key in (
            ("plex-sans-400.woff2", "sans_regular"),
            ("plex-sans-600.woff2", "sans_semibold"),
            ("plex-mono-400.woff2", "mono_regular"),
            ("plex-mono-500.woff2", "mono_medium"),
        ):
            destination = OUT / name
            destination.write_bytes(sources[source_key][1].read_bytes())
            outputs[destination.name] = (sources[source_key][0], "unmodified", "OFL-1.1")

        license_text = LICENSE.read_text(encoding="utf-8")
        (OUT / "OFL.txt").write_text(
            "\n".join(line.rstrip() for line in license_text.splitlines()) + "\n",
            encoding="utf-8",
        )

    notice = """# Bundled fonts

- `plex-sans-*.woff2` — IBM Plex Sans, unmodified, Copyright 2017 IBM Corp.
- `plex-mono-*.woff2` — IBM Plex Mono, unmodified, Copyright 2017 IBM Corp.
- `magpie-sans-sc-*.woff2` — a 3500-character subset of IBM Plex Sans SC,
  Copyright 2018 IBM Corp. The subset is a Modified Version under the SIL Open
  Font License 1.1 and is renamed **Magpie Sans SC** because IBM reserves the
  font name "Plex". The glyph outlines are unchanged; the character set,
  hinting instructions, OpenType layout features, and name records differ.

The full licence text is in `OFL.txt`. The subset is generated by
`tools/fonts/build.py` from the pinned IBM Plex npm versions recorded in
`manifest.json`; do not rename it back to an IBM Plex name.

IBM Plex is licensed under the SIL Open Font License, Version 1.1.
https://github.com/IBM/plex
"""
    (OUT / "NOTICE.md").write_text(notice, encoding="utf-8")

    manifest = {
        "chars": len(set(chars)),
        "subset": "3500 common Hanzi + CJK punctuation",
        "sources": {
            "@ibm/plex-sans": SANS_VERSION,
            "@ibm/plex-sans-sc": SC_VERSION,
            "@ibm/plex-mono": MONO_VERSION,
        },
        "license": "OFL-1.1",
        "files": [],
    }
    for path in sorted(OUT.glob("*.woff2")):
        source, modification, license_id = outputs[path.name]
        size = path.stat().st_size
        if size > BUDGET[path.name]:
            raise RuntimeError(f"{path.name}: {size} bytes exceeds budget {BUDGET[path.name]}")
        manifest["files"].append(
            {
                "name": path.name,
                "bytes": size,
                "sha256": sha256(path),
                "source": source,
                "modification": modification,
                "license": license_id,
            }
        )
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(item["bytes"] for item in manifest["files"])
    print(f"wrote {len(manifest['files'])} fonts, {total} bytes")
    for item in manifest["files"]:
        print(f"  {item['name']}: {item['bytes']} bytes")


if __name__ == "__main__":
    main()
