# -*- coding: utf-8 -*-
"""文法の入口の topic / step を、再編後の章立てに合わせて揃える（2026-07-28）。

演習中の見出しは choiceQuestionLabel() が組み立てる。
- q.chapter があると「CHAPTER 3 / QUESTION 7」と旧章番号が出る
- q.chapter が無いと「topic・step」が出る
Chapter 1/3/5 から移した20問は前者のままで、移動先の章と食い違うため、
chapter / no を落として topic / step を与える。あわせて、章名を変えた
既存問題の topic も新しい章名にそろえる。

consolidate_kiso.py の直後に1回だけ実行する。
"""
import io
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KISO = os.path.join(BASE, "data", "kiso.json")

# 章ID → 表示用の topic（章番号を除いた章名）
TOPIC_BY_GROUP = {
    "kiso-yomi": "歴史的仮名遣いと読み",
    "kiso-bunsetsu": "文節と品詞",
    "kiso-katsuyokei": "活用形と係り結び",
    "kiso-setsuzoku": "接続という考え方",
    "kiso-shikibetsu": "接続で識別する",
    "kiso-jodoshi": "助動詞の意味",
}

# 移動してきた20問に与える step（既存問題の step は元の記述を活かす）
STEP_BY_ID = {
    "c1-001": "活用とは何か",
    "c1-002": "活用する品詞",
    "c1-010": "疑問と反語",
    "c3-002": "助動詞自身の活用",
    "c3-003": "未然形接続の助動詞",
    "c3-004": "連用形接続の助動詞",
    "c3-005": "終止形接続の助動詞",
    "c5-005": "「り」の接続",
    "c3-006": "なりの識別",
    "c5-001": "き・けりの違い",
    "c5-002": "けりの詠嘆",
    "c5-003": "つ・ぬの強意",
    "c5-006": "たり・りの完了と存続",
    "c5-007": "らむの推量",
    "c5-008": "たしの希望",
    "c5-009": "らしの推定",
}


def main():
    with io.open(KISO, encoding="utf-8") as f:
        kiso = json.load(f)

    group_of = {}
    for g in kiso["kisoGroups"]:
        if g["id"] == "kiso-all":
            continue
        for qid in g["ids"]:
            group_of[qid] = g["id"]

    changed_topic, dropped_chapter, added_step = 0, 0, 0
    for q in kiso["kisoQuestions"]:
        gid = group_of.get(q["id"])
        if not gid:
            raise AssertionError(u"章に属さない問題: %s" % q["id"])

        topic = TOPIC_BY_GROUP[gid]
        if q.get("topic") != topic:
            q["topic"] = topic
            changed_topic += 1

        if "chapter" in q or "no" in q:
            q.pop("chapter", None)
            q.pop("no", None)
            dropped_chapter += 1

        if not q.get("step"):
            step = STEP_BY_ID.get(q["id"])
            if not step:
                raise AssertionError(u"step を決められない問題: %s" % q["id"])
            q["step"] = step
            added_step += 1

    # topic → step の順にキーを並べ直し、既存問題と同じ体裁にそろえる。
    order = ["id", "topic", "step", "question", "choices", "answerIndex",
             "explanation", "distractorRationale", "ruleRefs"]
    kiso["kisoQuestions"] = [
        {k: q[k] for k in order if k in q} | {k: v for k, v in q.items() if k not in order}
        for q in kiso["kisoQuestions"]
    ]

    with io.open(KISO, "w", encoding="utf-8") as f:
        json.dump(kiso, f, ensure_ascii=False, indent=2)
        f.write(u"\n")

    print("topic を更新: %d問／chapter・no を削除: %d問／step を付与: %d問"
          % (changed_topic, dropped_chapter, added_step))


if __name__ == "__main__":
    main()
