# 教材目次46講 対応マップ

`data/curriculum.json` の正本と対になる監査記録。`.hermes/plans/2026-08-17_165814-textbook-toc-curriculum-reorder.md` のTask1〜8に対応する。

現行検証: `py -3 scripts/check_curriculum.py --structure` → OK。
`py -3 scripts/check_curriculum.py --release` → OK（46講すべてready）。

## 現行実装（2026-08-18）

`data/curriculum.json` を教材目次の正本とし、6章46講を1講1ステージとして表示する。講の完了は必修活動の完了で、46講で文法コースを完了する。文法混合確認と発展学習は採用しない。

- 予習: `preparation[]` の実在ファイルと `sections[]` を `scripts/audit_preparation_checks.py` で検査。
- 進捗: 旧問題別正解記録を読み取り、`kobun-katsuyo-path-v2.lessonCycles` へ冪等に移行。
- 境界: `ids` とprocedureの `stepRange` で、13/14講、15/16講、31/32講、45/46講などの分割を固定。
- 復習: 講復習・章復習・苦手復習を同じ問題セッションの外側の活動キューで連結。
- 品質: 追加した問題は `quality_check.py --check`、原則参照は `check_rule_coverage.py --check` で検査。

以下の監査表・申し送りは、実装前に行った状態の履歴である。現在のstatus判断には使わない。

## 履歴: 2026-08-18追記 blocked6講の解消

ユーザーの明示的な許可（「Webリサーチをして着手してください」）に基づき、10・29・30・35・36・43講について、複数の信頼できる情報源（学習サイト・参考書コンテンツ）をWebSearch/WebFetchで調査したうえで、`docs/kobun-principles`に原則カードを新設・更新し、`data/shikibetsu-homograph.json`・`data/kiso.json`・`data/multiple_choice.json`・`data/shikibetsu-joshi.json`にオリジナルの新規問題を追加した。全問題は既存の作問形式（`AUTHORING_STANDARD.md`・`QUESTION_AUTHORING_PRINCIPLES.md`）に従い、特定文学作品からの転記はしていない。

| 講 | 新設・更新した原則カード | 追加内容 |
|---:|---|---|
| 10 | `kbp.verbs.shimo-nidan-memorize`（verification→source-checked、範囲拡張：心得・所得を追加） | `data/kiso.json`に`kiso-katsuyo-gyou`グループ・5問 |
| 29 | 既存`kbp.disambiguation.ramu-identification`（active、更新不要） | `data/shikibetsu-homograph.json`に新procedure`h-ramu`・6問 |
| 30 | `kbp.disambiguation.se-identification`（新設、active・source-checked） | `data/shikibetsu-homograph.json`に新procedure`h-se`・5問 |
| 35 | `kbp.particles.kakari-musubi-basic`（draft→active・source-checked） | `data/multiple_choice.json`に`c7-018〜023`・6問 |
| 36 | `kbp.particles.kakari-musubi-omission`／`kakari-musubi-nagare`（既存active、出典追記。**監査時の「資産皆無」は誤りで、実際は実践問題のみ未整備だった**） | `data/shikibetsu-joshi.json`に新procedure`kakari-ellipsis`・6問 |
| 43 | `kbp.disambiguation.shi-identification`／`te-identification`（新設、active・source-checked） | `data/shikibetsu-homograph.json`に新procedure`h-shi`・`h-te`・計8問 |

各作業はWebSearch/WebFetchを使う独立したAgentへ並列委任し、共有ファイル（`data/shikibetsu-homograph.json`・`scripts/quality_check.py`等）への同時書き込みが発生したが、事後に`python scripts/quality_check.py --check`・`check_rule_coverage.py --check`・`check_principles.py`・`check_preparation.py`を実行し、データ欠損・競合が無いことを確認済み。

### 統合後の実ブラウザ検証で発見・修正した不具合

curriculum.jsonへ6講を統合した後、実ブラウザ（`python -m http.server`）で30・43講が「0/0」と表示され演習を開始できない不具合を発見した。原因は2つ。

1. **`homographRequiredQuestionIds`への未登録**（実質バグ）: 新設procedure `h-se`・`h-shi`・`h-te`の実践問題が`data/shikibetsu-homograph.json`の`homographRequiredQuestionIds`に1件も登録されておらず、`shikibetsuPracticeIds()`のフィルタ結果が空になっていた（`h-ramu`・`kakari-ellipsis`は各Agentが正しく登録済みだった）。→ 該当14問すべてを追加し、`scripts/quality_check.py`の必修数ハードコード（15→28）も更新。
2. **`fetch`のバージョンクエリ文字列固定によるブラウザキャッシュ**: `static/mode-katsuyo.js`の`boot()`が`data/kiso.json?v=20260801-1`のように固定文字列でfetchしており、データファイル更新後もブラウザが旧内容をキャッシュし続けていた（本番運用でも起こりうる）。→ 今回変更した4ファイル（kiso/multiple_choice/shikibetsu-joshi/shikibetsu-homograph）のバージョンを`20260818-1`へ更新。

さらに、`scripts/check_curriculum_progress.py`のfixture4（旧10必修完了済みユーザー）が、新規追加した6講の問題に旧進捗データが正解記録を持たないのは当然にもかかわらず「全講完了のはず」という古い期待値のままFAILしたため、`scripts/check_curriculum_progress.mjs`のfixture4検証を「この6講は新規内容として未完了のままでよい」という期待値に更新した。

修正後、`check_curriculum.py --structure`・`--release`（27講ready）・`quality_check.py --check`・`check_rule_coverage.py --check`・`check_curriculum_progress.py`（51 PASS）・実ブラウザのコンソールエラーなし・全新規講のラベル/件数表示を確認済み。

## 履歴: 監査方法

Chapter単位で6件の並列監査を実施し、各Chapterの担当者が実際に以下を読んで検証した。

- 該当データファイル（`data/kiso.json`・`data/katsuyo.json`・`data/multiple_choice.json`・`data/shikibetsu.json`・`data/shikibetsu-joshi.json`・`data/shikibetsu-homograph.json`）の問題文・選択肢・正答・解説
- 該当予習資料（`data/preparation/kobun-0*.md`）の本文と `:::check` セクション
- `C:/Users/shtom/dev/docs/kobun-principles/` の原則カード（`status`/`verification`を確認）
- `static/mode-katsuyo.js` の現行 `GRAMMAR_PATH`/`PREPARATION_PATHS`

目次タイトルだけからの新規問題作成は行っていない。教材本文が必要な箇所は `blocked` のまま残した。

## 履歴: 全体サマリー

| status | 講数 | 講番号 |
|---|---:|---|
| ready | 27 | 01,02,03,06,07,08,09,10,11,18,19,20,21,22,23,24,25,26,27,28,29,30,35,36,37,43,44 |
| partial | 19 | 04,05,12,13,14,15,16,17,31,32,33,34,38,39,40,41,42,45,46 |
| blocked | 0 | （2026-08-18に全解消。詳細は上記追記を参照） |

「partial」は教材項目としての帰属は正しいが、演習量・予習カバレッジ・識別対象の分割根拠のいずれかに具体的な欠陥がある状態。「blocked」は対応する既存資産がなく、目次タイトルからの推測作成を避けるため空のまま置いている。

## 履歴: Chapter別ステータス表

### Chapter 1 基本知識（01〜05講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 01 | 歴史的仮名遣い 文字編 | ready | `kiso-yomi`の3問（ゐ・ゑ・を／ぢ・づ／くわ・ぐわ）と予習が1:1対応 |
| 02 | 歴史的仮名遣い 発音編 | ready | 残り4問（語頭ハ行・母音連続×2・読み手順）と予習が1:1対応 |
| 03 | 品詞・活用 | ready | `kiso-bunsetsu`8問そのまま。`kiso-structure`（文の成分と省略、目次外）を補助教材として関連付け |
| 04 | 活用形 | partial | k-kei-06（終止形の見分け方）の正答根拠「終止形接続の語が続く」が予習本文に明示されていない |
| 05 | 係り結びの法則 | partial | k-kei-08・c1-010の予習カバレッジが薄い（専用ボード・専用チェックなし） |

**申し送り**: `c1-010`はこの講の必修専有とし、Chapter5・35講では再利用しない（35講は別途blocked、下記参照）。

### Chapter 2 用言（06〜12講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 06 | 動詞① 上一段・下一段 | ready | |
| 07 | 動詞② カ変・サ変 | ready | 予習セクションを08講と共有（`sharedReason`明記） |
| 08 | 動詞③ ナ変・ラ変 | ready | 予習セクションを07講と共有 |
| 09 | 動詞④ 四段・上二段・下二段 | ready | 「ずを付ける判定」実践8問（c2-031〜038）を中心に構成 |
| 10 | 動詞⑤ 行を押さえるべき動詞 | **blocked** | 対応資産なし。原則カード`kbp.verbs.shimo-nidan-memorize`(active、ただしverification: user-principleで教材本文突合未確認)が候補 |
| 11 | 形容詞 | ready | `c2-023`（意図的に必修ルートから外されていた孤立問題）を再登録。ユーザー確認推奨 |
| 12 | 形容動詞 | partial | 必修候補が活用表2語＋1問のみで演習量が薄い |

**発見事項**: `k-sound-01〜03`（音便）と`kobun-02-sound.md`/`kobun-02-yougo-yaku.md`の語幹用法説明に内容重複あり（削除は範囲外のため未対応）。

### Chapter 3 助動詞（13〜26講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 13 | 活用① 特殊型「ず・き・まし」 | partial | 対象語(no.6,10,12)は`katsuyo.json`の`type==="特殊型"`で機械抽出可能。予習が接続グループ単位のため専用資料がない |
| 14 | 活用② その他 | partial | 残り25語。活用型が9種にまたがり分量の妥当性は要検討 |
| 15 | 接続① | partial | 予習資料の第4節が15講(基本)と16講(ラ変注意)を1つのH2に同居させ、分離できていない |
| 16 | 接続② | partial | 同上。`k-set-10`（接続助詞ば）はChapter5領域の可能性がありここでは対象外 |
| 17 | ず／たし・まほし／らし／めり／ごとし | partial | ず・まほしは抽象1問のみで本文つき実践なし |
| 18 | き・けり／たり・り | ready | |
| 19 | つ・ぬ | ready | |
| 20 | す・さす・しむ | ready | |
| 21 | なり（断定／伝聞推定） | ready | **計画からの意図的逸脱**（下記参照） |
| 22 | まし | ready | |
| 23 | る・らる | ready | |
| 24 | けむ・らむ | ready | `sb-ramu`/`sb-kemu`は純粋な意味・時制判断のみと確認。29講と共有なし |
| 25 | む・むず／じ | ready | |
| 26 | べし・まじ | ready | |

**重要：計画書との差分（要ユーザー確認）**
計画書は21講について「基本意味と識別を一講に統合」と指示していたが、監査の結果、`proc-h-nari`（なりの識別4問）はChapter5の31・32講が識別procedureとして専有する設計と衝突することが判明した。単純重複禁止（`sharedReason`必須ルール）を優先し、**21講は`proc-nari`（断定/存在の基本意味）のみを必修とし、識別部分（`proc-h-nari`）は31・32講に譲る**よう変更した。これは計画書の文言と異なる意図的な逸脱であり、ユーザー確認を推奨する。

**「断定のたり」（katsuyo no.26, `src-jd09-q05`）**は13〜26講のどこにも割り当てられていない孤立資産（未確定）。

### Chapter 4 助動詞が絡む識別（27〜29講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 27 | ぬ・ねの識別 | ready | |
| 28 | る・れの識別 | ready | |
| 29 | らむの識別 | **blocked** | 既存`proc-ramu`は意味判断のみで文字列識別（エ段+らむ＝り+む／ア段+らむ＝ラ変+む）の実践問題が無い。原則カード`kbp.disambiguation.ramu-identification`(active)はあるため作問のみ残作業 |

### Chapter 5 助詞（30〜42講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 30 | 「せ」の識別 | **blocked** | 対応資産・原則カードともに存在しない |
| 31 | なりの識別 基本編 | partial | `proc-h-nari`のうち接続だけで即断できる2問（hg-nari-int1,2） |
| 32 | なりの識別 応用編 | partial | 残り2問（hg-nari-int3,4）。**ラ変型連体形を使う例文が既存4問に1つもない**（計画Task7手順3の要求未達） |
| 33 | 接続助詞① ば・とも・ど／ども | partial | 「ば」は充実。「とも」は接続知識のみ。「ど・ども」は問題ゼロ（原則カード`kbp.particles.tomo-do-domo-meanings`はactive・source-checked、出典33講明記だが未作問） |
| 34 | 接続助詞② その他 | partial | で・ながら・つつ・もの系のうち「で」以外3種が問題ゼロ（対応する原則カード4枚は全てactive・source-checked、出典34講明記） |
| 35 | 係助詞① 意味／疑問・反語 | **blocked** | `kbp.particles.kakari-musubi-basic`はstatus:draftで使用不可。`choice-koou`は対応表の想定と異なり疑問・反語を含まないと確認。c1-010は05講専有のためここでは使わない |
| 36 | 係助詞② 結びの省略・流れ | **blocked** | 「流れ」の資産皆無。「省略」候補(c7-010)は37講と内容重複 |
| 37 | 係助詞③ 逆接強調・危惧 | ready | 「通常の強意」が正解になる問題が無い点は要確認 |
| 38 | 終助詞① 願望 | partial | ばや・てしがな/にしがなは本文つき実践なし（知識問題のみ） |
| 39 | 終助詞② 禁止・念押し・詠嘆 | partial | 詠嘆は原則カードすら無い。既存`c7-016`のラベリング（かな＝願望）が一般的な学校文法（かな＝詠嘆）と食い違う（要確認） |
| 40 | 格助詞「の」 | partial | 5用法中、本文付き実践で正解になるのは主格のみ(1/5)。「連用修飾格」は出典不明の分類 |
| 41 | 副助詞① だに（類推）・さへ | partial | さへは知識問題1問のみ、原則カードなし |
| 42 | 副助詞② だに（最小限）・し | partial | 副助詞「し」は資産ゼロ（30講「せ」・43講「し・て」と並ぶ空白領域） |

**発見事項（重要）**: 33・34・41講は「原則カードはactiveだが対応する問題が無い」という同型の空白が複数見つかった。これらのカードは教材本文由来（出典に「Chapter5・○○講」と明記）のため、**新規問題作成の障害はカード不足ではなく作問そのものの未着手**であり、次の着手候補として優先度が高い。

### Chapter 6 助詞が絡む識別（43〜46講）

| 講 | 内容 | status | 主な論点 |
|---:|---|---|---|
| 43 | 「し」「て」の識別 | **blocked** | 対応資産・原則カードともに存在しない。何を指すか複数候補があり教材本文が必要 |
| 44 | 「なむ」の識別 | ready | 予習・procedure・実践が完全対応 |
| 45 | 「に」の識別① | partial | 対応表の「後続語を使う応用判定」という説明が実データ（訳し分け・語彙暗記が根拠）と不一致。ここでは「完了・断定・格助詞の一次判定」を45講とする代替案を採用（要確認） |
| 46 | 「に」の識別② | partial | 「接続助詞の消去法＋形容動詞語尾・副詞の語彙判定」。procedure本文（手順I〜IV）が45/46講で全文重複表示される実装上の懸念あり |

## 履歴: blocked講（6件）に共通する対応方針

以下はすべて「対応する既存資産・原則カードが確認できない」ため空のまま。**教材本文（該当ページ）の提示、または検証済みの原則カード整備が着手条件**。

| 講 | 何が必要か |
|---:|---|
| 10 | `kbp.verbs.shimo-nidan-memorize`の語彙(得／植う・飢う・据う／老ゆ・悔ゆ・報ゆ)が対象教材の10講本文と一致するかの確認。一致後、活用表・kiso問題・予習資料を新規作成 |
| 29 | 「らむ」の文字列識別（ウ段/エ段/ア段接続での判別）を問う新規実践問題。原則カードは既存 |
| 30 | 「せ」の識別が何を指すか自体が未確定。教材本文の提示が必要 |
| 35 | 係助詞の基本的意味を裏付ける原則カード(`kbp.particles.kakari-musubi-basic`)をactiveへ昇格させるための教材本文確認、または新規カード整備 |
| 36 | 「結びの省略・流れ」の教材本文確認。「流れ」は説明自体が既存資料に存在しない |
| 43 | 「し」「て」の識別が何を指すか自体が未確定（副助詞し＋接続助詞て／過去の助動詞きの連体形し等、複数候補）。教材本文の提示が必要 |

## 履歴: 未確認・要ユーザー判断事項（横断）

1. **21講とproc-h-nariの扱い**（上記Chapter3参照）— 計画書の「統合」指示から意図的に逸脱した。承認が必要。
2. **c2-023の11講再登録**（Chapter2）— 過去に意図的に必修ルートから外された経緯があるため確認推奨。
3. **32講のラ変型連体形の例文不足**（Chapter5）— 新規問題が必要。
4. **40講「連用修飾格」の出典不明**（Chapter5）— 5用法目としてよいか、削除すべきか要確認。
5. **39講の「かな」ラベリング不整合**（Chapter5）— 既存`c7-016`が「かな＝願望」としている点と一般的な学校文法用語の食い違い。
6. **45/46講の分割案**（Chapter6）— 対応表の「後続語」という説明と実データが一致しないため代替案（一次判定 vs 消去法・語彙判定）を採用。承認が必要。
7. **45/46講のprocedure本文重複表示**（Chapter6）— `h-ni`の手順テキストが1オブジェクトのため、講ごとの部分表示に実装対応が必要になる可能性。
8. **孤立資産**: `data/preparation/kobun-01-bun-no-hone.md`（未参照ファイル）、katsuyo.json no.26「断定のたり」（未割り当て）。

## 履歴: 次のステップ

- Phase B（Task 3〜4: カリキュラムローダー・進捗移行の実装）は本マップの`ready`講だけでも着手可能。
- Phase C（Task 5〜7: データ再配置・不足補完）は、上記6件のblocked講について教材本文の提示を待つ必要がある。
- `--release`検査は46講すべてがreadyになるまでPASSしない設計（計画書通り）。現時点のPASS率は21/46。
