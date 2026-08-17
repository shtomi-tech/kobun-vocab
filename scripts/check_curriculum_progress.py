#!/usr/bin/env python3
"""講・章単位の進捗集計（lessonStatus/chapterStatus/firstIncompleteLesson）と、
旧進捗（kobun-katsuyo-progress-v2）から46講版lessonCycles（kobun-katsuyo-path-v2）への
移行（migrateLessonProgress）の回帰テストを実行するラッパー。

実際の判定ロジックはJavaScript（static/mode-katsuyo.js）にあるため、Pythonからは直接呼べない。
scripts/check_curriculum_progress.mjs（Node）が、mode-katsuyo.jsを最小限のスタブ環境
（document/localStorage/fetch/windowをスタブしたvmコンテキスト）でそのまま実行し、
scripts/fixtures/curriculum-progress/ の固定fixtureに対して判定結果を検証する。
このスクリプトはそれをsubprocess経由で呼び出し、PASS/FAILを中継するだけ。

使い方: python scripts/check_curriculum_progress.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "scripts" / "check_curriculum_progress.mjs"


def main() -> int:
    if not RUNNER.exists():
        print(f"ERROR: {RUNNER} が存在しない", file=sys.stderr)
        return 1

    try:
        result = subprocess.run(
            ["node", str(RUNNER)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError:
        print("ERROR: node コマンドが見つからない（Node.jsが必要）", file=sys.stderr)
        return 1

    if result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", file=sys.stderr)

    if result.returncode == 0:
        print("check_curriculum_progress: OK")
    else:
        print(f"check_curriculum_progress: FAIL (node exit code {result.returncode})")
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
