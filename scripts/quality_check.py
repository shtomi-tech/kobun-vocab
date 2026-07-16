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
SB_PATH = os.path.join(ROOT, "data", "shikibetsu.json")


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
            for field in ("passage", "target", "steps"):
                if not q.get(field):
                    errors.append(f"{qid}: integration に {field} が無い/空")
            steps = q.get("steps")
            if isinstance(steps, list):
                for si, st in enumerate(steps):
                    sc = st.get("choices")
                    if not isinstance(sc, list) or len(sc) < 2:
                        errors.append(f"{qid} step{si}: choices が2要素未満")
                    sai = st.get("answerIndex")
                    if not isinstance(sai, int) or sai < 0 or (isinstance(sc, list) and sai >= len(sc)):
                        errors.append(f"{qid} step{si}: answerIndex が範囲外（{sai}）")
                    if not (isinstance(st.get("prompt"), str) and st["prompt"].strip()):
                        errors.append(f"{qid} step{si}: prompt が空")
                    if not (isinstance(st.get("explanation"), str) and st["explanation"].strip()):
                        errors.append(f"{qid} step{si}: explanation が空")
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


# ---------------------------------------------------------------------------
# 正解最長バイアス
# ---------------------------------------------------------------------------
def longest_bias_mc(questions):
    hits = [q["id"] for q in questions
            if isinstance(q.get("choices"), list)
            and is_longest_correct(q["choices"], q.get("answerIndex"))]
    return hits, len(questions)


def longest_bias_sb(questions):
    """通常型は問題単位、integration型はstep単位でも集計。"""
    normal_hits = []
    normal_total = 0
    step_hits = []
    step_total = 0
    for q in questions:
        if q.get("questionType") == "integration":
            for si, st in enumerate(q.get("steps", [])):
                if isinstance(st.get("choices"), list):
                    step_total += 1
                    if is_longest_correct(st["choices"], st.get("answerIndex")):
                        step_hits.append(f"{q['id']}#step{si}")
        else:
            if isinstance(q.get("choices"), list):
                normal_total += 1
                if is_longest_correct(q["choices"], q.get("answerIndex")):
                    normal_hits.append(q["id"])
    return normal_hits, normal_total, step_hits, step_total


# ---------------------------------------------------------------------------
# 正解位置分布
# ---------------------------------------------------------------------------
def answer_hist_mc(questions):
    return Counter(q.get("answerIndex") for q in questions)


def answer_hist_sb(questions):
    normal = Counter()
    step = Counter()
    for q in questions:
        if q.get("questionType") == "integration":
            for st in q.get("steps", []):
                step[st.get("answerIndex")] += 1
        else:
            normal[q.get("answerIndex")] += 1
    return normal, step


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
        if q.get("questionType") == "integration":
            for si, st in enumerate(q.get("steps", [])):
                if isinstance(st.get("choices"), list):
                    out += choice_balance(f"{q['id']}#step{si}", st["choices"])
        elif isinstance(q.get("choices"), list):
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
    "c2-012",      # 上一段の語群（ひいきにみゐる）は語数が多い
    "c2-014",      # カ変は「来（く）」一語＝読み添えで長くなる
    "c2-016",      # ナ変「死ぬ・往ぬ（去ぬ）」の2語
    "c3-003",      # 未然形接続の助動詞は実際に最も多い
    "c3-005",      # 終止形接続の助動詞群
    "c7-003",      # 未然形＋ば／已然形＋ばの対比は2節必要（誤答[1]とほぼ同長）
    "sb-mu-cond3",  # 二人称＝「適当・勧誘」は複合標準用語
}


def run_check():
    """CI／コミット前ゲート用。問題を検出したら 1 を返す。"""
    mc = load(MC_PATH)
    sb = load(SB_PATH)
    mcq = mc.get("choiceQuestions", [])
    sbq = sb.get("shikibetsuQuestions", [])
    problems = []

    # 1. スキーマ
    problems += [f"[スキーマ] {e}" for e in check_mc_schema(mcq)]
    problems += [f"[スキーマ] {e}" for e in check_sb_schema(sbq)]

    # 2. 新たな「正解が一意に最長」（＝長い方を選べば当たる）の退行
    for q in mcq:
        if not isinstance(q.get("choices"), list):
            continue
        if q["id"] in ALLOWED_LONGEST:
            continue
        if is_uniquely_longest_correct(q["choices"], q.get("answerIndex")):
            problems.append(f"[最長バイアス] {q['id']}: 正解が一意に最長。誤答を具体化して長さを揃えること")
    for q in sbq:
        if q.get("questionType") == "integration" or not isinstance(q.get("choices"), list):
            continue
        if q["id"] in ALLOWED_LONGEST:
            continue
        if is_uniquely_longest_correct(q["choices"], q.get("answerIndex")):
            problems.append(f"[最長バイアス] {q['id']}: 正解が一意に最長。誤答を具体化して長さを揃えること")

    # 3. distractorRationale 欠落
    for q in mcq:
        if not q.get("distractorRationale"):
            problems.append(f"[誤答根拠] {q['id']}: distractorRationale が無い")
    for q in sbq:
        if not q.get("distractorRationale"):
            problems.append(f"[誤答根拠] {q['id']}: distractorRationale が無い")

    # 4. 誤答根拠のキーが実際の誤答と対応しているか
    for q in mcq:
        dr = q.get("distractorRationale") or {}
        ch, ai = q.get("choices"), q.get("answerIndex")
        if not (isinstance(ch, list) and isinstance(ai, int) and 0 <= ai < len(ch)):
            continue
        for i, c in enumerate(ch):
            if i != ai and c not in dr:
                problems.append(f"[誤答根拠] {q['id']}: 誤答「{c}」の根拠が無い")
            if i == ai and c in dr:
                problems.append(f"[誤答根拠] {q['id']}: 正解「{c}」に根拠が付いている")

    # 5. 重複
    for a, b in find_duplicates([(q["id"], q.get("question", "")) for q in mcq]):
        problems.append(f"[重複] 4択 {a} ≒ {b}")
    for a, b, r in near_duplicate_integration(sbq):
        problems.append(f"[近似重複] 識別 {a} ≒ {b}（例文が{r:.0%}一致・傍線部も同じ）")

    if problems:
        print("品質ゲート: 不合格（{} 件）".format(len(problems)))
        for p in problems:
            print("  - " + p)
        return 1
    print("品質ゲート: 合格（スキーマ・最長バイアス・誤答根拠・重複いずれも問題なし）")
    return 0


def main():
    mc = load(MC_PATH)
    sb = load(SB_PATH)
    mcq = mc.get("choiceQuestions", [])
    sbq = sb.get("shikibetsuQuestions", [])

    print("古文文法問題 品質検査レポート")
    print(f"4択問題数: {len(mcq)} / 識別問題数: {len(sbq)}")

    # --- スキーマ健全性 ---
    section("1. スキーマ健全性")
    mc_err = check_mc_schema(mcq)
    sb_err = check_sb_schema(sbq)
    if not mc_err and not sb_err:
        print("違反なし。全問が必須フィールドを満たす。")
    else:
        print(f"[4択] 違反 {len(mc_err)} 件")
        for e in mc_err:
            print("  - " + e)
        print(f"[識別] 違反 {len(sb_err)} 件")
        for e in sb_err:
            print("  - " + e)

    # --- 正解最長バイアス ---
    section("2. 正解最長バイアス（正解が最長=同点最長含む の比率）")
    mc_hits, mc_total = longest_bias_mc(mcq)
    print(f"[4択] {pct(len(mc_hits), mc_total)}")
    print("  該当ID: " + (", ".join(mc_hits) if mc_hits else "なし"))
    n_hits, n_total, s_hits, s_total = longest_bias_sb(sbq)
    print(f"[識別・通常型] {pct(len(n_hits), n_total)}")
    print("  該当ID: " + (", ".join(n_hits) if n_hits else "なし"))
    print(f"[識別・integration step単位] {pct(len(s_hits), s_total)}")
    print("  該当: " + (", ".join(s_hits) if s_hits else "なし"))
    print("  ※ 参考: ランダムなら4択は約25%、2択stepは約50%が期待値。")

    # --- 正解位置分布 ---
    section("3. 正解位置分布（answerIndex ヒストグラム）")
    print("  ※ UI描画時に選択肢はshuffleされるため表示順には無関係。データ生成偏り把握用。")
    print("[4択] " + str(dict(sorted(answer_hist_mc(mcq).items(), key=lambda x: (x[0] is None, x[0])))))
    sb_normal_h, sb_step_h = answer_hist_sb(sbq)
    print("[識別・通常型] " + str(dict(sorted(sb_normal_h.items(), key=lambda x: (x[0] is None, x[0])))))
    print("[識別・integration step] " + str(dict(sorted(sb_step_h.items(), key=lambda x: (x[0] is None, x[0])))))

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
