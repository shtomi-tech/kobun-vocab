# -*- coding: utf-8 -*-
"""必修1「文法の入口」の統廃合と章立て再編（2026-07-28）。

- 内容が重複していた18問を削除する。
- Chapter 1/3/5 の残り20問を multiple_choice.json から kiso.json へ移し、
  入口の全問題を kiso.json に集約する。
- 入口を6章に組み直す。

1回だけ実行する移行スクリプト。実行後の再実行は想定しない（冪等ではない）。
"""
import io
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KISO = os.path.join(BASE, "data", "kiso.json")
CHOICE = os.path.join(BASE, "data", "multiple_choice.json")

# 重複により削除する18問。
DELETE_KISO = ["k-yomi-01", "k-set-03", "k-set-04"]
DELETE_CHOICE = [
    "c1-003", "c1-004", "c1-005", "c1-006", "c1-007", "c1-008", "c1-009", "c1-011",
    "c3-001", "c3-009", "c3-010", "c3-012", "c3-014", "c3-015",
    "c5-004",
]

# 新しい章立て。ここに並べた順で出題する。
GROUPS = [
    {
        "id": "kiso-yomi",
        "name": "1. 歴史的仮名遣いと読み",
        "sub": "書かれた形と読み方のずれを直す",
        "ids": ["k-yomi-02", "k-yomi-03", "k-yomi-04", "k-yomi-05",
                "k-yomi-06", "k-yomi-07", "k-yomi-08"],
    },
    {
        "id": "kiso-bunsetsu",
        "name": "2. 文節と品詞",
        "sub": "文を文節に切り、自立語・付属語と用言・体言を分ける",
        "ids": ["k-bun-01", "k-bun-02", "k-bun-03", "k-bun-04",
                "c1-001", "c1-002", "k-bun-05", "k-bun-06"],
    },
    {
        "id": "kiso-katsuyokei",
        "name": "3. 活用形と係り結び",
        "sub": "下に続く語と係助詞から、6つの活用形を決める",
        "ids": ["k-kei-01", "k-kei-02", "k-kei-03", "k-kei-04", "k-kei-05", "k-kei-06",
                "k-kei-07", "k-kei-08", "c1-010", "k-kei-09"],
    },
    {
        "id": "kiso-setsuzoku",
        "name": "4. 接続という考え方",
        "sub": "どの活用形に付くかで、助動詞を4つの接続に整理する",
        "ids": ["k-set-01", "c3-002", "c3-003", "c3-004", "c3-005",
                "k-set-05", "k-set-06", "c5-005", "k-set-07"],
    },
    {
        "id": "kiso-shikibetsu",
        "name": "5. 接続で識別する",
        "sub": "同じ形の語を、上の活用形の違いで切り分ける",
        "ids": ["k-set-02", "c3-006", "k-set-08", "k-set-09", "k-set-10"],
    },
    {
        "id": "kiso-jodoshi",
        "name": "6. 助動詞の形と意味",
        "sub": "助動詞自身の活用と、基本的な意味をつかむ",
        "ids": ["c3-007", "c3-013", "c3-011", "c3-008",
                "c5-001", "c5-002", "c5-003", "c5-006", "c5-007", "c5-008", "c5-009"],
    },
]

NEW_META_NOTE = (
    "2026-07-25新設、2026-07-28再編。段階2の最初の必修「文法の入口」。"
    "用言の活用に入る前に、生徒が自力で『この語は何形か』『上に何が付くか』を言える状態にするための土台。"
    "2026-07-28に旧Chapter 1（品詞・活用・係り結び）・Chapter 3（助動詞の攻略①）・"
    "Chapter 5（助動詞の攻略③）から重複を除いた20問をこのファイルへ集約し、"
    "内容の重なっていた18問を削除して6章に組み直した。市販教材の設問文は転記していない。"
)


def load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(path, data):
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write(u"\n")


def main():
    kiso = load(KISO)
    choice = load(CHOICE)

    kiso_by_id = {q["id"]: q for q in kiso["kisoQuestions"]}
    choice_by_id = {q["id"]: q for q in choice["choiceQuestions"]}

    ordered_ids = [i for g in GROUPS for i in g["ids"]]
    assert len(ordered_ids) == len(set(ordered_ids)), "章をまたいで重複したIDがある"

    # 移動元・移動先のどちらから来る問題かを確かめ、欠落があれば止める。
    moved, kept, missing = [], [], []
    for qid in ordered_ids:
        if qid in kiso_by_id:
            kept.append(qid)
        elif qid in choice_by_id:
            moved.append(qid)
        else:
            missing.append(qid)
    assert not missing, u"見つからない問題ID: %s" % missing

    # 削除対象が新章立てに残っていないことを確かめる。
    leftover = [i for i in DELETE_KISO + DELETE_CHOICE if i in ordered_ids]
    assert not leftover, u"削除対象が新章立てに残っている: %s" % leftover

    # --- kiso.json を組み直す ---
    kiso["meta"]["note"] = NEW_META_NOTE
    kiso["meta"]["source"] = (
        "高校古典文法の導入範囲（歴史的仮名遣い・文節と品詞・活用形と係り結び・接続・"
        "助動詞の形と意味）をもとにしたオリジナル4択問題"
    )
    kiso["kisoQuestions"] = [
        kiso_by_id[i] if i in kiso_by_id else choice_by_id[i] for i in ordered_ids
    ]
    # 統廃合後は入口の全問題を必修とする（追加練習に回す問題は無くなった）。
    kiso["kisoRequiredQuestionIds"] = list(ordered_ids)
    kiso["kisoGroups"] = [dict(g) for g in GROUPS] + [{
        "id": "kiso-all",
        "name": u"総仕上げ：%d問ランダム" % len(ordered_ids),
        "sub": "入口の6章をまとめて確認",
        "shuffle": True,
        "ids": list(ordered_ids),
    }]

    # --- multiple_choice.json から Chapter 1/3/5 を取り除く ---
    removed_choice = set(DELETE_CHOICE) | set(moved)
    choice["choiceQuestions"] = [
        q for q in choice["choiceQuestions"] if q["id"] not in removed_choice
    ]
    choice["choiceGroups"] = [
        g for g in choice["choiceGroups"]
        if g["id"] not in ("qa-chapter-1", "qa-chapter-3", "qa-chapter-5")
    ]
    remaining = {q["id"] for q in choice["choiceQuestions"]}
    choice["choiceRequiredQuestionIds"] = [
        i for i in choice["choiceRequiredQuestionIds"] if i in remaining
    ]
    for g in choice["choiceGroups"]:
        g["ids"] = [i for i in g["ids"] if i in remaining]
        if g["id"] == "qa-all":
            g["name"] = u"総仕上げ：%d問ランダム" % len(g["ids"])
    choice["meta"]["note"] = choice["meta"]["note"] + (
        "　2026-07-28：Chapter 1・3・5 を必修1「文法の入口」へ集約し、"
        "重複していた15問を削除して data/kiso.json へ移した。"
        "このファイルは Chapter 2・7・9（必修2・5・7）を扱う。"
    )
    choice["meta"]["source"] = "Chapter 2・7・9の古典文法学習項目をもとにしたオリジナル4択問題"

    dump(KISO, kiso)
    dump(CHOICE, choice)

    print("kiso.json: %d問（うち移動 %d問・元から %d問）／%d章＋総仕上げ"
          % (len(ordered_ids), len(moved), len(kept), len(GROUPS)))
    for g in GROUPS:
        print("  %s %s … %d問" % (g["id"], g["name"], len(g["ids"])))
    print("multiple_choice.json: %d問／必修%d問／グループ%d件"
          % (len(choice["choiceQuestions"]),
             len(choice["choiceRequiredQuestionIds"]),
             len(choice["choiceGroups"])))


if __name__ == "__main__":
    main()
