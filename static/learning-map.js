"use strict";

/* ============================================================
   学習マップ — 段階1（古文単語）〜段階4（古文常識）の全体フローと
   現在地を、各ホーム上部に表示する共有コンポーネント。
   状態は VocabApp.stage1Status() と KatsuyoApp.pathOverview() から取得する。
   ============================================================ */

const LearningMap = (function () {
  const NAMES = ["古文単語", "古典文法", "敬語読解", "古文常識"];
  const FLOW = [
    {
      n: 1, name: "古文単語",
      steps: [
        "コア200語（全408語から必須選定）",
        "10セット × 20問（1語1回正解で習得）",
        "既習範囲から累積練習で定着",
        "補助：章・単語番号で選ぶ／追加語",
      ],
      gate: "関所①　段階1確認テスト：30問中24問以上（80%）で古典文法が解放",
    },
    {
      n: 2, name: "古典文法",
      steps: [
        "必修1 用言の活用・基礎（活用表／品詞・係り結び／用言の攻略）",
        "必修2 助動詞の活用・接続（28語の活用表／攻略①③）",
        "必修3 助動詞の識別8種（各：内容理解→4択→実践）",
        "必修4 敬語の基礎（敬語の攻略／敬語の識別）",
        "仕上げ：文法混合確認30問",
      ],
      gate: "関所②　第2段階（文法混合確認まで）を完了",
    },
    {
      n: 3, name: "敬語読解",
      steps: [
        "敬意の方向を読む 4問",
        "省略主語を補う 4問",
        "短文読解で統合 4問",
      ],
      gate: "関所③　敬語読解チェック：12問中10問以上で合格",
    },
    {
      n: 4, name: "古文常識",
      steps: [
        "宮廷生活を読む 4問",
        "恋愛・婚姻を読む 4問",
        "年中行事を読む 4問",
        "古文常識チェック：12問中10問以上 → 全課程修了",
      ],
      gate: null,
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 現在地の判定：段階1未合格→1、以降は各段階の完了で 2→3→4、全完了で 5（修了）。
  function computeState() {
    const s1 = (typeof VocabApp !== "undefined" && VocabApp.stage1Status) ? VocabApp.stage1Status() : null;
    const stage1Done = !!(s1 && s1.complete);
    const ov = (typeof KatsuyoApp !== "undefined" && KatsuyoApp.pathOverview) ? KatsuyoApp.pathOverview() : { ready: false };
    let current;
    if (!stage1Done) current = 1;
    else if (!ov.ready) current = 2;              // 文法データ未読込。読み込み後に再描画する
    else if (!ov.grammarComplete) current = 2;
    else if (!ov.readingComplete) current = 3;
    else if (!ov.cultureComplete) current = 4;
    else current = 5;
    return { s1, stage1Done, ov, current };
  }

  function stageClass(n, current) {
    if (current === 5) return "is-done";
    if (n < current) return "is-done";
    if (n === current) return "is-current";
    return "is-locked";
  }

  function nextText(st) {
    if (st.current === 5) return "全課程を修了しました";
    if (st.current === 1) {
      const hint = (typeof VocabApp !== "undefined" && VocabApp.nextHint) ? VocabApp.nextHint() : null;
      return hint || "古文単語のセットを進める";
    }
    if (st.ov && st.ov.ready && st.ov.next) return st.ov.next.taskLabel;
    return "古典文法タブで続ける";
  }

  function stepperHtml(st) {
    let html = '<ol class="lmapStepper">';
    for (let i = 1; i <= 4; i++) {
      const cls = stageClass(i, st.current);
      const word = cls === "is-done" ? "完了" : cls === "is-current" ? "現在地" : "未解放";
      const dot = cls === "is-done" ? "✓" : String(i);
      const navigable = cls !== "is-locked";
      const aria = "段階" + i + " " + NAMES[i - 1] + "（" + word + "）";
      const cur = (i === st.current && st.current <= 4) ? ' aria-current="step"' : "";
      const inner =
        '<span class="lmapDot" aria-hidden="true">' + dot + "</span>" +
        '<span class="lmapName">' + NAMES[i - 1] + "</span>" +
        '<span class="lmapState">' + word + "</span>";
      html += '<li class="lmapStep ' + cls + '"' + cur + ">";
      if (navigable) {
        const app = i === 1 ? "vocab" : "grammar";
        html += '<button type="button" class="lmapStepBtn" data-app="' + app + '" aria-label="' + aria + '">' + inner + "</button>";
      } else {
        html += '<span class="lmapStepStatic" aria-label="' + aria + '">' + inner + "</span>";
      }
      html += "</li>";
    }
    html += "</ol>";
    return html;
  }

  function flowHtml(st) {
    let html = '<div class="lmapFlow">';
    FLOW.forEach(f => {
      const cls = stageClass(f.n, st.current);
      const badge = cls === "is-done" ? "完了" : cls === "is-current" ? "現在地" : "未解放";
      html +=
        '<section class="lmapFlowStage ' + cls + '">' +
        '<div class="lmapFlowHead">' +
        '<span class="lmapFlowTag">Stage ' + f.n + "</span>" +
        '<span class="lmapFlowName">' + esc(f.name) + "</span>" +
        '<span class="lmapFlowBadge">' + badge + "</span>" +
        "</div>" +
        '<ul class="lmapFlowSteps">' + f.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>" +
        "</section>";
      if (f.gate) {
        html +=
          '<div class="lmapArrow" aria-hidden="true">↓</div>' +
          '<div class="lmapGate"><span>' + esc(f.gate) + "</span></div>" +
          '<div class="lmapArrow" aria-hidden="true">↓</div>';
      }
    });
    html += "</div>";
    html +=
      '<div class="lmapLegend">' +
      "<p><b>共通の進み方</b></p>" +
      "<p>通常問題：通し演習（1周）→ 累積10問 → 完了</p>" +
      "<p>識別問題：内容理解 → 4択 → 実践（統合）</p>" +
      "<p>習得＝累計2回正解／間違えた問題はセッション末尾で再出題</p>" +
      "</div>";
    return html;
  }

  // container（#learningMapSlot）を現在地マップで満たす。
  // 段階1合格済みで文法データが未読込のときは、読み込み後に同じ枠へ再描画する。
  function render(container, opts) {
    if (!container) return;
    opts = opts || {};
    const st = computeState();
    const nowLabel = st.current === 5
      ? "現在地：全課程を修了"
      : "現在地：段階" + st.current + " " + NAMES[st.current - 1];
    const wasOpen = !!container.querySelector(".lmapDetails[open]");
    container.className = "card lmap";
    container.innerHTML =
      '<div class="lmapTop"><span class="label">学習マップ</span>' +
      '<span class="lmapNow">' + esc(nowLabel) + "</span></div>" +
      stepperHtml(st) +
      '<p class="lmapNext">次にやること：<b>' + esc(nextText(st)) + "</b></p>" +
      '<details class="lmapDetails"' + (wasOpen ? " open" : "") + ">" +
      "<summary>学習フロー全体を見る</summary>" + flowHtml(st) + "</details>";

    container.querySelectorAll(".lmapStepBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof switchApp === "function") switchApp(btn.getAttribute("data-app"));
      });
    });

    // 段階1合格済みだが文法データ未読込のとき：読み込んでから現在地を確定して再描画。
    if (st.stage1Done && st.ov && st.ov.ready === false &&
        typeof KatsuyoApp !== "undefined" && KatsuyoApp.ensureData) {
      KatsuyoApp.ensureData().then(() => {
        if (container.isConnected) render(container, opts);
      }).catch(() => { /* データ読み込み失敗時は暫定表示のまま */ });
    }
  }

  return { render };
})();
