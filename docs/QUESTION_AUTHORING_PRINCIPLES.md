# 古文演習の問題作成原則

共通の作問原則は、次の文書を正本とします。

- [共通の学習用4択問題 作問原則](../../docs/QUESTION_AUTHORING_PRINCIPLES.md)
- [古文原則カードの作成基準](../../docs/kobun-principles/AUTHORING_STANDARD.md)

## このリポジトリで特に守ること

- `data/kiso.json`、`data/multiple_choice.json` は、一問一判断の文法問題にする。
- `data/shikibetsu*.json` は、手順本文（`procedures`）と本文中での実践問題を分ける。手順の事前学習は `data/preparation/` の予習資料が担う。
- 各文法問題の `ruleRefs` は、正答判定に使った `status: active` のカードだけを参照する。
- 接続・活用形・係り結び・敬語の方向など、形から確定できる根拠を先に説明する。
- 本文異同、主語補充、敬意の対象、和歌の解釈などに幅がある場合は、断定せず `要確認` または `needs-review` とする。
- 出典本文を使う場合は、作品名・章段・底本などを記録し、転記修正と教育目的の改稿を区別する。
- 同形語は語形だけで決めず、接続・文脈・文中の機能を選択肢と解説に反映する。

## 作成後の確認

```powershell
py -3 C:\Users\shtom\dev\kobun-practice-v2.1\scripts\quality_check.py --check
py -3 C:\Users\shtom\dev\kobun-practice-v2.1\scripts\check_rule_coverage.py --check
py -3 C:\Users\shtom\dev\docs\kobun-principles\scripts\check_principles.py
```

`README.md`、共通原則、対象分野の active 原則カードを順に参照します。
