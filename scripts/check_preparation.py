"""古典文法の予習資料を、X-style投稿単位で機械検査する。"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PREPARATION_DIR = ROOT / "data" / "preparation"
POST_CHAR_LIMIT = 280
CALLOUT_LABELS = {"board": "板書", "practice": "次の一歩", "check": "10秒確認"}
FORBIDDEN_CALLOUTS = {"point", "mistake"}


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
        opening = re.fullmatch(r":::(board|practice|point|check|mistake)(?:\s+\S+)?", line)
        if opening:
            callout = opening.group(1)
            output.append(CALLOUT_LABELS.get(callout, ""))
            continue
        if line == ":::" and callout:
            callout = None
            continue
        if callout == "check":
            check_match = re.match(r"^(question|choice|answer|explanation):\s*(.*)$", line)
            if check_match:
                if check_match.group(1) == "answer":
                    continue
                line = check_match.group(2)
                if check_match.group(1) == "choice" and "|" in line:
                    line = line.split("|", 1)[0] + " " + line.split("|", 1)[1]
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
        posts.extend(pack_blocks(intro.splitlines()))

    for heading, body in split_sections(normalized):
        posts.extend(pack_blocks([f"## {heading}", *body.splitlines()]))
    return posts


def source_blocks(lines: list[str]) -> list[list[str]]:
    """Markdownを、表示側の見出し・段落・板書・確認の単位へ分ける。"""
    blocks: list[list[str]] = []
    index = 0
    while index < len(lines):
        if not lines[index].strip():
            index += 1
            continue
        line = lines[index]
        if re.fullmatch(r"\s*:::(board|practice|check)(?:\s+\S+)?\s*", line):
            block = [line]
            index += 1
            while index < len(lines):
                block.append(lines[index])
                if lines[index].strip() == ":::":
                    index += 1
                    break
                index += 1
            blocks.append(block)
            continue
        block = [line]
        index += 1
        while index < len(lines) and lines[index].strip():
            if re.fullmatch(r"\s*:::(board|practice|check)(?:\s+\S+)?\s*", lines[index]):
                break
            block.append(lines[index])
            index += 1
        blocks.append(block)
    return blocks


def pack_blocks(lines: list[str]) -> list[str]:
    posts: list[str] = []
    current: list[str] = []
    current_chars = 0
    for block in source_blocks(lines):
        block_text = "\n".join(block)
        block_chars = len(visible_text(block_text))
        separator_chars = 1 if current else 0
        if current and current_chars + separator_chars + block_chars > POST_CHAR_LIMIT:
            posts.append("\n".join(current))
            current = []
            current_chars = 0
        current.append(block_text)
        current_chars += (1 if current_chars else 0) + block_chars
    if current:
        posts.append("\n".join(current))
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
