# -*- coding: utf-8 -*-
"""原則カード（docs/kobun-principles）と問題データの対応を検査する。

検査項目:
  1. 問題の ruleRefs が指す ruleId が、原則集の INDEX.md に実在するか
  2. ruleRefs が指すカードの status が active か（draft/deprecated を正誤判定の根拠にしていないか）
  3. status: active のカードすべてに、対応する問題が1問以上あるか
  4. 識別系データの問題に ruleRefs が付いているか

使い方:
  py -3 scripts/check_rule_coverage.py           対応表つきレポートを出す（常に0終了）
  py -3 scripts/check_rule_coverage.py --check   合否のみ。問題があれば非ゼロ終了

原則カードが未整備の分野（歴史的仮名遣い、らむ など）は「未整備」として一覧に出す。
これは不合格にはせず、原則集へ追加する候補として報告する。
"""
import io
import json
import os
import re
import sys

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PRINCIPLES = os.path.join(os.path.dirname(ROOT), "docs", "kobun-principles")

# (ファイル名, 問題配列のキー, ruleRefs必須か)
SOURCES = [
    ("kiso.json", "kisoQuestions", False),
    ("multiple_choice.json", "choiceQuestions", False),
    ("shikibetsu.json", "shikibetsuQuestions", True),
    ("shikibetsu-joshi.json", "joshiQuestions", True),
    ("shikibetsu-homograph.json", "homographQuestions", True),
    ("shikibetsu-keigo.json", "keigoQuestions", True),
]


def load_cards():
    """principles/ 配下のカードから id と status を読む。"""
    cards = {}
    base = os.path.join(PRINCIPLES, "principles")
    for dirpath, _dirnames, filenames in os.walk(base):
        for name in filenames:
            if not name.endswith(".md") or name.startswith("_"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as f:
                text = f.read()
            m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
            if not m:
                continue
            front = m.group(1)
            rid = re.search(r"^id:\s*(\S+)", front, re.M)
            status = re.search(r"^status:\s*(\S+)", front, re.M)
            title = re.search(r"^title:\s*(.+)$", front, re.M)
            if rid:
                cards[rid.group(1)] = {
                    "status": status.group(1) if status else "unknown",
                    "title": title.group(1).strip() if title else "",
                    "path": os.path.relpath(path, PRINCIPLES).replace("\\", "/"),
                }
    return cards


def load_index_ids():
    path = os.path.join(PRINCIPLES, "INDEX.md")
    with open(path, encoding="utf-8") as f:
        return set(re.findall(r"`(kbp\.[a-z0-9.\-]+)`", f.read()))


def load_questions():
    out = []
    for fname, key, required in SOURCES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        for q in d.get(key, []):
            out.append((fname, q, required))
    return out


def analyze():
    cards = load_cards()
    index_ids = load_index_ids()
    questions = load_questions()

    problems = []
    notes = []

    # INDEX とカード本体のずれ
    for rid in sorted(index_ids - set(cards)):
        problems.append("INDEX.md にあるがカード本体が無い: {}".format(rid))
    for rid in sorted(set(cards) - index_ids):
        problems.append("カード本体はあるが INDEX.md に登録が無い: {}".format(rid))

    usage = {rid: [] for rid in cards}
    missing_refs = []
    for fname, q, required in questions:
        refs = q.get("ruleRefs")
        if refs is None and required:
            missing_refs.append("{}: {} に ruleRefs キーが無い".format(fname, q.get("id")))
            continue
        for rid in (refs or []):
            if rid not in cards:
                problems.append("{}: {} が存在しない ruleId を参照: {}".format(fname, q.get("id"), rid))
                continue
            if cards[rid]["status"] != "active":
                problems.append("{}: {} が status={} のカードを参照: {}".format(
                    fname, q.get("id"), cards[rid]["status"], rid))
            usage[rid].append(q.get("id"))

    problems.extend(missing_refs)

    active = [rid for rid, c in cards.items() if c["status"] == "active"]
    uncovered = sorted(rid for rid in active if not usage[rid])
    for rid in uncovered:
        problems.append("status:active のカードに対応する問題が無い: {}（{}）".format(rid, cards[rid]["title"]))

    # ruleRefs が空のまま残っている識別問題＝原則カード未整備の候補
    for fname, q, required in questions:
        if required and q.get("ruleRefs") == []:
            notes.append("{}: {}（{}）— 対応する原則カードが未整備".format(
                fname, q.get("id"), q.get("topic", "")))

    return cards, usage, active, problems, notes, questions


def run_check():
    _cards, _usage, _active, problems, notes, _q = analyze()
    if problems:
        print("原則対応ゲート: 不合格（{} 件）".format(len(problems)))
        for p in problems:
            print("  - " + p)
        return 1
    print("原則対応ゲート: 合格（参照先の実在・status:active・カバレッジいずれも問題なし）")
    if notes:
        print("参考: 原則カードが未整備のまま出題している問題が {} 件あります（--check では不合格にしません）".format(len(notes)))
    return 0


def main():
    if "--check" in sys.argv:
        sys.exit(run_check())

    cards, usage, active, problems, notes, questions = analyze()
    print("=" * 64)
    print("古文原則 × 問題データ 対応レポート")
    print("=" * 64)
    print("原則カード: {} 枚（active {} 枚） / 問題: {} 問".format(len(cards), len(active), len(questions)))

    print("\n--- active カードごとの対応問題数 ---")
    for rid in sorted(active):
        ids = usage[rid]
        mark = "  " if ids else "！"
        print("{} {:<52} {:>3}問  {}".format(mark, rid, len(ids), cards[rid]["title"]))

    non_active = sorted(rid for rid in cards if cards[rid]["status"] != "active")
    if non_active:
        print("\n--- active でないカード ---")
        for rid in non_active:
            print("  {} (status={})".format(rid, cards[rid]["status"]))

    print("\n--- 原則カードが未整備のまま出題している問題 ---")
    if notes:
        for n in notes:
            print("  - " + n)
    else:
        print("  なし")

    print("\n--- 検査結果 ---")
    if problems:
        print("不合格 {} 件".format(len(problems)))
        for p in problems:
            print("  - " + p)
    else:
        print("問題なし")


if __name__ == "__main__":
    main()
