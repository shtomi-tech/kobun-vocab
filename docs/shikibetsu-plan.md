# 識別セクション 実装設計（実装済み）

> **実装メモ（2026-07-11）**：本設計に沿って実装・デプロイ済み。実際の着地点は以下の点で本文の想定と異なる。
> - 作問数は28問（本文§5の60〜65は将来拡張の目安として残す。今回は各手順に procedure/condition/contrast/integration を最低1問ずつ揃えた最小完成形）。
> - c4進捗の移行処理は入れず、進捗リセット許容の方針を採用（§1・§7で保留としていた点）。
> - グループの出題順は `orderBy` のようなコード分岐を足さず、JSON側で procedure→condition→contrast→integration の順にidを並べるだけで実現（sessionIdsForGroupは無改修）。
> - ホームの「手順カード」は既存の「知識項目チェック」とは別に、手順本文（手順I〜IV）だけを表示する軽量カード（`renderProcedureStepsCard`）として追加し、両カードを併置。
> - 既存フィールド名（topic/step/questionType/coverageId）をそのまま踏襲し、`procedureId`/`qtype` という新フィールド名は使っていない（既存コードとの互換のため）。

対象：`kobun-vocab` に「識別」タブを新設し、助動詞などの**意味の識別手順**を
「手順確認 → 条件確認 → 対比 → 統合」の4種類の問題で定着させる。

初期スコープは Chapter 4（未然形接続の助動詞）の5手順：
**る・らる／す・さす・しむ／ず（ザリ系列）／む・むず／まし**。
将来、他の接続の助動詞や「ぬ・ね」「なむ」等の頻出識別を同じ構造で追加できるようにする。

---

## 0. 現状の資産（これを土台にする）

- `data/multiple_choice.json` の Chapter 4 に **c4-001〜c4-022（22問）** が既にあり、
  各問題は `questionType: "procedure" | "condition" | "contrast" | "integration"` と
  `coverageId` を持つ。今回の4種類の問題タイプと**完全に同じ分類**。
- `static/mode-katsuyo.js` に以下が実装済み：
  - 4択セッション（即採点・1〜4キー・requeue・習得判定 c≧2）
  - `coverageTopics` による**「手順 × 問題タイプ」のマトリクス表示**（知識項目チェックカード）
    と、項目単位の再出題
- よって新規実装は「新タブ＋新データファイル＋統合問題のステップ実行UI」に絞れる。

### 既存22問のタイプ分布と不足（データ作成タスクの根拠）

| 手順 | procedure | condition | contrast | integration |
|---|---|---|---|---|
| る・らる | 1 | 3 | 1 | 1 |
| す・さす・しむ | **0** | 2 | 1 | 1 |
| ず（ザリ系列） | **0** | 2 | **0** | 1 |
| む・むず | 1 | 2 | 1 | 1 |
| まし | **0** | 2 | 1 | 1 |

---

## 1. 方針決定（推奨案）

**KatsuyoApp（mode-katsuyo.js）に practiceSet `shikibetsu` を1つ追加する。**
独立した mode-shikibetsu.js を新設する案は、セッション管理・進捗・requeue・
4択描画（約400行）の重複になるため採らない。

- タブ構成：`単語｜助動詞｜用言｜文法4択｜識別`（app.js の APPS に1エントリ追加）
- 進捗キーは `shikibetsu:<問題id>`（既存の `currentSet.id + ":" + id` 方式のまま）
- クラウド同期は既存の kobun-katsuyo の progress マップに自動的に相乗り（変更不要）

### 既存 c4 問題の扱い（要決定・推奨あり）

**推奨：c4 の22問は新データ `data/shikibetsu.json` に移管・改番し、
`multiple_choice.json` から qa-chapter-4 グループと c4-* 問題・coverageTopics を削除する。**

- 理由：同じ問題が「文法4択」と「識別」に二重に出ると進捗が分裂し、二重管理になる。
- 影響：既存進捗のうち `choice:c4-*` は引き継がれない（配布開始直後のため許容と判断。
  引き継ぐ場合は移管時に旧idを `legacyId` として持たせ、progress 読み込み時に
  `choice:c4-*` → `shikibetsu:*` へ1回だけコピーする移行処理を入れる）。

---

## 2. データ設計：`data/shikibetsu.json`（新規）

```json
{
  "meta": {
    "source": "Chapter 4 未然形接続の助動詞の識別手順をもとにしたオリジナル問題",
    "note": "市販教材の設問文・例文をそのまま転記しない。統合問題の古文は著作権切れの古典本文か自作の文を使う。"
  },
  "procedures": [
    {
      "id": "rareru",
      "name": "る・らるの識別",
      "sub": "受身・可能・自発・尊敬",
      "chapter": 4,
      "steps": [
        { "no": "手順I",   "text": "上に「〜（誰々）に」があるか、補える場合は受身。" },
        { "no": "手順II",  "text": "下に打消の語があれば可能。" },
        { "no": "手順III", "text": "上に心情語や知覚を表す動詞があれば自発。" },
        { "no": "手順IV",  "text": "主語が偉い人の場合は尊敬。「仰せらる」の「らる」は絶対に尊敬。「れ給ふ・られ給ふ」の「れ・られ」は絶対に尊敬にならない。" }
      ]
    }
  ],
  "questions": []
}
```

- `procedures[].steps` は書籍の手順を**要約・再構成**して収録（転記しない）。
  ホームの手順カードと、統合問題のステップ見出しの両方で使う。
- `questions[]` は既存 choiceQuestions と同じフィールド
  （`id / question / choices / answerIndex / explanation`）に加えて：
  - `procedureId`：どの識別手順か（例 `"rareru"`）
  - `qtype`：`procedure | condition | contrast | integration`
  - 統合問題のみ `passage`（古文）・`target`（識別対象の語）・`steps[]`（下記）

### 問題タイプ別の型と作問方針

**(1) procedure 手順確認** — 「最初に何を確認するか」「◯◯の次に見るのは何か」
```json
{ "id": "sb-rareru-p1", "procedureId": "rareru", "qtype": "procedure",
  "question": "「る・らる」の意味を識別するとき、最初に確認するのはどれか。",
  "choices": ["上に「（誰々）に」を補えるか", "下に打消の語があるか", "主語が偉い人か", "上に心情語があるか"],
  "answerIndex": 0,
  "explanation": "手順は 受身（〜に）→可能（下に打消）→自発（心情・知覚）→尊敬（主語が偉い人）の順に確認する。" }
```

**(2) condition 条件確認** — 各手順が発動する条件を1つずつ
```json
{ "id": "sb-rareru-c1", "procedureId": "rareru", "qtype": "condition",
  "question": "「る・らる」が可能の意味になる条件はどれか。",
  "choices": ["下に打消の語がある", "上に「（誰々）に」がある", "主語が偉い人", "上に知覚動詞がある"],
  "answerIndex": 0, "explanation": "…" }
```

**(3) contrast 対比** — 間違えやすい2つの判断を並べて比較
```json
{ "id": "sb-rareru-t1", "procedureId": "rareru", "qtype": "contrast",
  "question": "「仰せらる」の「らる」と「れ給ふ」の「れ」の説明として正しいものはどれか。",
  "choices": [
    "「仰せらる」は絶対に尊敬、「れ給ふ」の「れ」は絶対に尊敬にならない",
    "どちらも絶対に尊敬",
    "どちらも文脈で決める",
    "「仰せらる」は文脈次第、「れ給ふ」の「れ」は絶対に尊敬"
  ],
  "answerIndex": 0, "explanation": "…" }
```

**(4) integration 統合** — 古文を示し、手順を最後まで適用して意味を決める。
**単発4択ではなくステップ実行形式**にする（ここだけ新UI）。
```json
{ "id": "sb-rareru-i1", "procedureId": "rareru", "qtype": "integration",
  "passage": "住み慣れし故郷のことぞ思ひ出でらるる。",
  "target": "らるる",
  "steps": [
    { "prompt": "手順I：上に「（誰々）に」があるか、補えるか。",
      "choices": ["補える → 受身", "補えない → 次の手順へ"],
      "answerIndex": 1, "explanation": "動作を受ける相手は示されておらず、補えない。" },
    { "prompt": "手順II：下に打消の語があるか。",
      "choices": ["ある → 可能", "ない → 次の手順へ"],
      "answerIndex": 1, "explanation": "「らるる」の下に打消はない。" },
    { "prompt": "手順III：上に心情語・知覚を表す動詞があるか。",
      "choices": ["ある → 自発", "ない → 次の手順へ"],
      "answerIndex": 0, "explanation": "「思ひ出づ」は心情を表す動詞。" },
    { "prompt": "最終判断：この「らるる」の意味は。",
      "choices": ["受身", "可能", "自発", "尊敬"],
      "answerIndex": 2, "explanation": "心情語「思ひ出づ」に付くので自発。「自然と思い出される」。" }
  ],
  "explanation": "心情語＋る・らる → 自発。手順を上から順に消去していけば迷わない。" }
```
- 全ステップ一発正解で「正解」、途中で1つでも誤ればその問題は「不正解」として
  記録・requeue（既存の採点・習得ロジックをそのまま使う）。
- 誤答ステップでは解説を見せた上で正しい分岐で次のステップへ進む（最後まで体験させる）。
- 既存 c4 の integration 問題（単発4択）は、移管時に steps 形式へ書き直す。

### coverage（知識項目チェック）の対応

既存の `coverageTopics` 形式をそのまま `shikibetsu.json` にも持たせる
（`topic` = 手順名、`items` = 手順×タイプの項目）。既存の renderCoverageCard が
無変更で「手順 × 4タイプ」マトリクスとして機能する。

### グループ（練習セット）構成

`shikibetsuGroups`（boot 時に生成でも JSON 直書きでも可。順序＝重要度順、最後が総仕上げ）：

1. 手順ごとの通しグループ ×5（例「る・らるの識別」＝その手順の全問を
   **procedure → condition → contrast → integration の順**で出題。タイプ内のみシャッフル）
2. タイプ横断グループ（例「対比だけ全手順」）… 初期実装では見送り可
3. 総仕上げ：全問ランダム

※ 通しグループの「タイプ順固定・タイプ内シャッフル」は既存 `sessionIdsForGroup`
（全体 shuffle or 固定順のみ）では表現できないため、group に `orderBy: "qtype"` を
持たせて `sessionIdsForGroup` に分岐を1つ足す。

---

## 3. UI 設計

### ホーム（識別タブ）

既存 choice モードのホームを流用しつつ、カード構成を以下にする：

1. **hero**：つづきから／苦手復習（既存ロジックそのまま）
2. **Progress**：習得数・苦手数（既存そのまま）
3. **手順カード ×5**（新規・groupList を置き換えるイメージ）：
   - 手順名＋サブ（「受身・可能・自発・尊敬」等）
   - `<details>` で手順I〜IVの本文を折りたたみ表示（演習前に確認できる）
   - 4タイプの習得バッジ（✓/□。coverage 判定を流用）＋タイプ別出題ボタン
   - 「この手順を通しで演習」ボタン（上記の通しグループを開始）
4. **知識項目チェック**：既存 renderCoverageCard がそのまま出る
   （3 と重複感が出る場合は、識別タブでは 3 に統合して coverage カードを非表示にする。
   実装時に画面を見て判断。まずは 3 を coverage カードの拡張として実装するのが最小）
5. その他（進捗リセット。既存そのまま）

### セッション

- procedure / condition / contrast：既存 `renderChoiceRow` を**そのまま**使用
  （ラベルは「CHAPTER/QUESTION」の代わりに「手順名・タイプ名」を表示）
- integration（`q.steps` があるとき）：新規 `renderStepRow`
  - 上部に `passage` を表示し、`target` の語を下線＋太字で強調
  - steps を1つずつ提示 → 選択即採点 → 解説表示 → 「次の手順へ」
  - 進行中に既回答ステップの選択結果を上に積み残す（判断の履歴が見える）
  - キーボード：1〜4で選択、Enterで次ステップ／次問題（既存 handleKey を拡張）

### デザイン

デザインスキル `claude` の既存デザイン言語に完全準拠（新スタイルは
手順カード・passage 表示・ステップ履歴の3ブロック分のみ追加。
アイボリー地・角丸0・影なし・下線強調・mono ラベルの既存ルールに従う）。

---

## 4. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `data/shikibetsu.json` | **新規**。procedures 5件＋questions（下記の作問計画）＋coverageTopics |
| `data/multiple_choice.json` | c4-* 22問・qa-chapter-4・coverageTopics を削除（識別へ移管） |
| `static/mode-katsuyo.js` | boot に shikibetsu.json の fetch 追加／practiceSet `shikibetsu` 追加／`orderBy:"qtype"` 対応／手順カード描画／`renderStepRow`／handleKey 拡張 |
| `static/app.js` | APPS に `{ id:"shikibetsu", tag:"IDENTIFY", label:"識別", … }` を追加 |
| `index.html` | 変更不要（スクリプト追加なし）。キャッシュバスターの `?v=` 更新のみ |
| `README.md` | 識別タブの説明を1段落追加 |

---

## 5. 作問計画（データ拡充）

移管22問＋新規作成で、各手順につき最低：

- procedure ×2（「最初に見るもの」「◯◯の次に見るもの」）
- condition ×分岐数（る・らる4、す・さす・しむ2、ず2、む・むず3、まし2〜3）
- contrast ×2（例：れ給ふ vs 仰せらる／使役 vs 尊敬の「す・さす」／本活用 vs 補助活用の使い分け／二人称の「む」＝適当・勧誘 vs 意志／反実仮想 vs ためらいの意志）
- integration ×3（ステップ形式。古文は著作権切れ古典または自作文）

→ 合計 約60〜65問。特に不足している「す・さす・しむ／ず／まし の procedure」
「ず の contrast（本活用と補助活用は下に助動詞が付くかで決まる）」を優先。

---

## 6. 実装ステップと完了条件

1. `shikibetsu.json` 骨格（procedures 5件＋各手順1問ずつ計20問未満のシード）
   - 完了条件：JSON が parse でき、全 questions の procedureId / qtype / answerIndex が妥当（検証スクリプトで機械チェック）
2. mode-katsuyo.js への set 追加＋タブ追加（既存4択UIのまま出題できる状態）
   - 完了条件：識別タブで手順別グループを開始→採点→requeue→完了画面まで通る
3. 手順カード（ホーム）＋ orderBy:"qtype"
   - 完了条件：手順本文が折りたたみで見え、通し演習がタイプ順で出題される
4. renderStepRow（統合問題のステップ実行）
   - 完了条件：誤答ステップで解説→正しい分岐で最後まで進み、問題全体は不正解として requeue される
5. c4 移管と multiple_choice.json からの削除
   - 完了条件：文法4択に Chapter 4 が出ない／識別側に全問ある／他章の進捗が壊れていない
6. 作問拡充（§5）
7. 検証：ローカルサーバーで全タイプを実際に解く／localStorage キー確認／
   1〜4キー・Enter 動作／スマホ幅表示／既存3タブの回帰確認

---

## 7. 保留・要判断事項

- **c4 進捗の移行処理を入れるか**（§1。推奨は「入れない」＝進捗リセット許容）
- ホームで「手順カード」と既存「知識項目チェック」を併置するか統合するか（§3）
- タイプ横断グループ（「全手順の対比だけ」等）を初期リリースに含めるか（推奨：見送り）
- 統合問題の古文の出典方針：著作権切れ原文の短文引用＋自作文の混在で問題ないか
