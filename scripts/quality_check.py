# -*- coding: utf-8 -*-
"""古文文法問題（4択・識別）の品質検査スクリプト。

対象: data/multiple_choice.json, data/shikibetsu.json
UTF-8で標準出力に日本語で結果を出す。冪等・数秒以内。

使い方:
  py scripts/quality_check.py           詳細レポートを出す（常に0終了）
  py scripts/quality_check.py --check   合否のみ。問題があれば非ゼロ終了（コミット前・CIのゲート用）

注記: 選択肢は static/mode-katsuyo.js の描画時に shuffle される
      （line 917: q.choices.map((text, originalIndex) => ...) → shuffle）。
      したがって answerIndex のデータ上の位置は UI 表示順には影響しない。
      本スクリプトの「正解位置分布」はあくまでデータ生成側の偏り把握用。
"""
import difflib
import io
import json
import os
import sys
from collections import Counter

# Windows コンソールでも UTF-8 で出力する
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MC_PATH = os.path.join(ROOT, "data", "multiple_choice.json")
KISO_PATH = os.path.join(ROOT, "data", "kiso.json")
SB_PATH = os.path.join(ROOT, "data", "shikibetsu.json")
JOSHI_PATH = os.path.join(ROOT, "data", "shikibetsu-joshi.json")
HOMOGRAPH_PATH = os.path.join(ROOT, "data", "shikibetsu-homograph.json")
KEIGO_PATH = os.path.join(ROOT, "data", "shikibetsu-keigo.json")
CURRICULUM_PATH = os.path.join(ROOT, "data", "curriculum.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clen(s):
    """選択肢の文字数（Noneや非文字列は0扱い）。"""
    return len(s) if isinstance(s, str) else 0


def is_longest_correct(choices, ans):
    """正解が最長（同点最長を含む）か。"""
    if not choices or ans is None or ans < 0 or ans >= len(choices):
        return False
    lens = [clen(c) for c in choices]
    return lens[ans] == max(lens)


def pct(n, d):
    return "0.0%" if d == 0 else f"{100.0 * n / d:.1f}% ({n}/{d})"


def is_uniquely_longest_correct(choices, ans, ratio=1.6):
    """正解が「一意に最長」かつ最短の ratio 倍以上か（＝『長い方を選ぶ』で当たる悪用可能な問題）。"""
    if not choices or ans is None or ans < 0 or ans >= len(choices):
        return False
    lens = [clen(c) for c in choices]
    nonzero = [l for l in lens if l > 0]
    if not nonzero:
        return False
    mx = max(lens)
    mn = min(nonzero)
    if lens.count(mx) != 1 or lens[ans] != mx:
        return False
    return mx >= mn * ratio


# ---------------------------------------------------------------------------
# スキーマ健全性
# ---------------------------------------------------------------------------
def check_mc_schema(questions):
    errors = []
    for q in questions:
        qid = q.get("id", "<no-id>")
        ch = q.get("choices")
        is_multi = q.get("questionType") == "multi-select"

        if is_multi:
            if not isinstance(ch, list) or len(ch) < 2:
                errors.append(f"{qid}: choices が2要素以上でない（{len(ch) if isinstance(ch, list) else 'なし'}）")
            ais = q.get("answerIndices")
            if not isinstance(ais, list) or not ais:
                errors.append(f"{qid}: answerIndices が空/配列でない（{ais}）")
            elif isinstance(ch, list):
                if len(set(ais)) != len(ais):
                    errors.append(f"{qid}: answerIndices に重複がある（{ais}）")
                if any(not isinstance(i, int) or i < 0 or i >= len(ch) for i in ais):
                    errors.append(f"{qid}: answerIndices が choices の範囲外（{ais}）")
        else:
            if not isinstance(ch, list) or len(ch) != 4:
                errors.append(f"{qid}: choices が4要素でない（{len(ch) if isinstance(ch, list) else 'なし'}）")
            ai = q.get("answerIndex")
            if not isinstance(ai, int) or ai < 0 or ai > 3:
                errors.append(f"{qid}: answerIndex が0〜3でない（{ai}）")

        if not (isinstance(q.get("question"), str) and q["question"].strip()):
            errors.append(f"{qid}: question が空")
        if not (isinstance(q.get("explanation"), str) and q["explanation"].strip()):
            errors.append(f"{qid}: explanation が空")
        if isinstance(ch, list):
            for i, c in enumerate(ch):
                if not (isinstance(c, str) and c.strip()):
                    errors.append(f"{qid}: choices[{i}] が空")
    return errors


def check_sb_schema(questions):
    errors = []
    for q in questions:
        qid = q.get("id", "<no-id>")
        qt = q.get("questionType")
        if qt == "integration":
            for field in ("passage", "target", "targetRanges"):
                if not q.get(field):
                    errors.append(f"{qid}: integration に {field} が無い/空")
            if "steps" in q:
                errors.append(f"{qid}: integration に旧形式の steps が残っている")
            ranges = q.get("targetRanges")
            passage = q.get("passage")
            if isinstance(ranges, list) and isinstance(passage, str):
                for ri, r in enumerate(ranges):
                    if not isinstance(r, dict):
                        errors.append(f"{qid} targetRanges[{ri}]: オブジェクトでない")
                        continue
                    start, text = r.get("start"), r.get("text")
                    if not isinstance(start, int) or start < 0 or not isinstance(text, str) or not text:
                        errors.append(f"{qid} targetRanges[{ri}]: start/text が不正")
                    elif passage[start:start + len(text)] != text:
                        errors.append(f"{qid} targetRanges[{ri}]: passage と一致しない")
            ch = q.get("choices")
            if not isinstance(ch, list) or len(ch) != 4:
                errors.append(f"{qid}: integration の choices が4要素でない")
            ai = q.get("answerIndex")
            if not isinstance(ai, int) or ai < 0 or ai > 3:
                errors.append(f"{qid}: integration の answerIndex が0〜3でない（{ai}）")
            if isinstance(ch, list):
                for i, c in enumerate(ch):
                    if not (isinstance(c, str) and c.strip()):
                        errors.append(f"{qid}: choices[{i}] が空")
            if not (isinstance(q.get("question"), str) and q["question"].strip()):
                errors.append(f"{qid}: question が空")
            if not (isinstance(q.get("explanation"), str) and q["explanation"].strip()):
                errors.append(f"{qid}: explanation が空")
        else:
            ch = q.get("choices")
            if not isinstance(ch, list) or len(ch) < 2:
                errors.append(f"{qid}: choices が2要素未満")
            ai = q.get("answerIndex")
            if not isinstance(ai, int) or ai < 0 or (isinstance(ch, list) and ai >= len(ch)):
                errors.append(f"{qid}: answerIndex が範囲外（{ai}）")
            if not (isinstance(q.get("question"), str) and q["question"].strip()):
                errors.append(f"{qid}: question が空")
            if not (isinstance(q.get("explanation"), str) and q["explanation"].strip()):
                errors.append(f"{qid}: explanation が空")
            if isinstance(ch, list):
                for i, c in enumerate(ch):
                    if not (isinstance(c, str) and c.strip()):
                        errors.append(f"{qid}: choices[{i}] が空")
    return errors


def check_required_question_ids_for_set(data, required_key, questions_key,
                                        expected_count, expected_types, label):
    """指定セットの必修IDが、登録問題の実在するIDだけで構成されているか。"""
    errors = []
    required = data.get(required_key)
    questions = data.get(questions_key, [])
    if not isinstance(required, list):
        return [f"{required_key} が配列でない"]

    question_ids = [q.get("id") for q in questions]
    question_id_set = set(question_ids)
    required_set = set(required)
    duplicates = [qid for qid, n in Counter(required).items() if n > 1]
    missing = [qid for qid in required if qid not in question_id_set]
    unknown = [qid for qid in question_ids if qid not in required_set]
    if expected_count is not None and len(required) != expected_count:
        errors.append(f"{label}の必修問題数が{expected_count}でない（{len(required)}）")
    if duplicates:
        errors.append(f"{required_key} に重複: " + ", ".join(duplicates))
    if missing:
        errors.append(f"{required_key} に存在しないID: " + ", ".join(missing))
    supplemental_count = len(questions) - len(required_set)
    if len(unknown) != supplemental_count:
        errors.append(f"追加練習問題数が実データと一致しない（{len(unknown)} / {supplemental_count}）")

    by_id = {q.get("id"): q for q in questions}
    if expected_types is not None:
        type_counts = Counter(by_id[qid].get("questionType") for qid in required if qid in by_id)
        expected = Counter(expected_types)
        if type_counts != expected:
            errors.append(f"{label}必修問題の形式内訳が不一致（{dict(type_counts)}）")
    return errors


def check_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "requiredQuestionIds", "shikibetsuQuestions", 58,
        {"integration": 58},
        "助動詞識別",
    )


def check_joshi_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "joshiRequiredQuestionIds", "joshiQuestions", None,
        None,
        "助詞識別",
    )


def check_homograph_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "homographRequiredQuestionIds", "homographQuestions", None,
        None,
        "同形語識別",
    )


def check_keigo_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "keigoRequiredQuestionIds", "keigoQuestions", 10,
        {"integration": 10},
        "敬語識別",
    )


def check_kiso_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "kisoRequiredQuestionIds", "kisoQuestions", None,
        None,
        "文法の土台",
    )


def check_choice_required_question_ids(data):
    return check_required_question_ids_for_set(
        data, "choiceRequiredQuestionIds", "choiceQuestions", None,
        None,
        "文法4択",
    )


CURRICULUM_MANIFESTS = {
    "choice": ("choiceRequiredQuestionIds", "choiceGroups", "multiple_choice.json"),
    "kiso": ("kisoRequiredQuestionIds", "kisoGroups", "kiso.json"),
    "joshi": ("joshiRequiredQuestionIds", "joshiGroups", "shikibetsu-joshi.json"),
    "homograph": ("homographRequiredQuestionIds", "homographGroups", "shikibetsu-homograph.json"),
}


def curriculum_explicit_required_ids(set_id, data_by_file):
    """curriculum.jsonでids/groupIdが明示された必修活動を収集する。

    procedureのids省略は、既存のprocedureグループが代表問題集合を持つ
    互換形式なので、この検査では対象外にする。分割講の境界はids明示で固定する。
    """
    manifest = load(CURRICULUM_PATH)
    required_ids_key, groups_key, filename = CURRICULUM_MANIFESTS[set_id]
    source = data_by_file[filename]
    groups = {str(group.get("id")): group.get("ids", []) for group in source.get(groups_key, [])}
    found = []
    for chapter in manifest.get("chapters", []):
        for lesson in chapter.get("lessons", []):
            for activity in lesson.get("requiredActivities", []):
                if activity.get("setId") != set_id:
                    continue
                if isinstance(activity.get("ids"), list):
                    found.extend(activity["ids"])
                elif activity.get("groupId"):
                    found.extend(groups.get(str(activity["groupId"]), []))
    return list(dict.fromkeys(found))


def check_curriculum_required_ids(data_by_file):
    problems = []
    for set_id, (required_key, _groups_key, filename) in CURRICULUM_MANIFESTS.items():
        data = data_by_file[filename]
        required = set(data.get(required_key, []))
        manifest_ids = curriculum_explicit_required_ids(set_id, data_by_file)
        missing = [qid for qid in manifest_ids if qid not in required]
        if missing:
            problems.append(
                f"{set_id}: curriculum必修idsが{required_key}に未登録（{', '.join(map(str, missing))}）"
            )
    return problems


# ---------------------------------------------------------------------------
# 正解最長バイアス
# ---------------------------------------------------------------------------
def longest_bias_mc(questions):
    hits = [q["id"] for q in questions
            if isinstance(q.get("choices"), list)
            and is_longest_correct(q["choices"], q.get("answerIndex"))]
    return hits, len(questions)


def longest_bias_sb(questions):
    """識別問題は形式にかかわらず、問題単位で集計。"""
    hits = []
    total = 0
    for q in questions:
        if isinstance(q.get("choices"), list):
            total += 1
            if is_longest_correct(q["choices"], q.get("answerIndex")):
                hits.append(q["id"])
    return hits, total


# ---------------------------------------------------------------------------
# 正解位置分布
# ---------------------------------------------------------------------------
def answer_hist_mc(questions):
    return Counter(q.get("answerIndex") for q in questions)


def answer_hist_sb(questions):
    return Counter(q.get("answerIndex") for q in questions)


# ---------------------------------------------------------------------------
# 誤答の説得力（機械的近似）: 文字数の極端なばらつき・重複・空
# ---------------------------------------------------------------------------
def choice_balance(qid, choices):
    """(極端ばらつきか, 重複あるか) のフラグと詳細文字列を返す。"""
    findings = []
    lens = [clen(c) for c in choices]
    nonzero = [l for l in lens if l > 0]
    if nonzero:
        mx, mn = max(nonzero), min(nonzero)
        if mn > 0 and mx >= mn * 3:
            findings.append(f"{qid}: 選択肢の長さが極端（最長{mx}/最短{mn}文字, {mx/mn:.1f}倍）")
    # 重複
    texts = [c for c in choices if isinstance(c, str)]
    dup = [t for t, c in Counter(texts).items() if c > 1]
    if dup:
        findings.append(f"{qid}: 選択肢が重複（{' / '.join(dup)}）")
    return findings


def imbalance_mc(questions):
    out = []
    for q in questions:
        if isinstance(q.get("choices"), list):
            out += choice_balance(q["id"], q["choices"])
    return out


def imbalance_sb(questions):
    out = []
    for q in questions:
        if isinstance(q.get("choices"), list):
            out += choice_balance(q["id"], q["choices"])
    return out


# ---------------------------------------------------------------------------
# distractorRationale の有無
# ---------------------------------------------------------------------------
def rationale_count_mc(questions):
    have = [q["id"] for q in questions if q.get("distractorRationale")]
    return len(have), len(questions) - len(have)


def rationale_count_sb(questions):
    have = [q["id"] for q in questions if q.get("distractorRationale")]
    return len(have), len(questions) - len(have)


# ---------------------------------------------------------------------------
# 重複検出（question文がほぼ同一）
# ---------------------------------------------------------------------------
def normalize(s):
    if not isinstance(s, str):
        return ""
    return "".join(s.split()).replace("、", "").replace("。", "").replace("「", "").replace("」", "")


def near_duplicate_integration(questions, threshold=0.75):
    """統合問題のうち、傍線部が同じで例文がほぼ同一のペアを返す。

    閾値0.75は実測に基づく: 主語だけ違う実質重複が0.82、
    「同じ動詞だが別の罠を扱う正当な問題」が最大0.61だったため、その間を取る。
    なお、例文が十分違っても“ねらい”が重複する場合はこの検査では拾えない
    （文字列では判別できない）。最終的な要否は人が判断すること。
    """
    integ = [q for q in questions if q.get("questionType") == "integration"]
    pairs = []
    for i in range(len(integ)):
        for j in range(i + 1, len(integ)):
            a, b = integ[i], integ[j]
            if a.get("target") != b.get("target"):
                continue
            ratio = difflib.SequenceMatcher(
                None, normalize(a.get("passage", "")), normalize(b.get("passage", ""))
            ).ratio()
            if ratio >= threshold:
                pairs.append((a["id"], b["id"], ratio))
    return pairs


def find_duplicates(items):
    """items = [(id, text)] のうち正規化後同一のペアを返す。"""
    seen = {}
    pairs = []
    for qid, text in items:
        key = normalize(text)
        if not key:
            continue
        if key in seen:
            pairs.append((seen[key], qid))
        else:
            seen[key] = qid
    return pairs


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


# 「正解が一意に最長」だが内容上不可避で、あえて許容している問題。
# 語群の列挙（正解が本当に多くの語を含む）や複合標準用語（適当・勧誘 等）で、
# 誤答を無理に長くすると誤った文法情報を作るため変更しない。
ALLOWED_LONGEST = {
    "c3-003",      # 未然形接続の助動詞は実際に最も多い
    "c3-005",      # 終止形接続の助動詞群
    "c7-003",      # 未然形＋ば／已然形＋ばの対比は2節必要（誤答[1]とほぼ同長）
    "sb-mu-cond3",  # 二人称＝「適当・勧誘」は複合標準用語
}


# ゲート対象のデータ。(ファイル名, 問題配列のキー, スキーマ種別)
# "mc" = 4択固定のスキーマ、"sb" = 2択以上＋統合問題ありのスキーマ
GATE_SOURCES = [
    ("multiple_choice.json", "choiceQuestions", "mc"),
    ("kiso.json", "kisoQuestions", "mc"),
    ("shikibetsu.json", "shikibetsuQuestions", "sb"),
    ("shikibetsu-joshi.json", "joshiQuestions", "sb"),
    ("shikibetsu-homograph.json", "homographQuestions", "sb"),
    ("shikibetsu-keigo.json", "keigoQuestions", "sb"),
]


# 退役(retired)させた問題を含むセット。(ファイル名, 問題配列, 必修IDキー, グループキー)
RETIRE_SOURCES = [
    ("multiple_choice.json", "choiceQuestions", "choiceRequiredQuestionIds", "choiceGroups"),
    ("kiso.json", "kisoQuestions", "kisoRequiredQuestionIds", "kisoGroups"),
    ("shikibetsu.json", "shikibetsuQuestions", "requiredQuestionIds", "shikibetsuGroups"),
    ("shikibetsu-joshi.json", "joshiQuestions", "joshiRequiredQuestionIds", "joshiGroups"),
    ("shikibetsu-homograph.json", "homographQuestions", "homographRequiredQuestionIds", "homographGroups"),
    ("shikibetsu-keigo.json", "keigoQuestions", "keigoRequiredQuestionIds", "keigoGroups"),
]

COVERAGE_KEYS = {
    "shikibetsu.json": "coverageTopics",
    "shikibetsu-joshi.json": "joshiCoverageTopics",
    "shikibetsu-homograph.json": "homographCoverageTopics",
    "shikibetsu-keigo.json": "keigoCoverageTopics",
}

def check_retired():
    """退役させた問題が、学習ルートを壊していないかを確認する。

    退役は正本JSONに残したまま出題だけ止める運用なので、必修IDやグループの
    配列は編集しない。アプリ側(static/mode-katsuyo.js の pruneRetired)が
    読み込み時に外すため、外した後の状態をここで確かめる。
    """
    problems = []
    for fname, qkey, rkey, gkey in RETIRE_SOURCES:
        path = os.path.join(ROOT, "data", fname)
        if not os.path.exists(path):
            continue
        data = load(path)
        questions = data.get(qkey, [])
        required = set(data.get(rkey, []))
        retired = {q.get("id") for q in questions if q.get("retired")}
        live = [q for q in questions if not q.get("retired")]

        for question in questions:
            info = question.get("retired")
            if not info:
                continue
            if not isinstance(info, dict) or not info.get("reason") or not info.get("decidedAt"):
                problems.append(f"[退役] {fname} {question.get('id')}: reason と decidedAt が必要")

        for group in data.get(gkey, []):
            ids = [qid for qid in group.get("ids", []) if qid not in retired]
            if group.get("ids") and not ids:
                problems.append(f"[退役] {fname} グループ {group.get('id')} の問題が全て退役している")
            elif required and not any(qid in required for qid in ids) and any(
                qid in required for qid in group.get("ids", [])
            ):
                problems.append(f"[退役] {fname} グループ {group.get('id')} の必修問題が全て退役している")

        coverage_key = COVERAGE_KEYS.get(fname)
        for topic in (data.get(coverage_key) or []) if coverage_key else []:
            items = [i for i in topic.get("items", []) if i.get("id") not in retired]
            if topic.get("items") and not items:
                problems.append(
                    f"[退役] {fname} カバレッジ「{topic.get('topic')}」の指定例が全て退役している"
                )

    return problems


def gate_datasets():
    """(表示名, 問題配列, スキーマ種別) を順に返す。存在しないファイルは飛ばす。"""
    data_dir = os.path.join(ROOT, "data")
    for fname, key, kind in GATE_SOURCES:
        path = os.path.join(data_dir, fname)
        if not os.path.exists(path):
            continue
        yield fname, load(path).get(key, []), kind


def run_check():
    """CI／コミット前ゲート用。問題を検出したら 1 を返す。"""
    problems = []

    for fname, questions, kind in gate_datasets():
        # 1. スキーマ
        checker = check_mc_schema if kind == "mc" else check_sb_schema
        problems += [f"[スキーマ] {fname} {e}" for e in checker(questions)]

        for q in questions:
            qid = q.get("id", "<no-id>")

            # 2. 「正解が一意に最長」（＝長い方を選べば当たる）の退行
            if isinstance(q.get("choices"), list) and qid not in ALLOWED_LONGEST:
                if is_uniquely_longest_correct(q["choices"], q.get("answerIndex")):
                    problems.append(f"[最長バイアス] {qid}: 正解が一意に最長。誤答を具体化して長さを揃えること")

            # 3. distractorRationale 欠落
            if not q.get("distractorRationale"):
                problems.append(f"[誤答根拠] {qid}: distractorRationale が無い")

            # 4. 誤答根拠のキーが実際の誤答と対応しているか
            #    識別問題も通常問題と同じ4択を直接突き合わせる。multi-selectは正解が複数のため answerIndices を使う。
            dr = q.get("distractorRationale") or {}
            ch = q.get("choices")
            if q.get("questionType") == "multi-select":
                ais = q.get("answerIndices")
                if not (isinstance(ch, list) and isinstance(ais, list) and all(isinstance(i, int) for i in ais)):
                    continue
                for i, c in enumerate(ch):
                    if i not in ais and c not in dr:
                        problems.append(f"[誤答根拠] {qid}: 誤答「{c}」の根拠が無い")
                    if i in ais and c in dr:
                        problems.append(f"[誤答根拠] {qid}: 正解「{c}」に根拠が付いている")
                continue
            ai = q.get("answerIndex")
            if not (isinstance(ch, list) and isinstance(ai, int) and 0 <= ai < len(ch)):
                continue
            for i, c in enumerate(ch):
                if i != ai and c not in dr:
                    problems.append(f"[誤答根拠] {qid}: 誤答「{c}」の根拠が無い")
                if i == ai and c in dr:
                    problems.append(f"[誤答根拠] {qid}: 正解「{c}」に根拠が付いている")

        # 5. 重複
        plain = [(q["id"], q.get("question", "")) for q in questions if q.get("questionType") != "integration"]
        for a, b in find_duplicates(plain):
            problems.append(f"[重複] {fname} {a} ≒ {b}")
        for a, b, r in near_duplicate_integration(questions):
            problems.append(f"[近似重複] {fname} {a} ≒ {b}（例文が{r:.0%}一致・傍線部も同じ）")

    for error in check_required_question_ids(load(SB_PATH)):
        problems.append(f"[必修ルート] shikibetsu.json {error}")
    for error in check_joshi_required_question_ids(load(JOSHI_PATH)):
        problems.append(f"[必修ルート] shikibetsu-joshi.json {error}")
    for error in check_homograph_required_question_ids(load(HOMOGRAPH_PATH)):
        problems.append(f"[必修ルート] shikibetsu-homograph.json {error}")
    for error in check_keigo_required_question_ids(load(KEIGO_PATH)):
        problems.append(f"[必修ルート] shikibetsu-keigo.json {error}")
    for error in check_kiso_required_question_ids(load(KISO_PATH)):
        problems.append(f"[必修ルート] kiso.json {error}")
    for error in check_choice_required_question_ids(load(MC_PATH)):
        problems.append(f"[必修ルート] multiple_choice.json {error}")

    manifest_data = {
        "multiple_choice.json": load(MC_PATH),
        "kiso.json": load(KISO_PATH),
        "shikibetsu-joshi.json": load(JOSHI_PATH),
        "shikibetsu-homograph.json": load(HOMOGRAPH_PATH),
    }
    for error in check_curriculum_required_ids(manifest_data):
        problems.append(f"[カリキュラム必修] {error}")

    problems += check_retired()

    if problems:
        print("品質ゲート: 不合格（{} 件）".format(len(problems)))
        for p in problems:
            print("  - " + p)
        return 1
    print("品質ゲート: 合格（スキーマ・最長バイアス・誤答根拠・重複いずれも問題なし）")
    return 0


def main():
    mc = load(MC_PATH)
    kiso = load(KISO_PATH)
    sb = load(SB_PATH)
    joshi = load(JOSHI_PATH)
    homograph = load(HOMOGRAPH_PATH)
    keigo = load(KEIGO_PATH)
    mcq = mc.get("choiceQuestions", [])
    sbq = sb.get("shikibetsuQuestions", [])

    print("古文文法問題 品質検査レポート")
    print(f"4択問題数: {len(mcq)} / 識別問題数: {len(sbq)}")

    # --- スキーマ健全性 ---
    section("1. スキーマ健全性")
    mc_err = check_mc_schema(mcq)
    sb_err = check_sb_schema(sbq)
    required_err = check_required_question_ids(sb)
    joshi_required_err = check_joshi_required_question_ids(joshi)
    homograph_required_err = check_homograph_required_question_ids(homograph)
    keigo_required_err = check_keigo_required_question_ids(keigo)
    kiso_required_err = check_kiso_required_question_ids(kiso)
    choice_required_err = check_choice_required_question_ids(mc)
    manifest_err = check_curriculum_required_ids({
        "multiple_choice.json": mc,
        "kiso.json": kiso,
        "shikibetsu-joshi.json": joshi,
        "shikibetsu-homograph.json": homograph,
    })
    if not mc_err and not sb_err and not required_err and not joshi_required_err and not homograph_required_err and not keigo_required_err and not kiso_required_err and not choice_required_err and not manifest_err:
        print("違反なし。全問が必須フィールドを満たす。")
    else:
        print(f"[4択] 違反 {len(mc_err)} 件")
        for e in mc_err:
            print("  - " + e)
        print(f"[識別] 違反 {len(sb_err)} 件")
        for e in sb_err:
            print("  - " + e)
        print(f"[必修ルート] 違反 {len(required_err)} 件")
        for e in required_err:
            print("  - " + e)
        print(f"[助詞必修ルート] 違反 {len(joshi_required_err)} 件")
        for e in joshi_required_err:
            print("  - " + e)
        print(f"[同形語必修ルート] 違反 {len(homograph_required_err)} 件")
        for e in homograph_required_err:
            print("  - " + e)
        print(f"[敬語必修ルート] 違反 {len(keigo_required_err)} 件")
        for e in keigo_required_err:
            print("  - " + e)
        print(f"[文法の土台必修ルート] 違反 {len(kiso_required_err)} 件")
        for e in kiso_required_err:
            print("  - " + e)
        print(f"[文法4択必修ルート] 違反 {len(choice_required_err)} 件")
        for e in choice_required_err:
            print("  - " + e)
        print(f"[カリキュラム必修同期] 違反 {len(manifest_err)} 件")
        for e in manifest_err:
            print("  - " + e)
    if not required_err:
        sbq_by_id = {q.get("id"): q for q in sbq}
        required_types = Counter(sbq_by_id[qid].get("questionType") for qid in sb.get("requiredQuestionIds", []))
        print("助動詞識別必修ルート: 58問（" + ", ".join(f"{k}={v}" for k, v in sorted(required_types.items())) + "）、追加練習: 18問")
    if not joshi_required_err:
        joshiq = joshi.get("joshiQuestions", [])
        joshi_by_id = {q.get("id"): q for q in joshiq}
        required_types = Counter(joshi_by_id[qid].get("questionType") for qid in joshi.get("joshiRequiredQuestionIds", []))
        required_count = len(joshi.get("joshiRequiredQuestionIds", []))
        print(f"助詞識別必修ルート: {required_count}問（" + ", ".join(f"{k}={v}" for k, v in sorted(required_types.items())) + f"）、追加練習: {len(joshiq) - required_count}問")
    if not homograph_required_err:
        homographq = homograph.get("homographQuestions", [])
        homograph_by_id = {q.get("id"): q for q in homographq}
        required_types = Counter(homograph_by_id[qid].get("questionType") for qid in homograph.get("homographRequiredQuestionIds", []))
        required_count = len(homograph.get("homographRequiredQuestionIds", []))
        print(f"同形語識別必修ルート: {required_count}問（" + ", ".join(f"{k}={v}" for k, v in sorted(required_types.items())) + f"）、追加練習: {len(homographq) - required_count}問")
    if not keigo_required_err:
        keigoq = keigo.get("keigoQuestions", [])
        keigo_by_id = {q.get("id"): q for q in keigoq}
        required_types = Counter(keigo_by_id[qid].get("questionType") for qid in keigo.get("keigoRequiredQuestionIds", []))
        print("敬語識別必修ルート: 10問（" + ", ".join(f"{k}={v}" for k, v in sorted(required_types.items())) + "）、追加練習: 6問")
    if not kiso_required_err:
        kiso_required = kiso.get("kisoRequiredQuestionIds", [])
        kiso_extra = len(kiso.get("kisoQuestions", [])) - len(kiso_required)
    print(f"文法の土台必修ルート: {len(kiso_required)}問、追加練習: {kiso_extra}問")
    if not choice_required_err:
        choice_required = mc.get("choiceRequiredQuestionIds", [])
        choice_extra = len(mcq) - len(choice_required)
        print(f"文法4択必修ルート: {len(choice_required)}問、追加練習: {choice_extra}問")

    # --- 正解最長バイアス ---
    section("2. 正解最長バイアス（正解が最長=同点最長含む の比率）")
    mc_hits, mc_total = longest_bias_mc(mcq)
    print(f"[4択] {pct(len(mc_hits), mc_total)}")
    print("  該当ID: " + (", ".join(mc_hits) if mc_hits else "なし"))
    sb_hits, sb_total = longest_bias_sb(sbq)
    print(f"[識別] {pct(len(sb_hits), sb_total)}")
    print("  該当ID: " + (", ".join(sb_hits) if sb_hits else "なし"))
    print("  ※ 参考: ランダムな4択なら約25%が期待値。")

    # --- 正解位置分布 ---
    section("3. 正解位置分布（answerIndex ヒストグラム）")
    print("  ※ UI描画時に選択肢はshuffleされるため表示順には無関係。データ生成偏り把握用。")
    print("[4択] " + str(dict(sorted(answer_hist_mc(mcq).items(), key=lambda x: (x[0] is None, x[0])))))
    sb_h = answer_hist_sb(sbq)
    print("[識別] " + str(dict(sorted(sb_h.items(), key=lambda x: (x[0] is None, x[0])))))

    # --- 誤答の説得力（近似） ---
    section("4. 選択肢バランス（長さ極端・重複・空）")
    mc_bal = imbalance_mc(mcq)
    sb_bal = imbalance_sb(sbq)
    if not mc_bal and not sb_bal:
        print("極端な長さ差・重複・空は検出されず。")
    else:
        print(f"[4択] {len(mc_bal)} 件")
        for b in mc_bal:
            print("  - " + b)
        print(f"[識別] {len(sb_bal)} 件")
        for b in sb_bal:
            print("  - " + b)

    # --- distractorRationale ---
    section("5. distractorRationale の有無")
    mc_have, mc_none = rationale_count_mc(mcq)
    sb_have, sb_none = rationale_count_sb(sbq)
    print(f"[4択] あり {mc_have} / なし {mc_none}")
    print(f"[識別] あり {sb_have} / なし {sb_none}")

    # --- 重複検出 ---
    section("6. 重複検出（question文がほぼ同一のペア）")
    mc_dup = find_duplicates([(q["id"], q.get("question", "")) for q in mcq])
    sb_items = [(q["id"], q.get("question", ""))
                for q in sbq if q.get("questionType") != "integration"]
    sb_items += [(q["id"], q.get("passage", "") + "／" + q.get("target", ""))
                 for q in sbq if q.get("questionType") == "integration"]
    sb_dup = find_duplicates(sb_items)
    sb_near = near_duplicate_integration(sbq)
    if not mc_dup and not sb_dup and not sb_near:
        print("ほぼ同一の問題文ペアは検出されず。")
    else:
        for a, b in mc_dup:
            print(f"  [4択] {a} ≒ {b}")
        for a, b in sb_dup:
            print(f"  [識別] {a} ≒ {b}")
        for a, b, r in sb_near:
            print(f"  [識別・統合] {a} ≒ {b}（例文が{r:.0%}一致・傍線部も同じ）")

    print("\n検査完了。")


if __name__ == "__main__":
    # --check: 詳細レポートの代わりに合否だけを出し、問題があれば非ゼロ終了する。
    #          コミット前チェックやCIのゲートとして使う。
    if "--check" in sys.argv:
        sys.exit(run_check())
    main()
