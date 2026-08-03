"""古典文法の予習資料を、X-style投稿単位で機械検査する。"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PREPARATION_DIR = ROOT / "data" / "preparation"
POST_CHAR_LIMIT = 280
CALLOUT_LABELS = {"board": "板書", "practice": "次の一歩"}
FORBIDDEN_CALLOUTS = {"point", "check", "mistake"}


def visible_text(markdown: str) -> str:
    """kobun-preparation.js の表示文字列に近い形で文字数を数える。"""
    output: list[str] = []
    callout: str | None = None
    for raw_line in markdown.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if re.fullmatch(r"!\[[^]]*\]\([^)]*\)", line):
            continue
        opening = re.fullmatch(r":::(board|practice|point|check|mistake)", line)
        if opening:
            callout = opening.group(1)
            output.append(CALLOUT_LABELS.get(callout, ""))
            continue
        if line == ":::" and callout:
            callout = None
            continue
        line = re.sub(r"^#{1,4}\s+", "", line)
        line = re.sub(r"^(?:[-*]|\d+\.)\s+", "", line)
        line = re.sub(r"^>\s?", "", line)
        line = line.replace("**", "").replace("`", "")
        if re.fullmatch(r"---+", line):
            continue
        if line:
            output.append(line)
    return "\n".join(output)


def split_sections(text: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"(?m)^##\s+(.+)$", text))
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections.append((match.group(1).strip(), text[match.end():end]))
    return sections


def split_rendered_posts(text: str) -> list[str]:
    """表示側が作るタイトル・導入・各 ## 投稿の検査単位を返す。"""
    normalized = text.replace("\r\n", "\n")
    title_match = re.search(r"(?m)^#\s+.+$", normalized)
    if not title_match:
        return []

    posts = [title_match.group(0)]
    cursor = title_match.end()
    if cursor < len(normalized):
        after_title = normalized[cursor:]
        image_match = re.match(r"\n?\s*!\[[^]]*\]\([^)]*\)\s*", after_title)
        if image_match:
            cursor += image_match.end()

    remaining = normalized[cursor:]
    first_section = re.search(r"(?m)^##\s+", remaining)
    intro = remaining if first_section is None else remaining[:first_section.start()]
    if visible_text(intro):
        posts.append(intro)

    posts.extend(f"## {heading}\n{body}" for heading, body in split_sections(normalized))
    return posts


def main() -> int:
    errors: list[str] = []
    files = sorted(PREPARATION_DIR.glob("*.md"))
    total_posts = 0
    max_chars = 0
    for path in files:
        text = path.read_text(encoding="utf-8")
        if not re.search(r"(?m)^#\s+\S", text):
            errors.append(f"{path.name}: # 見出しがない")
        for forbidden in sorted(FORBIDDEN_CALLOUTS):
            if re.search(rf"(?m)^:::{forbidden}\s*$", text):
                errors.append(f"{path.name}: 禁止された ::: {forbidden} が残っている")
        sections = split_sections(text)
        if not sections:
            errors.append(f"{path.name}: ## 投稿がない")
            continue

        rendered_posts = split_rendered_posts(text)
        total_posts += len(rendered_posts)
        for post_text in rendered_posts:
            count = len(visible_text(post_text))
            max_chars = max(max_chars, count)
            if count > POST_CHAR_LIMIT:
                errors.append(f"{path.name}: {count}字（上限{POST_CHAR_LIMIT}字）")

        for heading, body in sections:
            if not re.search(r"(?m)^:::board\s*$", body):
                errors.append(f"{path.name} / {heading}: :::board がない")

    print(f"Files: {len(files)}")
    print(f"Posts: {total_posts}")
    print(f"Max visible post chars: {max_chars}")
    if errors:
        print(f"ERROR: {len(errors)}")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Result: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
