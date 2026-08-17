"use strict";

/* ============================================================
   古典文法演習 — 起動と共通キーボードイベントだけを担う薄いシェル。
   ロードマップと練習UIは mode-katsuyo.js 側で管理する。
   ============================================================ */

document.addEventListener("keydown", (e) => {
  KatsuyoApp.handleKey(e);
});

KatsuyoApp.mount("grammar");
