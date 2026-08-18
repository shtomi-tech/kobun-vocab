"""古文単語モードの機能・データ・参照が完全に削除されていることを機械検査する。

古典文法専用アプリへの再構築（.hermes/plans/2026-08-17_134428-grammar-only-rebuild.md）の
削除契約。実装前に実行して意図どおり FAIL することを確認し、実装後に PASS することを確認する。
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

GRAMMAR_STORE_KEYS = [
    "kobun-katsuyo-progress-v2",
    "kobun-katsuyo-path-v2",
    "kobun-preparation-progress-v1",
]
REQUIRED_SCRIPTS = [
    "static/mode-katsuyo.js",
    "static/kobun-preparation.js",
    "static/app.js",
]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def exists(path: str) -> bool:
    return (ROOT / path).exists()


def main() -> int:
    errors: list[str] = []

    index_html = read("index.html")
    if "static/mode-vocab.js" in index_html:
        errors.append("index.html が static/mode-vocab.js を読み込んでいる")
    for script in REQUIRED_SCRIPTS:
        if script not in index_html:
            errors.append(f"index.html が {script} を読み込んでいない")

    app_js = read("static/app.js")
    for forbidden in ("VocabApp", 'switchApp("vocab")', "APPS"):
        if forbidden in app_js:
            errors.append(f"static/app.js に {forbidden} が残っている")

    if exists("static/mode-vocab.js"):
        errors.append("static/mode-vocab.js が存在する")
    if exists("data/vocab.json"):
        errors.append("data/vocab.json が存在する")

    vocab_key_targets = ["index.html", "README.md"]
    static_dir = ROOT / "static"
    if static_dir.exists():
        vocab_key_targets.extend(
            str(p.relative_to(ROOT)).replace("\\", "/")
            for p in sorted(static_dir.glob("*.js"))
        )
    for target in vocab_key_targets:
        if not exists(target):
            continue
        if "kobun_vocab_" in read(target):
            errors.append(f"{target} に kobun_vocab_ 参照が残っている")

    for key in GRAMMAR_STORE_KEYS:
        found = any(
            key in read(target) for target in ("static/mode-katsuyo.js", "static/kobun-preparation.js")
        )
        if not found:
            errors.append(f"文法用の保存キー {key} が見つからない")

    print(f"Checked index.html, static/app.js and {len(vocab_key_targets)} file(s) for kobun_vocab_")
    if errors:
        print(f"ERROR: {len(errors)}")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Result: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
