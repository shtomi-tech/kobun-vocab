"""4択・識別問題を採点し、評価の低い問題の退役(retire)を管理する。

採点は100点からの減点で、減点には必ず理由コードが付く。退役は正本JSONの
該当問題に1行の "retired" を差し込むだけで、行を消せば元に戻る。アプリは
読み込み時に retired を除外する(static/mode-katsuyo.js の pruneRetired)。

既に scripts/quality_check.py --check が「正解が一意に最長」「誤答根拠の
欠落」「重複」「必修ルートの整合」をエラーとして止めているので、ここでは
その先の、程度問題として残る弱さだけを採点する。

使い方:
  py -3 scripts/score_questions.py --output reports/question-quality.md \
      --json reports/question-quality.json
  py -3 scripts/score_questions.py --propose --limit 20
  py -3 scripts/score_questions.py --apply --ids c2-013 --note "..."
  py -3 scripts/score_questions.py --restore --ids c2-013
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_rule_coverage import load_cards  # noqa: E402


def _allowed_longest() -> set[str]:
    """quality_check.py の許容リストを読む。

    同ファイルは import 時に sys.stdout を差し替えるので、import せずに
    構文木から定数だけを取り出す。
    """
    import ast

    source = (Path(__file__).resolve().parent / "quality_check.py").read_text(encoding="utf-8")
    for node in ast.parse(source).body:
        targets = getattr(node, "targets", [])
        if targets and getattr(targets[0], "id", "") == "ALLOWED_LONGEST":
            return set(ast.literal_eval(node.value))
    return set()


# 「正解が一意に最長」だが内容上避けられないと既に判断済みの問題。
ALLOWED_LONGEST = _allowed_longest()

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

# (ファイル名, 問題配列キー, 必修IDキー, グループ配列キー)
SOURCES = [
    ("multiple_choice.json", "choiceQuestions", "choiceRequiredQuestionIds", "choiceGroups"),
    ("kiso.json", "kisoQuestions", "kisoRequiredQuestionIds", "kisoGroups"),
    ("shikibetsu.json", "shikibetsuQuestions", "requiredQuestionIds", "shikibetsuGroups"),
    ("shikibetsu-joshi.json", "joshiQuestions", "joshiRequiredQuestionIds", "joshiGroups"),
    ("shikibetsu-homograph.json", "homographQuestions", "homographRequiredQuestionIds", "homographGroups"),
    ("shikibetsu-keigo.json", "keigoQuestions", "keigoRequiredQuestionIds", "keigoGroups"),
]

AXES = [
    ("A", "正答の妥当性", 35),
    ("B", "誤答の質", 20),
    ("C", "手掛かり漏れ", 15),
    ("D", "解説の質", 15),
    ("E", "重複・冗長", 15),
]
AXIS_MAX = {key: points for key, _title, points in AXES}

DEFAULT_THRESHOLD = 75
MAX_PER_APPLY = 20

# 解説が判断手順を残しているかの目印。正答の言い換えだけの解説には出ない。
PROCEDURE_MARKERS = (
    "まず", "次に", "ので", "から", "ため", "判断", "確認", "区別", "見分け",
    "かどうか", "接続", "活用形", "位置", "文脈", "係り", "直前", "直後", "直下",
)
# 文法上の理由になっていない退け方。共通の作問原則4で禁止している。
HAND_WAVE = ("不自然だから", "そういうもの", "語呂", "覚えるしかない", "慣用だから")
ABSOLUTE_WORDS = ("必ず", "すべて", "絶対に", "いつも", "決して")
NEGATIVE_STEM = ("誤っているもの", "適切でないもの", "当てはまらないもの", "例外")


def normalize(text: object) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def trigrams(text: str) -> set[str]:
    body = normalize(text)
    return {body[i:i + 3] for i in range(max(0, len(body) - 2))}


def similarity(a: str, b: str) -> float:
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


COVERAGE_KEYS = {
    "shikibetsu.json": "coverageTopics",
    "shikibetsu-joshi.json": "joshiCoverageTopics",
    "shikibetsu-homograph.json": "homographCoverageTopics",
    "shikibetsu-keigo.json": "keigoCoverageTopics",
}


def load_all() -> list[dict]:
    """全ソースの問題に、出所・グループ・必修・カバレッジの情報を付けて返す。"""
    questions = []
    for fname, qkey, rkey, gkey in SOURCES:
        data = json.loads((DATA / fname).read_text(encoding="utf-8"))
        required = set(data.get(rkey, []))
        group_of = {}
        for group in data.get(gkey, []):
            for qid in group.get("ids", []):
                group_of[qid] = group.get("id")
        coverage_of = {}
        for topic in data.get(COVERAGE_KEYS.get(fname, ""), []) or []:
            for item in topic.get("items", []):
                coverage_of[item.get("id")] = (topic.get("topic", ""), item.get("label", ""))
        for question in data.get(qkey, []):
            topic_label = coverage_of.get(question.get("id"), ("", ""))
            question["_file"] = fname
            question["_required"] = question.get("id") in required
            question["_group"] = group_of.get(question.get("id"), "")
            question["_coverageTopic"], question["_coverageLabel"] = topic_label
            questions.append(question)
    return questions


def answer_indexes(question: dict) -> list[int]:
    if question.get("questionType") == "multi-select":
        return [i for i in question.get("answerIndices") or [] if isinstance(i, int)]
    index = question.get("answerIndex")
    return [index] if isinstance(index, int) else []


def score_questions(questions: list[dict]) -> list[dict]:
    cards = load_cards()
    active = {rid for rid, card in cards.items() if card.get("status") == "active"}

    # 同じ選択肢に同じ説明を付けるのは自然なので、別の選択肢に同じ文言を
    # 使い回している場合だけを「型どおりの誤答根拠」として数える。
    rationale_choices: dict[str, set[str]] = collections.defaultdict(set)
    for question in questions:
        for choice, note in (question.get("distractorRationale") or {}).items():
            rationale_choices[normalize(note)].add(normalize(choice))

    results: dict[str, dict] = {}
    for question in questions:
        qid = question.get("id", "?")
        deductions: list[dict] = []

        def deduct(axis: str, code: str, points: int, note: str) -> None:
            deductions.append({"axis": axis, "code": code, "points": points, "note": note})

        choices = question.get("choices") or []
        answers = answer_indexes(question)
        answer_text = choices[answers[0]] if answers and answers[0] < len(choices) else ""
        stem = str(question.get("question") or "")
        explanation = str(question.get("explanation") or "")

        # A: 正答の妥当性
        refs = question.get("ruleRefs") or []
        if not refs:
            deduct("A", "no-rule-ref", 8, "正答の根拠となる原則カードが無い")
        for ref in refs:
            if ref not in cards:
                deduct("A", "unknown-rule-ref", 15, f"原則カードが見つからない: {ref}")
            elif ref not in active:
                deduct("A", "inactive-rule-ref", 10, f"active ではない: {ref}")
        if not choices or not answers:
            deduct("A", "broken-choices", 35, "選択肢または正答が壊れている")
        # 複数選択の「すべて選べ」は正しい指示なので、断定語として数えない。
        if question.get("questionType") != "multi-select" and any(word in stem for word in ABSOLUTE_WORDS):
            deduct("A", "absolute-wording", 4, "設問に「必ず」「すべて」などの断定語がある")
        if any(word in stem for word in NEGATIVE_STEM):
            deduct("A", "negative-stem", 3, "否定形の設問になっている")
        if answer_text and len(answer_text) >= 4:
            shared = [chunk for chunk in trigrams(answer_text) if chunk in normalize(stem)]
            others = [c for i, c in enumerate(choices) if i not in answers]
            if shared and others and not any(
                any(chunk in normalize(c) for chunk in shared) for c in others
            ):
                deduct("A", "word-repeat-cue", 6, "設問中の語が正答だけに繰り返されている")

        # B: 誤答の質
        rationale = question.get("distractorRationale") or {}
        thin = sum(1 for note in rationale.values() if len(normalize(note)) < 12)
        if thin:
            deduct("B", "thin-rationale", min(9, 3 * thin), f"誤答根拠が短いものが {thin} 個")
        reused = sum(
            1
            for choice, note in rationale.items()
            if len(rationale_choices[normalize(note)] - {normalize(choice)}) >= 2
        )
        if reused:
            deduct("B", "template-rationale", 5, f"別の選択肢にも同じ文言を使った誤答根拠が {reused} 個")
        # 語を並べた選択肢は長さを揃えようがないので、文・句のときだけ見る。
        if answer_text and choices and sum(len(c) for c in choices) / len(choices) > 8:
            base = len(answer_text)
            mismatch = sum(
                1
                for i, c in enumerate(choices)
                if i not in answers and base and not (base / 2 <= len(c) <= base * 2)
            )
            if mismatch:
                deduct("B", "distractor-shape-mismatch", min(6, 3 * mismatch), f"長さが比較にならない誤答が {mismatch} 個")

        # C: 手掛かり漏れ(選択肢はアプリ側でシャッフルされるので、位置は見ない)
        # 語を並べた選択肢は長さを揃えようがなく、長さが手掛かりにもならない。
        # 文・句で答える問題だけを長さの対象にする。
        wordy = bool(choices) and sum(len(c) for c in choices) / len(choices) > 8
        if qid in ALLOWED_LONGEST:
            wordy = False
        if wordy and choices and answers and len(answers) == 1:
            lengths = [len(c) for c in choices]
            index = answers[0]
            others = [length for i, length in enumerate(lengths) if i != index]
            # 1〜2字の差は手掛かりにならない。次点と2割以上離れたときだけ見る。
            runner_up_max = max(others) if others else 0
            runner_up_min = min(others) if others else 0
            if lengths[index] == max(lengths) and lengths[index] >= runner_up_max * 1.25:
                deduct("C", "answer-longest", 6, "正答が単独で最長")
            elif lengths[index] == min(lengths) and runner_up_min >= lengths[index] * 1.25:
                deduct("C", "answer-shortest", 6, "正答が単独で最短")
            if others and lengths[index] > 1.5 * (sum(others) / len(others)):
                deduct("C", "answer-length-outlier", 3, "正答だけ極端に長い")
            if min(lengths) and max(lengths) >= 2 * min(lengths):
                deduct("C", "length-spread", 3, "選択肢の長さの差が大きい")

        # D: 解説の質
        if len(explanation) < 25:
            deduct("D", "explanation-too-short", 9, f"解説が {len(explanation)} 字")
        elif len(explanation) < 40:
            deduct("D", "explanation-short", 6, f"解説が {len(explanation)} 字")
        if not any(marker in explanation for marker in PROCEDURE_MARKERS):
            deduct("D", "no-procedure", 5, "判断手順を示す説明が無い")
        residual = explanation.replace(answer_text, "") if answer_text else explanation
        if explanation and len(residual) < 20:
            deduct("D", "restates-answer", 5, "解説が正答の言い換えで終わっている")
        # 語呂合わせは「覚え方」と明示していれば基準どおり。文法上の理由として
        # 使っている場合だけを減点する。
        disclaimed = "覚え方" in explanation or "文法上の理由ではない" in explanation
        if any(word in explanation for word in HAND_WAVE) and not disclaimed:
            deduct("D", "hand-wave", 5, "文法上の理由になっていない退け方がある")

        results[qid] = {
            "id": qid,
            "file": question["_file"],
            "group": question["_group"],
            "topic": question.get("topic") or "",
            "step": question.get("step") or "",
            "coverageId": question.get("coverageId") or "",
            "coverageTopic": question["_coverageTopic"],
            "coverageLabel": question["_coverageLabel"],
            "required": question["_required"],
            "questionType": question.get("questionType") or "plain",
            "ruleRefs": refs,
            "retired": bool(question.get("retired")),
            "deductions": deductions,
        }

    apply_redundancy(questions, results)

    for record in results.values():
        spent = collections.Counter()
        for deduction in record["deductions"]:
            spent[deduction["axis"]] += deduction["points"]
        record["axisScores"] = {key: max(0, AXIS_MAX[key] - spent[key]) for key, _t, _p in AXES}
        record["score"] = sum(record["axisScores"].values())
        record["reasons"] = sorted({d["code"] for d in record["deductions"]})

    return [results[q["id"]] for q in questions]


def apply_redundancy(questions: list[dict], results: dict[str, dict]) -> None:
    """同じ判断を繰り返している問題のうち、弱い方を減点する。

    グループごとに最も点の高い1問は必ず保護し、必修問題は必修外より後に
    減点する。入口の1問が冗長を理由に落ちることは無い。
    """
    by_step: dict[tuple, list[dict]] = collections.defaultdict(list)
    for question in questions:
        key = (question["_file"], question.get("topic"), question.get("step"), question["_group"])
        by_step[key].append(question)

    def provisional(question: dict) -> int:
        return 100 - sum(d["points"] for d in results[question["id"]]["deductions"])

    for key, group in by_step.items():
        # topic/step を持たない multiple_choice.json は、章が同じというだけで
        # 同じ判断とは限らない。冗長の根拠が無いので減点しない。
        if not key[1] or not key[2]:
            continue
        if len(group) < 3:
            continue
        ordered = sorted(group, key=lambda q: (not q["_required"], -provisional(q), str(q["id"])))
        for rank, question in enumerate(ordered):
            if rank < 2:
                continue
            points = min(15, 4 + 3 * (rank - 2))
            if not question["_required"]:
                points = min(15, points + 4)
            results[question["id"]]["deductions"].append({
                "axis": "E",
                "code": "duplicate-in-step",
                "points": points,
                "note": f"同じ手順・段階の問題が {len(group)} 問ある",
            })

    for i, a in enumerate(questions):
        for b in questions[i + 1:]:
            if a["_file"] != b["_file"] or a.get("step") != b.get("step"):
                continue
            ratio = similarity(a.get("question"), b.get("question"))
            if ratio >= 0.72 and similarity(a.get("passage", ""), b.get("passage", "")) >= 0.6:
                results[b["id"]]["deductions"].append({
                    "axis": "E",
                    "code": "near-duplicate",
                    "points": 15,
                    "note": f"{a['id']} と設問・本文が {ratio:.0%} 一致",
                })


def unique_rule_owner(record: dict, records: dict[str, dict], removing: set[str]) -> str:
    """この問題だけが扱っている active 原則カードがあれば、その id を返す。"""
    cards = load_cards()
    active = {rid for rid, card in cards.items() if card.get("status") == "active"}
    for ref in record["ruleRefs"]:
        if ref not in active:
            continue
        others = [
            other
            for other in records.values()
            if other["id"] != record["id"]
            and other["id"] not in removing
            and not other["retired"]
            and ref in other["ruleRefs"]
        ]
        if not others:
            return ref
    return ""


def removal_blocker(record: dict, records: dict[str, dict], removing: set[str]) -> str:
    gone = removing | {record["id"]} | {r["id"] for r in records.values() if r["retired"]}
    alive = [r for r in records.values() if r["id"] not in gone]

    group_alive = [r for r in alive if r["group"] == record["group"] and r["file"] == record["file"]]
    if record["group"] and not group_alive:
        return f"グループ {record['group']} の問題が無くなる"
    if record["required"]:
        required_alive = [r for r in group_alive if r["required"]]
        if not required_alive:
            return f"グループ {record['group']} の必修問題が無くなる"
    rule = unique_rule_owner(record, records, removing)
    if rule:
        return f"active 原則カード {rule} を扱う唯一の問題"
    if record["coverageLabel"]:
        # 識別問題は coverageTopics に「指定例」として登録され、用法ごとに
        # 1問が割り当てられている。外すとその用法の実例が無くなる。
        return f"識別カバレッジの指定例（{record['coverageTopic']}／{record['coverageLabel']}）"
    return ""


def find_alternative(record: dict, records: dict[str, dict], removing: set[str], threshold: int) -> str:
    """同じ判断を扱う、しきい値以上の問題。

    照合できるのは topic+step が揃っている場合か、原則カードを共有する場合
    だけ。章番号しか持たない問題は「同じ章にある」だけでは代替と見なさない。
    """
    best, best_score = "", -1
    for other in records.values():
        if other["id"] == record["id"] or other["id"] in removing or other["retired"]:
            continue
        if other["score"] < threshold:
            continue
        same_step = bool(record["topic"] and record["step"]) and (
            other["file"] == record["file"]
            and other["topic"] == record["topic"]
            and other["step"] == record["step"]
        )
        same_rule = bool(set(record["ruleRefs"]) & set(other["ruleRefs"]))
        if not (same_step or same_rule):
            continue
        if other["score"] > best_score:
            best, best_score = other["id"], other["score"]
    return best


def build_proposals(scored: list[dict], threshold: int, limit: int) -> list[dict]:
    records = {record["id"]: record for record in scored}
    candidates = sorted(
        (r for r in scored if r["score"] < threshold and not r["retired"]),
        key=lambda r: (r["score"], r["id"]),
    )
    removing: set[str] = set()
    proposals = []
    for record in candidates:
        if len(proposals) >= limit:
            break
        blocker = removal_blocker(record, records, removing)
        alternative = find_alternative(record, records, removing, threshold)
        if blocker:
            action, reason = "改稿候補", blocker
        elif alternative:
            action, reason = "退役候補", f"同じ手順・段階を {alternative} が扱う"
            removing.add(record["id"])
        else:
            action, reason = "改稿候補", "同じ手順・段階に代替が無い"
        proposals.append({**record, "action": action, "action_reason": reason, "alternative": alternative})
    return proposals


def render_report(scored: list[dict], proposals: list[dict], threshold: int) -> str:
    live = [r for r in scored if not r["retired"]]
    scores = [r["score"] for r in live]
    reason_counts = collections.Counter(d["code"] for r in live for d in r["deductions"])
    by_file = collections.defaultdict(list)
    for record in live:
        by_file[record["file"]].append(record["score"])

    lines = [
        "# 古文演習v2 問題の品質スコア",
        "",
        f"対象: 4択・識別 {len(live)}問(退役済み {len(scored) - len(live)}問) / しきい値 {threshold}点",
        f"平均 {sum(scores) / len(scores):.1f}点 / 最低 {min(scores)}点 / 最高 {max(scores)}点",
        "",
        "`quality_check.py --check` が止める項目(最長バイアス・誤答根拠の欠落・重複・必修ルート)は、",
        "既にゲートで防いでいる。ここではその先の程度問題だけを採点する。",
        "",
        "## 配点",
        "",
        "| 軸 | 観点 | 配点 |",
        "|---|---|---:|",
    ]
    for key, title, points in AXES:
        lines.append(f"| {key} | {title} | {points} |")

    buckets = collections.Counter(min(9, r["score"] // 10) for r in live)
    lines += ["", "## 点数の分布", "", "| 点数帯 | 問題数 |", "|---|---:|"]
    for bucket in range(10):
        label = "90〜100" if bucket == 9 else f"{bucket * 10}〜{bucket * 10 + 9}"
        lines.append(f"| {label} | {buckets.get(bucket, 0)} |")

    lines += ["", "## 減点理由の件数", "", "| code | 件数 |", "|---|---:|"]
    for code, count in reason_counts.most_common():
        lines.append(f"| `{code}` | {count} |")

    lines += ["", "## ファイル別", "", "| file | 問題数 | 平均 | しきい値未満 |", "|---|---:|---:|---:|"]
    for fname, values in sorted(by_file.items(), key=lambda row: sum(row[1]) / len(row[1])):
        below = sum(1 for value in values if value < threshold)
        lines.append(f"| `{fname}` | {len(values)} | {sum(values) / len(values):.1f} | {below} |")

    lines += [
        "",
        "## 低い順の一覧(上位40問)",
        "",
        "| id | file | topic/step | 必修 | 点 | A | B | C | D | E | 減点理由 |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for record in sorted(live, key=lambda r: (r["score"], r["id"]))[:40]:
        axis = record["axisScores"]
        label = f"{record['topic']}/{record['step']}" if record["topic"] else record["group"]
        lines.append(
            f"| `{record['id']}` | `{record['file']}` | {label} | "
            f"{'必修' if record['required'] else '追加'} | {record['score']} | "
            f"{axis['A']} | {axis['B']} | {axis['C']} | {axis['D']} | {axis['E']} | "
            + ", ".join(f"`{code}`" for code in record["reasons"]) + " |"
        )

    if proposals:
        lines += ["", "## 退役・改稿の候補", "", "| id | 点 | 判定 | 根拠 | 代替 |", "|---|---:|---|---|---|"]
        for proposal in proposals:
            lines.append(
                f"| `{proposal['id']}` | {proposal['score']} | {proposal['action']} | "
                f"{proposal['action_reason']} | `{proposal['alternative'] or '-'}` |"
            )

    lines += [
        "",
        "退役は `--apply` で正本JSONに1行の `retired` を差し込む。アプリは読み込み時に除外する。",
        "`--restore` でその行を消せば元に戻る。",
        "",
    ]
    return "\n".join(lines)


def file_of(qid: str, scored: list[dict]) -> str:
    for record in scored:
        if record["id"] == qid:
            return record["file"]
    raise SystemExit(f"問題が見つかりません: {qid}")


def edit_retired(fname: str, qid: str, payload: str | None) -> None:
    """該当問題の "id" 行の直後に retired の1行を足す(payload=None なら消す)。

    同じ id は coverageTopics の指定例にも現れるので、問題配列が始まる行より
    後だけを探す。
    """
    path = DATA / fname
    raw = path.read_text(encoding="utf-8", newline="")
    newline = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(newline)

    questions_key = next(qkey for name, qkey, _r, _g in SOURCES if name == fname)
    start = next(
        (i for i, line in enumerate(lines) if line.strip().startswith(f'"{questions_key}"')),
        None,
    )
    if start is None:
        raise SystemExit(f"{fname} に {questions_key} が見つかりません")

    target = None
    for index in range(start, len(lines)):
        if re.match(rf'^(\s*)"id":\s*"{re.escape(qid)}",\s*$', lines[index]):
            target = index
            break
    if target is None:
        raise SystemExit(f"{fname} に {qid} の id 行が見つかりません")

    indent = re.match(r"^(\s*)", lines[target]).group(1)
    existing = None
    if target + 1 < len(lines) and lines[target + 1].strip().startswith('"retired"'):
        existing = target + 1

    if payload is None:
        if existing is None:
            raise SystemExit(f"{qid} は退役していません")
        del lines[existing]
    else:
        if existing is not None:
            raise SystemExit(f"{qid} は既に退役しています")
        lines.insert(target + 1, f'{indent}"retired": {payload},')

    path.write_text(newline.join(lines), encoding="utf-8", newline="")


def apply_retire(scored: list[dict], ids: list[str], note: str, threshold: int, force: bool) -> None:
    records = {record["id"]: record for record in scored}
    if len(ids) > MAX_PER_APPLY:
        raise SystemExit(f"1回に退役できるのは {MAX_PER_APPLY} 問までです(指定 {len(ids)} 問)。")

    removing = set(ids)
    planned = []
    for qid in ids:
        record = records.get(qid)
        if record is None:
            raise SystemExit(f"問題が見つかりません: {qid}")
        if record["retired"]:
            raise SystemExit(f"すでに退役しています: {qid}")
        blocker = removal_blocker(record, records, removing - {qid})
        if blocker and not force:
            raise SystemExit(f"{qid} は退役できません: {blocker}")
        if blocker:
            print(f"警告: {qid} の制約を --force で越えます: {blocker}")
        alternative = find_alternative(record, records, removing - {qid}, threshold)
        if not alternative and not force:
            raise SystemExit(
                f"{qid} は同じ手順・段階に代替がありません。退役ではなく改稿を検討してください(--force で上書き)。"
            )
        planned.append((record, alternative))

    for record, alternative in planned:
        payload = json.dumps(
            {
                "reason": note,
                "score": record["score"],
                "codes": record["reasons"],
                "alternative": alternative,
                "decidedAt": date.today().isoformat(),
            },
            ensure_ascii=False,
        )
        edit_retired(record["file"], record["id"], payload)

    print(f"{len(planned)}問を退役しました: " + ", ".join(record["id"] for record, _a in planned))
    print("次に py -3 scripts/quality_check.py --check を実行してください。")


def restore(scored: list[dict], ids: list[str]) -> None:
    for qid in ids:
        edit_retired(file_of(qid, scored), qid, None)
    print(f"{len(ids)}問を戻しました: " + ", ".join(ids))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Markdown レポートの出力先")
    parser.add_argument("--json", type=Path, help="スコアJSONの出力先")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--propose", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--ids", default="")
    parser.add_argument("--note", default="")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    ids = [value.strip() for value in args.ids.split(",") if value.strip()]
    questions = load_all()
    scored = score_questions(questions)

    if args.restore:
        if not ids:
            raise SystemExit("--restore には --ids が必要です。")
        restore(scored, ids)
        return 0
    if args.apply:
        if not ids:
            raise SystemExit("--apply には --ids が必要です。")
        apply_retire(scored, ids, args.note, args.threshold, args.force)
        return 0

    proposals = build_proposals(scored, args.threshold, args.limit)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps({"threshold": args.threshold, "questions": scored}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    report = render_report(scored, proposals, args.threshold)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report + "\n", encoding="utf-8")

    if args.propose:
        live = [r for r in scored if not r["retired"]]
        print(f"しきい値 {args.threshold}点未満: {sum(1 for r in live if r['score'] < args.threshold)}問")
        for proposal in proposals:
            print(
                f"{proposal['id']:>22} {proposal['score']:>3}点 {proposal['action']:<5} "
                f"{'必修' if proposal['required'] else '追加'} "
                f"{(proposal['topic'] + '/' + proposal['step'])[:24]:<26} "
                f"代替={proposal['alternative'] or '-':<22} {','.join(proposal['reasons'])}"
            )
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
