# 古文演習（単語 4択 ＋ 活用ドリル）

古文単語の4択演習と、古典文法を学習順に進める1つの静的アプリです。段階1のコア300語を終えるまで文法をロックし、段階2は「用言 → 助動詞 → 助動詞識別 → 敬語基礎 → 文法混合確認」の順で進みます。

- **古文単語**モード：古語（かな＋漢字＋品詞）→ 意味の4択。章別演習、苦手復習、進捗保存、生徒別クラウド同期（共有URL）に対応。
- **古典文法**モード：文法ロードマップから必修タスクを順に進める。用言・助動詞は活用表と章別4択、助動詞識別・敬語は**STEP1 内容理解 → STEP2 4択問題 → STEP3 実践問題**の順で学習する。各通常問題は累計2回正解、識別フローは4択・実践の全問1回正解、最後の文法混合確認は30問中24問以上を終了条件とする。

`static/app.js` が段階1／段階2の切り替えと段階ゲートを管理し、`static/mode-katsuyo.js` が文法ロードマップを管理します。進捗の保存キー（localStorage）は従来どおり別々（`kobun_vocab_progress_v1` / `kobun-katsuyo-progress-v1`。文法ロードマップの混合確認のみ `kobun-katsuyo-path-v1` に保存）のため、統合前の進捗もそのまま引き継がれます。クラウド同期は単語モードのみ（appId `kobun-vocab`）。

## 起動

ポータルから開きます。

```powershell
py C:\Users\shtom\dev\portal\launcher.py
```

静的ファイルとして直接確認する場合は、ローカルサーバー経由で開きます（`fetch` で JSON を読むため、`file://` 直開きは不可）。

```powershell
py -3 -m http.server 8062 --directory C:\Users\shtom\dev\kobun-practice
# → http://127.0.0.1:8062
```

## データ

- `data/vocab.json` … 古文単語帳（単語モード）。
- `data/katsuyo.json` … 助動詞・動詞・形容詞・形容動詞の活用表（活用モード）。
- `data/multiple_choice.json` … 活用モードの文法4択問題（Chapter 1〜3を補修し、Chapter 5・7を追加）。
- `data/shikibetsu.json` … 識別タブの識別手順本文と問題（助動詞・助詞・同形語・敬語）。
- `data/jodoshi.json` … 旧助動詞データ（互換用に残置）。
- 教材由来のデータを含みます。公開・配布する前に、素材の扱いを確認します。個人情報は含みません。

## 由来

このリポジトリは、もともと単語演習のみだった `kobun-vocab` に `kobun-katsuyo`（活用ドリル）を統合したものです。公開URLとQRコード配布・Supabase生徒別クラウド同期を維持するため、器はこちら（kobun-vocab）側を採用しています。
