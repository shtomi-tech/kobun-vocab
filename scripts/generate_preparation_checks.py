"""古文の予習Markdownへ、既存問題に根拠を持つ10秒確認を追加する。

予習Markdownを表示側の正本とし、問題JSONは読み取り専用で参照する。
未参照の旧資料には追加せず、現行ロードマップから使われる47ファイルだけを対象にする。
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PREPARATION_DIR = ROOT / "data" / "preparation"
REPORT_PATH = ROOT / "reports" / "preparation-check-map.json"


# mode-katsuyo.js の現行 PREPARATION_PATHS と対応する正本データ。
# 同じ資料を複数タスクから読む場合も、ファイル単位で1回だけ生成する。
FILE_SOURCES: dict[str, list[tuple[str, str]]] = {
    "kobun-01-yomi.md": [("kiso", "kiso-yomi")],
    "kobun-01-bunsetsu-hinshi.md": [("kiso", "kiso-bunsetsu")],
    "kobun-01-structure.md": [("kiso", "kiso-structure")],
    "kobun-01-katsuyokei-kakari.md": [("kiso", "kiso-katsuyokei")],
    "kobun-01-setsuzoku.md": [("kiso", "kiso-setsuzoku")],
    "kobun-02-katsuyo-type.md": [("kiso", "kiso-katsuyo-type")],
    "kobun-02-yougo-mikiwake.md": [("choice", "qa-chapter-2-type"), ("choice", "qa-chapter-2-form")],
    "kobun-02-yougo-practice.md": [("choice", "qa-chapter-2-form"), ("choice", "qa-chapter-2-yaku"), ("kiso", "kiso-katsuyokei")],
    "kobun-02-yougo-table.md": [("derived", "yougo-table")],
    "kobun-02-sound.md": [("kiso", "kiso-sound")],
    "kobun-02-yougo-yaku.md": [("choice", "qa-chapter-2-yaku")],
    "kobun-03-jodoshi-mizen.md": [("derived", "jodoshi-mizen")],
    "kobun-03-jodoshi-renyo.md": [("derived", "jodoshi-renyo")],
    "kobun-03-jodoshi-shushi.md": [("derived", "jodoshi-shushi")],
    "kobun-03-jodoshi-taigen.md": [("derived", "jodoshi-taigen")],
    "kobun-04-jodoshi-basic.md": [("derived", "jodoshi-basic")],
    "kobun-04-rareru.md": [("homograph", "sb-rareru")],
    "kobun-04-sasu.md": [("homograph", "sb-sasu")],
    "kobun-04-mu.md": [("homograph", "sb-mu")],
    "kobun-04-mashi.md": [("homograph", "sb-mashi")],
    "kobun-04-keri.md": [("homograph", "sb-keri")],
    "kobun-04-tsunu.md": [("homograph", "sb-tsunu")],
    "kobun-04-tariri.md": [("homograph", "sb-tariri")],
    "kobun-04-kemu.md": [("homograph", "sb-kemu")],
    "kobun-04-ramu.md": [("homograph", "sb-ramu")],
    "kobun-04-beshi.md": [("homograph", "sb-beshi")],
    "kobun-04-nari.md": [("homograph", "sb-nari")],
    "kobun-04-other.md": [("homograph", "sb-other")],
    "kobun-05-joshi-map.md": [("choice", "qa-chapter-7-basics")],
    "kobun-05-koou.md": [("choice", "qa-chapter-7-response")],
    "kobun-05-ba.md": [("joshi", "sb-ba")],
    "kobun-05-yori.md": [("joshi", "sb-yori")],
    "kobun-05-no.md": [("derived", "joshi-no")],
    "kobun-05-dani.md": [("joshi", "sb-dani")],
    "kobun-05-kakari.md": [("joshi", "sb-kakari")],
    "kobun-05-shuujoshi.md": [("joshi", "sb-shuujoshi")],
    "kobun-06-nune.md": [("homograph2", "sb-h-nune")],
    "kobun-06-rure.md": [("homograph2", "sb-h-rure")],
    "kobun-06-nari.md": [("homograph2", "sb-h-nari")],
    "kobun-06-namu.md": [("homograph2", "sb-h-namu")],
    "kobun-06-ni.md": [("homograph2", "sb-h-ni")],
    "kobun-07-keigo-map.md": [("keigo-choice", "qa-chapter-9")],
    "kobun-07-tamau.md": [("keigo", "sb-k-tamau")],
    "kobun-07-tatematsuru.md": [("keigo", "sb-k-tatematsuru")],
    "kobun-07-haberi.md": [("keigo", "sb-k-haberi")],
    "kobun-07-hojo.md": [("keigo", "sb-k-hojo")],
    "kobun-07-keii.md": [("keigo", "sb-k-keii")],
}


# 第1バッチは、見出しと問題の意味が近くても単なる位置順では決まらないため固定する。
# ここにないファイルは、見出し本文・板書・問題本文の語を使った順位付けで選ぶ。
QUESTION_OVERRIDES: dict[str, list[str]] = {
    "kobun-01-yomi.md": ["k-yomi-02", "k-yomi-03", "k-yomi-06", "k-yomi-07", "k-yomi-08"],
    "kobun-01-bunsetsu-hinshi.md": ["k-bun-01", "k-bun-02", "k-bun-03", "k-bun-04", "c1-001", "k-bun-06"],
    "kobun-01-structure.md": ["k-structure-01", "k-structure-02", "k-structure-03", "k-structure-04", "k-structure-05"],
    "kobun-01-katsuyokei-kakari.md": ["k-kei-01", "k-kei-02", "k-kei-04", "k-kei-07", "k-kei-05"],
    "kobun-01-setsuzoku.md": ["k-set-01", "c3-003", "c3-004", "c3-005", "k-set-06", "c5-005", "k-set-02", "k-set-10"],
    "kobun-02-katsuyo-type.md": ["k-katsuyo-01", "k-katsuyo-05"],
    "kobun-02-yougo-mikiwake.md": ["c2-001", "c2-018", "c2-019"],
    "kobun-02-yougo-practice.md": ["k-kei-02", "c2-003", "c2-027"],
    "kobun-02-sound.md": ["k-sound-03", "k-sound-02", "k-sound-04"],
    "kobun-02-yougo-yaku.md": ["c2-024", "c2-026", "c2-028"],
    "kobun-04-keri.md": ["sb-keri-int1", "pn-keri-int6", "pn-keri-int4"],
    "kobun-04-rareru.md": ["sb-rareru-int-kanou", "pn-rareru-shiraru", "sb-rareru-int-sonkei"],
    "kobun-04-mashi.md": ["pn-mashi-int4", "sb-mashi-int-tamerai", "src-jd07-q05"],
    "kobun-04-tariri.md": ["sb-tariri-int3", "sb-tariri-int1", "sb-tariri-int2"],
    "kobun-05-dani.md": ["jb-dani-int2", "jb-dani-int1"],
    "kobun-05-koou.md": ["c7-010", "c7-017", "c7-013"],
    "kobun-06-namu.md": ["hg-namu-int4", "hg-namu-int2", "hg-namu-int3", "hg-namu-int1"],
}


DATA_FILES = {
    "kiso": ("kiso.json", "kisoGroups", "kisoQuestions"),
    "choice": ("multiple_choice.json", "choiceGroups", "choiceQuestions"),
    "homograph": ("shikibetsu.json", "shikibetsuGroups", "shikibetsuQuestions"),
    "joshi": ("shikibetsu-joshi.json", "joshiGroups", "joshiQuestions"),
    "homograph2": ("shikibetsu-homograph.json", "homographGroups", "homographQuestions"),
    "keigo": ("shikibetsu-keigo.json", "keigoGroups", "keigoQuestions"),
    "keigo-choice": ("multiple_choice.json", "choiceGroups", "choiceQuestions"),
}


def clean_text(value: Any) -> str:
    if isinstance(value, list):
        value = "／".join(clean_text(item) for item in value)
    if isinstance(value, dict):
        value = "／".join(f"{clean_text(k)}: {clean_text(v)}" for k, v in value.items())
    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text.replace("?", "？").replace("|", "／")


def tokens(value: str) -> set[str]:
    text = clean_text(value).lower()
    found = re.findall(r"[a-z][a-z0-9_/-]*|[\u3040-\u30ff\u3400-\u9fff]+", text)
    result: set[str] = set()
    separators = r"(?:は|の|を|と|で|に|が|へ|や|も|より|から|まで|・|／|、|,|：|:|\(|\)|（|）|＋|＝|→)"
    for token in found:
        candidates = {token}
        candidates.update(part for part in re.split(separators, token) if part)
        result.update(candidate for candidate in candidates if len(candidate) > 1)
    return result


def shorten_text(value: Any, limit: int) -> str:
    text = clean_text(value)
    if len(text) <= limit:
        return text
    pieces = re.split(r"(?<=[。！？])", text)
    result = ""
    for piece in pieces:
        if not piece:
            continue
        if len(result) + len(piece) > limit:
            break
        result += piece
    if result:
        return result
    return text[: max(1, limit - 1)].rstrip() + "…"


def question_text(question: dict[str, Any]) -> str:
    return " ".join(
        clean_text(question.get(key, ""))
        for key in (
            "topic",
            "step",
            "question",
            "passage",
            "target",
            "explanation",
            "ruleRefs",
            "choices",
        )
    )


def make_candidate(
    question_id: str,
    question: str,
    choices: list[str],
    answer_index: int,
    explanation: str,
    source_ref: str,
    rule_refs: list[str] | None = None,
    review_status: str = "source-question",
    passage: str = "",
    target: str = "",
) -> dict[str, Any]:
    return {
        "id": question_id,
        "question": clean_text(question),
        "choices": [clean_text(choice) for choice in choices],
        "answerIndex": int(answer_index),
        "explanation": clean_text(explanation),
        "sourceRef": source_ref,
        "ruleRefs": rule_refs or [],
        "reviewStatus": review_status,
        "passage": clean_text(passage),
        "target": clean_text(target),
    }


def group_candidates(data: dict[str, Any], source_type: str, group_id: str) -> list[dict[str, Any]]:
    filename, groups_key, questions_key = DATA_FILES[source_type]
    group_key = "id"
    groups = {str(group[group_key]): group for group in data[filename][groups_key]}
    questions = {str(question["id"]): question for question in data[filename][questions_key]}
    group = groups.get(group_id)
    if not group:
        raise KeyError(f"group not found: {source_type}/{group_id}")
    candidates: list[dict[str, Any]] = []
    for question_id in group["ids"]:
        question = questions.get(str(question_id))
        if not question:
            continue
        candidates.append(
            make_candidate(
                str(question["id"]),
                question.get("question", ""),
                question.get("choices", []),
                question.get("answerIndex", 0),
                question.get("explanation", ""),
                f"data/{filename}:{question['id']}",
                question.get("ruleRefs", []),
                "source-question",
                question.get("passage", ""),
                question.get("target", ""),
            )
        )
    return candidates


def derived_candidates(data: dict[str, Any], source_id: str) -> list[dict[str, Any]]:
    jodoshi = data["jodoshi.json"]["jodoshi"]
    by_name = {item["kihon"]: item for item in jodoshi}

    if source_id == "yougo-table":
        katsuyo = data["katsuyo.json"]
        verbs = {item["kihon"]: item for item in katsuyo["verbs"]}
        adjectives = {item["kihon"]: item for item in katsuyo["adjectives"]}
        adjectival_verbs = {item["kihon"]: item for item in katsuyo["adjectivalVerbs"]}
        return [
            make_candidate(
                "derived-yougo-table-verb",
                "「書く」の活用の種類はどれ？",
                [verbs["書く"]["type"], verbs["着る"]["type"]],
                0,
                "「書く」は未然形「か」から命令形「け」まで四つの段にまたがる四段型です。",
                "data/katsuyo.json:verbs.v-yodan-kaku",
                ["kbp.verbs.yodan-nidan-identification"],
                "derived-from-preparation-and-data",
            ),
            make_candidate(
                "derived-yougo-table-irregular",
                "「あり」の活用の種類はどれ？",
                [verbs["あり"]["type"], verbs["書く"]["type"]],
                0,
                "「あり」はラ行変格活用です。終止形「り」と連体形「る」が分かれる形を表全体で確認します。",
                "data/katsuyo.json:verbs.v-rahen-ari",
                [],
                "derived-from-preparation-and-data",
            ),
            make_candidate(
                "derived-yougo-table-adjective",
                "「静かなり」の活用の種類はどれ？",
                [adjectival_verbs["静かなり"]["type"], adjectives["高し"]["type"]],
                0,
                "「静かなり」はナリ活用の形容動詞です。連用形に「なり・に」が現れることも表で確認します。",
                "data/katsuyo.json:adjectivalVerbs.adjv-nari-shizuka",
                [],
                "derived-from-preparation-and-data",
            ),
        ]

    if source_id == "jodoshi-mizen":
        return [
            make_candidate(
                "derived-jodoshi-mizen-list",
                "未然形に接続する助動詞の組み合わせはどれ？",
                ["る・らる・す・さす・しむ", "き・けり・つ・ぬ・たり"],
                0,
                "未然形接続には、る・らる・す・さす・しむ・ず・じ・む・むず・まし・まほしが入ります。",
                "data/jodoshi.json:groups.g1",
                [],
                "derived-from-preparation",
            ),
            make_candidate(
                "derived-jodoshi-mizen-type",
                "「る・らる・す・さす・しむ」の活用型はどれ？",
                [by_name["る"]["type"], by_name["き"]["type"]],
                0,
                "この五語は下二段型で、代表の「る」の活用を基準に形を確認します。",
                "data/jodoshi.json:jodoshi.る",
                [],
                "derived-from-preparation-and-data",
            ),
            make_candidate(
                "derived-jodoshi-mizen-special",
                "「ず」の活用を考えるときに確認する系列はどれ？",
                ["ず・ざら／ざり・ざる・ざれの二系列", "けら・けり・ける・けれの一系列"],
                0,
                "「ず」には「ず」と「ざり」の二系列があり、下に助動詞が続く形も確認します。",
                "data/jodoshi.json:jodoshi.ず",
                [],
                "derived-from-preparation-and-data",
            ),
        ]

    if source_id == "jodoshi-renyo":
        tsu = by_name["つ"]
        ki = by_name["き"]
        return [
            make_candidate(
                "derived-jodoshi-renyo-list",
                "連用形に接続する助動詞の組み合わせはどれ？",
                ["き・けり・つ・ぬ・たり", "らし・べし・まじ・らむ・めり"],
                0,
                "連用形接続は、き・けり・つ・ぬ・たり・けむ・たしです。上の語を連用形にできるかを先に見ます。",
                "data/jodoshi.json:groups.g2",
                [],
                "derived-from-preparation",
            ),
            make_candidate(
                "derived-jodoshi-renyo-forms",
                "助動詞「つ」の連体形・已然形はどれ？",
                [f"{tsu['forms'][3][0]}・{tsu['forms'][4][0]}", "ぬる・ぬれ"],
                0,
                "「つ」は下二段型で、連体形「つる」、已然形「つれ」となります。",
                "data/jodoshi.json:jodoshi.つ",
                [],
                "derived-from-preparation-and-data",
            ),
            make_candidate(
                "derived-jodoshi-renyo-ki",
                "助動詞「き」の特殊な形として正しいものはどれ？",
                [f"未然形「{ki['forms'][0][0]}」・連体形「{ki['forms'][3][0]}」・已然形「{ki['forms'][4][0]}」", "未然形「き」・連体形「きる」・已然形「きれ」"],
                0,
                "「き」は未然形「せ」、連体形「し」、已然形「しか」という特殊な形を持ちます。",
                "data/jodoshi.json:jodoshi.き",
                [],
                "derived-from-preparation-and-data",
            ),
            make_candidate(
                "derived-jodoshi-renyo-ri",
                "助動詞「り」の接続として正しいものはどれ？",
                ["サ変動詞の未然形・四段動詞の已然形", "すべての動詞の連用形"],
                0,
                "「り」はサ変の未然形、四段の已然形に接続します。意味は完了・存続で「たり」と近いものです。",
                "data/jodoshi.json:jodoshi.り",
                [],
                "derived-from-preparation-and-data",
            ),
        ]

    if source_id == "jodoshi-shushi":
        beshi = by_name["べし"]
        return [
            make_candidate(
                "derived-jodoshi-shushi-list",
                "終止形に接続する助動詞の組み合わせはどれ？",
                ["らし・べし・まじ・らむ・なり・めり", "ず・じ・む・まし・まほし"],
                0,
                "終止形接続は、らし・べし・まじ・らむ・なり・めりです。ラ変型の後ろでは連体形接続になる例外に注意します。",
                "data/jodoshi.json:groups.g3",
                [],
                "derived-from-preparation",
            ),
            make_candidate(
                "derived-jodoshi-shushi-rahen",
                "ラ変型の語の後ろで、終止形接続の助動詞が付く形はどれ？",
                ["連体形", "未然形"],
                0,
                "「あり・をり・はべり」などラ変型の語の後ろでは、助動詞は連体形に接続します。",
                "data/jodoshi.json:groups.g3",
                [],
                "derived-from-preparation",
            ),
            make_candidate(
                "derived-jodoshi-shushi-type",
                "「べし・まじ」の活用型として正しいものはどれ？",
                [beshi["type"], by_name["らし"]["type"]],
                0,
                "「べし・まじ」は形容詞型の活用をします。「べから・べかり」の系列も一緒に確認します。",
                "data/jodoshi.json:jodoshi.べし",
                [],
                "derived-from-preparation-and-data",
            ),
        ]

    if source_id == "jodoshi-taigen":
        return [
            make_candidate(
                "derived-jodoshi-taigen-list",
                "体言・連体形などに接続する助動詞の組み合わせはどれ？",
                ["なり・たり・ごとし", "き・けり・つ"],
                0,
                "体言・連体形などに接続する三語は、なり・たり・ごとしです。上の語の形を見て切り分けます。",
                "data/jodoshi.json:groups.g4",
                [],
                "derived-from-preparation",
            ),
            make_candidate(
                "derived-jodoshi-taigen-forms",
                "断定の「なり・たり」の連用形として正しい組み合わせはどれ？",
                ["なり・に／たり・と", "なら・なる／たら・たる"],
                0,
                "断定の「なり・たり」は形容動詞型で、連用形に「に」「と」が現れます。",
                "data/jodoshi.json:jodoshi.なり・たり",
                [],
                "derived-from-preparation",
            ),
        ]

    if source_id == "jodoshi-basic":
        return [
            make_candidate(
                "derived-jodoshi-basic-keri",
                "直接経験した過去を表す助動詞はどれ？",
                ["き", "けり"],
                0,
                "「き」は話し手の直接経験した過去、「けり」は伝聞・間接経験や詠嘆が基本です。",
                "data/kiso.json:kiso-jodoshi-zu〜kiso-jodoshi-shushi",
                ["kbp.auxiliaries.keri-meanings"],
                "derived-from-preparation-and-principles",
            ),
            make_candidate(
                "derived-jodoshi-basic-tari",
                "結果の状態が残っているときに考える意味はどれ？",
                ["存続", "完了"],
                0,
                "動作が終わったことを示すのが完了、終わった結果の状態が続くことを示すのが存続です。",
                "data/kiso.json:kiso-jodoshi-zu〜kiso-jodoshi-shushi",
                ["kbp.auxiliaries.tari-ri-meanings"],
                "derived-from-preparation-and-principles",
            ),
            make_candidate(
                "derived-jodoshi-basic-meaning",
                "打消の助動詞「ず」の基本訳はどれ？",
                ["〜ない", "〜たい"],
                0,
                "「ず」は打消を表し、基本的には「〜ない」と訳します。形が変わる場合は接続も確認します。",
                "data/kiso.json:c5-010",
                [],
                "source-question",
            ),
        ]

    if source_id == "joshi-no":
        return [
            make_candidate(
                "derived-joshi-no-relation",
                "「が・の」の下に名詞が続き、その名詞を説明している用法はどれ？",
                ["連体格", "主格"],
                0,
                "後ろの名詞を説明していれば連体格、動作主や主体を表していれば主格を考えます。",
                "data/preparation/kobun-05-no.md:1",
                ["kbp.particles.ga-no-case-functions"],
                "derived-from-preparation-and-principles",
            ),
            make_candidate(
                "derived-joshi-no-juntaikaku",
                "名詞が省略され、「〜のもの・こと」と受ける用法はどれ？",
                ["準体格", "同格"],
                0,
                "名詞相当の内容を受けるなら準体格、前後が同じものを説明していれば同格を考えます。",
                "data/preparation/kobun-05-no.md:2",
                ["kbp.particles.ga-no-case-functions"],
                "derived-from-preparation-and-principles",
            ),
        ]

    raise KeyError(f"derived source not found: {source_id}")


def load_data() -> dict[str, Any]:
    names = {
        "kiso.json",
        "multiple_choice.json",
        "shikibetsu.json",
        "shikibetsu-joshi.json",
        "shikibetsu-homograph.json",
        "shikibetsu-keigo.json",
        "jodoshi.json",
        "katsuyo.json",
    }
    return {name: json.loads((ROOT / "data" / name).read_text(encoding="utf-8")) for name in names}


def source_candidates(data: dict[str, Any], source_type: str, source_id: str) -> list[dict[str, Any]]:
    if source_type == "derived":
        return derived_candidates(data, source_id)
    return group_candidates(data, source_type, source_id)


def parse_sections(raw: str) -> list[dict[str, Any]]:
    lines = raw.splitlines()
    headings = [(index, match.group(1).strip()) for index, line in enumerate(lines) if (match := re.match(r"^##\s+(.+?)\s*$", line))]
    sections: list[dict[str, Any]] = []
    for position, (start, title) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        body = lines[start + 1 : end]
        sections.append({"title": title, "start": start, "end": end, "body": body})
    return sections


def find_wrong_choice(question: dict[str, Any], answer_index: int) -> str:
    choices = [clean_text(choice) for choice in question.get("choices", [])]
    correct = choices[answer_index] if 0 <= answer_index < len(choices) else ""
    rationale = question.get("distractorRationale", {})
    if isinstance(rationale, dict):
        for choice in rationale:
            cleaned = clean_text(choice)
            if cleaned and cleaned != correct:
                return cleaned
    return next((choice for choice in choices if choice and choice != correct), "誤った判断")


def make_question_line(question: dict[str, Any]) -> str:
    passage = clean_text(question.get("passage", ""))
    target = clean_text(question.get("target", ""))
    base = clean_text(question.get("question", ""))
    if passage:
        if target:
            base = f"「{target}」の働き・意味として適切なのは？"
        else:
            base = base or "例文の判断として適切なのは？"
        base += f" 例文：{passage}"
    return shorten_text(base or "上の説明に当てはまるものは？", 120)


def make_check(unit: str, index: int, question: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    choices = [clean_text(choice) for choice in question.get("choices", []) if clean_text(choice)]
    answer_index = int(question.get("answerIndex", 0))
    if not choices:
        choices = ["正しい", "誤り"]
        answer_index = 0
    answer_index = max(0, min(answer_index, len(choices) - 1))
    correct = choices[answer_index]
    wrong = find_wrong_choice(question, answer_index)
    if wrong == correct:
        wrong = "別の意味・働き"
    answer_key = "A" if index % 2 == 1 else "B"
    wrong_key = "B" if answer_key == "A" else "A"
    explanation = shorten_text(question.get("explanation", ""), 130)
    if not explanation:
        explanation = "上の板書と、直前の語の形・文中の働きを照合します。"
    check_id = f"check-{unit}-{index:02d}"
    block = "\n".join(
        [
            f":::check {check_id}",
            f"question: {make_question_line(question)}",
            f"choice: {answer_key}|{correct}",
            f"choice: {wrong_key}|{wrong}",
            f"answer: {answer_key}",
            f"explanation: {explanation}",
            ":::",
        ]
    )
    record = {
        "checkId": check_id,
        "sourceId": str(question.get("id", "")),
        "sourceRef": question.get("sourceRef", ""),
        "reviewStatus": question.get("reviewStatus", "source-question"),
        "ruleRefs": question.get("ruleRefs", []),
        "answer": answer_key,
        "correctChoice": correct,
        "wrongChoice": wrong,
    }
    return block, record


def add_checks(raw: str, filename: str, data: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    sections = parse_sections(raw)
    if not sections:
        return raw, []
    sources = FILE_SOURCES[filename]
    candidates: list[dict[str, Any]] = []
    for source_type, source_id in sources:
        candidates.extend(source_candidates(data, source_type, source_id))
    if not candidates:
        raise ValueError(f"no source candidates: {filename}")

    lines = raw.splitlines()
    selected: list[dict[str, Any]] = []
    used: set[str] = set()
    insertions: list[tuple[int, str]] = []
    question_by_id = {str(candidate["id"]): candidate for candidate in candidates}
    overrides = QUESTION_OVERRIDES.get(filename, [])
    ordered_derived = any(source_type == "derived" for source_type, _ in sources)
    for section_index, section in enumerate(sections, start=1):
        body_text = " ".join(section["body"])
        section_text = f"{section['title']} {body_text}"
        section_tokens = tokens(section_text)
        override_id = overrides[section_index - 1] if section_index <= len(overrides) else ""
        if override_id and override_id in question_by_id:
            question = question_by_id[override_id]
        elif ordered_derived:
            question = candidates[(section_index - 1) % len(candidates)]
        else:
            available = [candidate for candidate in candidates if str(candidate["id"]) not in used]
            pool = available or candidates
            ranked: list[tuple[int, int, dict[str, Any]]] = []
            for candidate_index, candidate in enumerate(pool):
                candidate_tokens = tokens(question_text(candidate))
                score = len(section_tokens & candidate_tokens) * 10
                if candidate.get("target") and candidate["target"] in section_text:
                    score += 80
                score += max(0, 12 - abs(candidate_index - section_index) * 2)
                ranked.append((score, -candidate_index, candidate))
            ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
            question = ranked[0][2]
        used.add(str(question["id"]))
        block, record = make_check(Path(filename).stem, section_index, question)
        record.update({"file": filename, "heading": section["title"], "sectionIndex": section_index})
        selected.append(record)

        insert_at = section["end"]
        for line_index in range(section["start"] + 1, section["end"]):
            if lines[line_index].strip() == ":::practice":
                insert_at = line_index
                break
        insertions.append((insert_at, block))

    for insert_at, block in reversed(insertions):
        prefix = lines[:insert_at]
        suffix = lines[insert_at:]
        while prefix and not prefix[-1].strip():
            prefix.pop()
        if prefix:
            prefix.append("")
        prefix.extend(block.splitlines())
        prefix.append("")
        lines = prefix + suffix
    return "\n".join(lines).rstrip() + "\n", selected


def remove_generated_checks(raw: str, filename: str) -> str:
    unit = re.escape(Path(filename).stem)
    return re.sub(rf"\n*:::check check-{unit}-\d+\n.*?\n:::\n*", "\n\n", raw, flags=re.S)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="予習Markdownへ書き込む")
    parser.add_argument("--remove-generated", action="store_true", help="このスクリプトが生成したチェックを取り除く")
    parser.add_argument("--files", help="対象ファイル名をカンマ区切りで指定")
    args = parser.parse_args()

    data = load_data()
    wanted = {item.strip() for item in args.files.split(",")} if args.files else set(FILE_SOURCES)
    unknown = wanted - set(FILE_SOURCES)
    if unknown:
        raise SystemExit(f"UNKNOWN_FILES={','.join(sorted(unknown))}")

    report: dict[str, Any] = {}
    if REPORT_PATH.exists():
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    entries: list[dict[str, Any]] = report.get("checks", []) if isinstance(report, dict) else []
    by_id = {entry.get("checkId"): entry for entry in entries if isinstance(entry, dict)}
    total = 0

    for filename in sorted(wanted):
        path = PREPARATION_DIR / filename
        raw = path.read_text(encoding="utf-8")
        if args.remove_generated:
            updated = remove_generated_checks(raw, filename)
            if args.apply and updated != raw:
                path.write_text(updated, encoding="utf-8", newline="\n")
            print(f"REMOVE {filename}: {raw.count(f'check-{Path(filename).stem}-')}")
            continue
        if re.search(r"(?m)^:::check(?:\s|$)", raw):
            print(f"SKIP {filename}: existing checks")
            continue
        updated, selected = add_checks(raw, filename, data)
        print(f"{filename}: {len(selected)} checks")
        for entry in selected:
            print(f"  {entry['heading']} <= {entry['sourceId']} [{entry['reviewStatus']}]")
            by_id[entry["checkId"]] = entry
        if args.apply:
            path.write_text(updated, encoding="utf-8", newline="\n")
        total += len(selected)

    if args.apply and not args.remove_generated:
        REPORT_PATH.write_text(
            json.dumps({"version": 1, "checks": sorted(by_id.values(), key=lambda item: item["checkId"])}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    print(f"TOTAL_CHECKS={total}")
    print("MODE=APPLY" if args.apply else "MODE=DRY_RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
