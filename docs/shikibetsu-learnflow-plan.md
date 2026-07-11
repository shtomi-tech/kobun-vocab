# 識別セクション 学習フロー化 実装計画

> 作成日：2026-07-11。前提となる識別タブ本体の設計・実装記録は `shikibetsu-plan.md` を参照。
>
> **実装メモ（2026-07-11）**：本計画に沿って実装・デプロイ済み。実際の着地点は以下の点で本文の想定と異なる。
> - フロー完了判定（§1）は当初案の「isMastered（累計2回正解）」ではなく、
>   「そのステージの全問が最低1回正解済み（`rec.c >= 1`）」を基準にした
>   （`shikibetsuIdCleared`）。既存セッションは誤答をキュー末尾に再出題し続け、
>   全問正解するまで終わらないため、1周＝全問1回正解が保証される。
>   mastered基準（2回正解）のままだと1周しただけでは完了扱いにならず、
>   「次の手順」に進めずに同じ手順へのループが発生したため修正した。
> - ホームの手順学習カードの状態表示ラベルは「習得」ではなく「完了」とした
>   （既存の苦手復習・進捗バーが使う「習得済み」の基準（2回正解）と紛れるため）。
> - §1で保留としていた「STEP 1 の既読記録」は持たない方針のまま実装。
> - §6「手順別グループの扱い」は推奨どおり、識別タブのグループ一覧を総仕上げ（`sb-all`）のみに絞った。
> - integration 作問追加（§4）は見送り（各手順1問のまま）。
>
> **追記（2026-07-11・粒度統一）**：4択問題（procedure/condition/contrast）の粒度が手順間で
> 不揃い（procedureの段数・conditionの意味網羅・contrastの性質がばらばら）だったため、
> `data/shikibetsu.json` に4問追加＋3問書き直しを行い、全手順を
> 「procedure×2（最初の手がかり→次の分岐）→condition×意味の数→contrast×1（手がかり競合）→integration×1」
> の同じ型に統一した（23問→27問）。追加：`sb-rareru-cond-ukemi`（受身の条件）／
> `sb-sasu-proc2`（使役への分岐）／`sb-mu-cond3`（適当・勧誘の条件）／
> `sb-mashi-proc2`（反実仮想への分岐）。書き直し（ID維持・内容差し替え、進捗への実害なし）：
> `sb-mu-cont1`（ラベルのみ「意志との訳し分け」に変更）／
> `sb-mashi-cond2`（「反実仮想の訳」→「ためらいの意志の条件」）／
> `sb-mashi-cont1`（「ためらいの意志」→「手がかりの競合」、疑問詞と条件節が両方見えるときの優先順位を問う内容に変更）。
> JS側の変更は無し（総問題数・グループはJSONから動的に導出されるため）。
> キャッシュバスターのみ更新（`shikibetsu.json?v=20260711-2`、`mode-katsuyo.js?v=0.5.0`）。
>
> **追記（2026-07-11・実践問題の意味別拡充）**：実践問題（integration）が各手順1問のみで
> 特定の意味に偏っていたため、7問追加して**各手順の全意味を1問ずつカバー**した
> （る・らる：受身・可能・自発・尊敬の4問／す・さす・しむ：使役・尊敬の2問／
> む・むず：意志・推量・適当勧誘の3問／まし：反実仮想・ためらいの意志の2問。計11問、総計27→34問）。
> - steps配列は「その意味が確定する手がかりが立った時点で最終判断に進む」構成にした
>   （例：受身は手順Iのみで2ステップ、尊敬は手順I〜IVを全部通って5ステップ）。
>   意味によって手順を踏む深さが違うことを体感させる設計。
> - `step`フィールド（画面上部のラベル）は解答前に意味が漏れないよう、
>   全問「統合①」「統合②」…という中立な番号にした（意味名を含めると解く前に答えが分かってしまうため）。
>   既存の `sb-*-int1`（旧「手順の統合」）もこの番号方式に統一。
> - ID・group・coverageTopicsを更新。既存IDは維持（進捗互換）、新規IDは意味名で命名
>   （`sb-rareru-int-ukemi`／`sb-sasu-int-sonkei`／`sb-mu-int-suiryou`／`sb-mu-int-kanyuu`／`sb-mashi-int-tamerai` 等）。
>
> **追記（2026-07-11・導線の一本化）**：識別タブの「知識項目チェック」（coverageカード）と
> 「練習グループを選ぶ」（グループ一覧）を削除し、手順学習カード（つづきから／この手順を学習する）
> のみに一本化した。他タブ（助動詞・用言・文法4択）はこれらのカードを維持している
> （`renderHome` 内で `currentSet.id !== "shikibetsu"` の条件分岐を追加）。

対象：`kobun-vocab` の識別タブに、`eiken2-q1` 第1問と同じ
**「STEP 1 内容理解 → STEP 2 4択問題 → STEP 3 実践問題」** の3段階学習フローを追加する。

- eiken2-q1 側の対応物：flash（暗記カード）→ check（意味チェック）→ practice（本番形式）
  （`eiken2-q1/static/mode-q1.js` の `stage: "flash" | "check" | "practice" | "done"` 状態機械）
- kobun-vocab 側の対応物：
  - 内容理解 ＝ `procedures[].steps`（手順I〜IV。現在はホームの折りたたみカードで読めるだけ）
  - 4択問題 ＝ `questionType: procedure / condition / contrast` の単発4択（実装済み）
  - 実践問題 ＝ `questionType: integration` のステップ実行問題（`renderStepRow` 実装済み）

つまり**3ステップの部品はすべて既存**。足りないのは「手順単位で3段階を順に通す
フロー管理」と「ホームからの導線・進捗表示」だけ。

---

## 0. 現状の資産（2026-07-11 時点）

- `data/shikibetsu.json`：4手順（る・らる／す・さす・しむ／む・むず／まし）・23問。
  タイプ分布は procedure 6 / condition 9 / contrast 4 / **integration 4（各手順1問）**。
- `static/mode-katsuyo.js`（1,027行）：
  - `startSession(ids, title)`：キュー方式のセッション。即採点・requeue・`recordResult`（c/w/weak）・
    習得判定 c≧2・完了画面 `renderDone` まで一式。
  - `renderChoiceRow`（単発4択）と `renderStepRow`（統合ステップ実行）は
    `q.steps` の有無で自動で切り替わる。
  - ホーム：hero（主導線1本）／Progress／手順カード（手順本文の折りたたみ）／
    知識項目チェック（coverage マトリクス）／グループ一覧。
- グループ：手順別4グループ（タイプ順固定）＋総仕上げ `sb-all`（ランダム23問）。

---

## 1. 方針（推奨案）

**mode-katsuyo.js に「フロー層」だけを足す。新ファイル・新進捗スキーマは作らない。**

- セッションエンジン（queue / requeue / recordResult / renderChoiceRow / renderStepRow）は
  無改修で流用し、`session.flow = { procId, stage }` というフロー文脈を持たせる。
  フローが無い従来セッション（総仕上げ・coverage再出題・苦手復習）は完全に従来動作。
- eiken2-q1 の `unit(q).learned` に相当する**新しい進捗フィールドは持たない**。
  - フロー完了状態は既存の c/w 進捗から**導出**する：
    - STEP 2 済 ＝ その手順の procedure+condition+contrast が全問 mastered
    - STEP 3 済 ＝ その手順の integration が全問 mastered
  - STEP 1（内容理解）は eiken の flash と同じく「フローの先頭で毎回読む」ものとし、
    既読フラグは記録しない（読み直しは害でなく益。進捗スキーマ・cloud同期とも無変更で済む）。

### フローの状態機械

```
startShikibetsuFlow(procId)
  → stage "understand"（手順カードを1枚ずつ読む）
  → stage "quiz"     （procedure → condition → contrast の順で4択。既存セッション）
  → stage "practice" （integration をステップ実行。既存セッション）
  → stage "done"     （完了バナー＋次の手順への導線）
```

- quiz / practice は `startSession` をそのまま使い、**セッション完了画面
  （renderDone）だけをフロー用に分岐**する：
  - flow あり・quiz 完了 → 主ボタン「実践問題へ進む →」
  - flow あり・practice 完了 → stage "done" の完了画面（次の手順 or ホームへ）
  - requeue の挙動は従来どおり（間違えた問題はそのセッション内で解き直すまで終わらない）。
    したがって「STEP 2 を抜けた＝その場では全問正解済み」となり、eiken の
    needsReview 相当は既存の weak（苦手復習）がそのまま担う。

---

## 2. UI 設計

### STEP 1 内容理解（新規 `renderUnderstand`）

eiken2-q1 の flash（1カードずつ・前へ/次へ・最後に「次のSTEPへ→」）を踏襲：

1. 手順I〜IVを**1手順＝1カード**で順に表示
   （カード＝手順番号（mono ラベル）＋手順本文。`sub`（受身・可能・自発・尊敬 等）を冒頭カードに）
2. 最終カードの次に**手順全体の一覧カード**（ホームの `procedureStepList` を流用）を挟み、
   「4択問題へ進む →」で stage "quiz" へ
3. ナビ：「← 前へ」「次へ →」、カードカウンタ（`カード n / m`）
4. eiken の `FLASH_NAV_GUARD_MS`（誤連打ガード）相当は初期実装では省略可
   （katsuyo 側に前例がなく、問題が出たら足す）

### ステージバー（新規・フロー時のみ）

`renderSessionChrome` の下に eiken の `stageBar` 相当を追加：
`1 理解 → 2 4択 → 3 実践` の3ピル。現在ステージを反転、通過済みに ✓。
デザインは既存デザイン言語（角丸0・影なし・下線／反転強調）に従い、
eiken の stagePill の見た目はコピーせず kobun-vocab の styles.css に合わせて新設する。

### STEP 2 4択（既存流用）

- 出題 ids：その手順の questions を `questionType` で
  **procedure → condition → contrast の順**に並べ、タイプ内のみシャッフル
  （integration は除外。既存グループ ids は使わず、フロー側でフィルタ・整列する）。
- 画面は既存 `renderChoiceRow` 無改修。1〜4キー・Enter も既存 `handleKey` のまま動く。

### STEP 3 実践（既存流用）

- 出題 ids：その手順の integration のみ（現状1問。§4で拡充）。
- 画面は既存 `renderStepRow` 無改修。

### 完了画面（stage "done"）

eiken の `renderDone` を参考に：完了バナー（手順名＋一発正解数）＋
「次の手順を学習する →」（未完了の次手順があれば）＋「ホームへ戻る」。

### ホーム（識別タブ）

既存「識別手順を確認する」カード（`renderProcedureStepsCard`）を**手順学習カードに拡張**：

- 手順ごとに1ブロック：
  - 手順名＋sub＋状態表示（`4択 習得 x/n ・ 実践 習得 x/m` を既存進捗から導出）
  - 主ボタン**「この手順を学習する」**（＝ startShikibetsuFlow。3ステップ通し）
  - `<details>` の手順本文閲覧は従来どおり残す（演習前の確認用）
- hero の主導線：苦手復習が無いときは「つづきから＝最初の未完了手順のフロー開始」を出す
  （既存 `firstIncompleteGroup` の代わりに、フロー完了導出ロジックで未完了手順を選ぶ）。
- **グループ一覧の手順別4グループはフロー開始ボタンと導線が重複するため、
  識別タブでは総仕上げ `sb-all` のみ表示**に絞る（Hickの法則。他タブは従来どおり）。
  coverage カード（項目単位の再出題）は補助導線としてそのまま残す。

### キーボード

- understand ステージ：Enter＝次カード（`handleKey` に分岐を1つ追加）。
- quiz / practice：既存のまま（1〜4選択・Enter次へ）。

---

## 3. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `static/mode-katsuyo.js` | フロー層追加：`startShikibetsuFlow` ／ `renderUnderstand` ／ステージバー／ `renderDone` のフロー分岐／ホーム手順学習カード／hero 主導線／識別タブのグループ一覧絞り込み／ `handleKey` の understand 対応 |
| `data/shikibetsu.json` | integration 作問追加（各手順 +2問、§4）。**構造変更なし** |
| `static/styles.css` | ステージバー・理解カード・手順学習カードの3ブロック分のみ追加（デザインスキル `claude` 準拠） |
| `index.html` | 変更なし（`?v=` キャッシュバスター更新のみ） |
| `README.md` / `docs/shikibetsu-plan.md` | 学習フローの説明を追記／実装後に本計画へ実装メモを追記 |

変更しないもの：進捗スキーマ（c/w/weak）・cloud 同期・他3タブ・
`shikibetsuGroups` / `coverageTopics` の JSON 構造。

---

## 4. データ拡充（実装から独立・並行可）

- 実践（integration）が各手順1問では STEP 3 が薄い。**各手順 +2問（計3問/手順）**を
  ステップ形式で作問する（古文は著作権切れ古典本文か自作文。市販教材の転記をしない）。
- 初期リリースは現状の1問/手順でもフローとして成立するため、作問は最終ステップに回す。

---

## 5. 実装ステップと完了条件

1. **フロー骨格**：`startShikibetsuFlow` ＋ understand → quiz → practice → done が通る
   - 完了条件：手順を選ぶと手順カード→4択→実践→完了画面まで途切れず進み、
     途中の「中断してホームへ」でも進捗（c/w）が保存されている
2. **ホーム改修**：手順学習カード・hero 主導線・グループ一覧の絞り込み
   - 完了条件：各手順の習得状況（4択 x/n・実践 x/m）が進捗と一致し、
     「つづきから」が最初の未完了手順を指す
3. **ステージバー・完了画面・次手順導線**
   - 完了条件：現在ステージの表示が正しく、done から次の未完了手順へ直接進める
4. **キーボード＆検証**
   - 完了条件：understand で Enter 送り、quiz/practice で 1〜4・Enter が従来どおり。
     ローカルサーバーで全手順を1周通し、スマホ幅で確認。
     回帰：単語・助動詞・用言・文法4択タブ／識別の総仕上げ・coverage 再出題・
     苦手復習がフロー外で従来どおり動く。localStorage キーが増えていないこと
5. **integration 作問追加（§4）**＋検証スクリプトで answerIndex / steps の機械チェック

---

## 6. 保留・要判断事項

- **STEP 1 の既読記録**：持たない（推奨・上記のとおり）。「学習済み」バッジが
  どうしても欲しくなったら、その時に `flow:<procId>` レコード追加を再検討。
- **手順別グループの扱い**：総仕上げのみ残す案（推奨）で導線重複を解消するが、
  「4択だけ通しでやり直したい」ニーズが出たら coverage カードで代替できるか実運用で確認。
- **kyouzai-bank 連携**：`shikibetsu.json` は現在 `kyouzai-bank/sources.json` に
  **未登録**（登録済みは vocab.json と multiple_choice.json のみ）。
  識別問題も教材バンクに蓄積するなら sources.json への追加が別途必要（本件とは独立）。
