"use strict";

/* ============================================================
   学習マップ — 文法6章46講・敬語読解・古文常識の全体フローと
   現在地を、ホーム上部に表示する共有コンポーネント。
   段階1（古典文法）が唯一の入口で、完了後に段階2（敬語読解）、
   その後に段階3（古文常識）へ進む。問題は全段階で先に選択できるが、
   「現在地」は段階を順に一つずつ指す。
   状態は KatsuyoApp.pathOverview() から取得する。
   ============================================================ */

const LearningMap = (function () {
  const NAMES = ["古典文法", "敬語読解", "古文常識"];
  const STAGE_ANCHORS = ["grammarStage", "readingStage", "cultureStage"];
  const FLOW = [
    {
      n: 1, name: "古典文法",
      steps: [
        "第1章 基本知識（01〜05講）",
        "第2章 用言（06〜12講）",
        "第3章 助動詞（13〜26講）",
        "第4章 助動詞が絡む識別（27〜29講）",
        "第5章 助詞（30〜42講）",
        "第6章 助詞が絡む識別（43〜46講）",
        "仕上げ：文法混合確認30問（24問以上）",
      ],
      goal: null,
      gate: "関所①　6章46講と文法混合確認を完了",
    },
    {
      n: 2, name: "敬語読解",
      steps: [
        "敬意の方向を読む 4問",
        "省略主語を補う 4問",
        "短文読解で統合 4問",
      ],
      goal: null,
      gate: "関所②　敬語読解チェック：12問中10問以上で合格",
    },
    {
      n: 3, name: "古文常識",
      steps: [
        "宮廷生活を読む 4問",
        "恋愛・婚姻を読む 4問",
        "年中行事を読む 4問",
        "古文常識チェック：12問中10問以上 → 全課程修了",
      ],
      goal: null,
      gate: null,
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 段階ごとの状態を判定する。問題は全段階で選択できるが、「現在地」は
  // 前段階の完了を条件に段階1→2→3の順で一つだけ進む。
  function computeState() {
    const ov = (typeof KatsuyoApp !== "undefined" && KatsuyoApp.pathOverview) ? KatsuyoApp.pathOverview() : { ready: false };
    const grammarComplete = !!(ov.ready && ov.grammarComplete);
    const readingComplete = !!(ov.ready && ov.readingComplete);
    const cultureComplete = !!(ov.ready && ov.cultureComplete);

    const stageStatus = [
      grammarComplete ? "done" : "current",
      !grammarComplete ? "open" : (readingComplete ? "done" : "current"),
      !(grammarComplete && readingComplete) ? "open" : (cultureComplete ? "done" : "current"),
    ];
    const allDone = stageStatus.every(s => s === "done");
    const currentStages = [];
    stageStatus.forEach((s, i) => { if (s === "current") currentStages.push(i + 1); });
    const primaryCurrent = currentStages.length ? Math.min.apply(null, currentStages) : null;

    return { ov, grammarComplete, readingComplete, cultureComplete, stageStatus, allDone, currentStages, primaryCurrent };
  }

  function stageClass(n, state) {
    return "is-" + state.stageStatus[n - 1];
  }

  function nowLabelText(state) {
    if (state.allDone) return "現在地：全課程を修了";
    return "現在地：" + state.currentStages.map(n => "段階" + n + " " + NAMES[n - 1]).join("・");
  }

  function stepperItemHtml(n, state) {
    const cls = stageClass(n, state);
    const word = cls === "is-done" ? "完了" : cls === "is-current" ? "現在地" : "選択可";
    const dot = cls === "is-done" ? "✓" : String(n);
    const aria = "段階" + n + " " + NAMES[n - 1] + "（" + word + "）";
    const cur = (n === state.primaryCurrent) ? ' aria-current="step"' : "";
    const inner =
      '<span class="lmapDot" aria-hidden="true">' + dot + "</span>" +
      '<span class="lmapName">' + NAMES[n - 1] + "</span>" +
      '<span class="lmapState">' + word + "</span>";
    return (
      '<li class="lmapStep ' + cls + '"' + cur + ">" +
      '<button type="button" class="lmapStepBtn" data-anchor="' + STAGE_ANCHORS[n - 1] + '" aria-label="' + aria + '">' + inner + "</button>" +
      "</li>"
    );
  }

  function stepperHtml(state) {
    const items = [1, 2, 3].map(n => stepperItemHtml(n, state)).join("");
    return '<ol class="lmapStepper">' + items + "</ol>";
  }

  function flowStageCardHtml(f, state) {
    const cls = stageClass(f.n, state);
    const badge = cls === "is-done" ? "完了" : cls === "is-current" ? "現在地" : "選択可";
    let html =
      '<section class="lmapFlowStage ' + cls + '">' +
      '<div class="lmapFlowHead">' +
      '<span class="lmapFlowTag">Stage ' + f.n + "</span>" +
      '<span class="lmapFlowName">' + esc(f.name) + "</span>" +
      '<span class="lmapFlowBadge">' + badge + "</span>" +
      "</div>" +
      '<ul class="lmapFlowSteps">' + f.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>";
    if (f.goal) html += '<p class="lmapFlowGoal">' + esc(f.goal) + "</p>";
    html += "</section>";
    return html;
  }

  function gateHtml(text) {
    return (
      '<div class="lmapArrow" aria-hidden="true">↓</div>' +
      '<div class="lmapGate"><span>' + esc(text) + "</span></div>" +
      '<div class="lmapArrow" aria-hidden="true">↓</div>'
    );
  }

  function flowHtml(state) {
    const stage1 = FLOW[0], stage2 = FLOW[1], stage3 = FLOW[2];
    let html = '<div class="lmapFlow">';
    html += flowStageCardHtml(stage1, state);
    if (stage1.gate) html += gateHtml(stage1.gate);
    html += flowStageCardHtml(stage2, state);
    if (stage2.gate) html += gateHtml(stage2.gate);
    html += flowStageCardHtml(stage3, state);
    html += "</div>";
    html +=
      '<div class="lmapLegend">' +
      "<p><b>共通の進み方</b></p>" +
      "<p>通常問題：通し演習で各問題を1回以上正解 → 完了</p>" +
      "<p>識別問題：予習資料で手順を確認 → 実践（傍線部の意味4択）</p>" +
      "<p>習得＝累計2回正解／間違えた問題はセッション末尾で再出題</p>" +
      "</div>";
    return html;
  }

  // container（#learningMapSlot）を現在地マップで満たす。
  // 文法データが未読込のときは、読み込み後に同じ枠へ再描画する。
  function render(container, opts) {
    if (!container) return;
    opts = opts || {};
    const st = computeState();
    const wasOpen = !!container.querySelector(".lmapDetails[open]");
    container.className = "card lmap";
    container.innerHTML =
      '<div class="lmapTop"><span class="label">学習マップ</span>' +
      '<span class="lmapNow">' + esc(nowLabelText(st)) + "</span></div>" +
      stepperHtml(st) +
      '<details class="lmapDetails"' + (wasOpen ? " open" : "") + ">" +
      "<summary>学習フロー全体を見る</summary>" + flowHtml(st) + "</details>";

    container.querySelectorAll(".lmapStepBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.getAttribute("data-anchor"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    if (st.ov && st.ov.ready === false &&
        typeof KatsuyoApp !== "undefined" && KatsuyoApp.ensureData) {
      KatsuyoApp.ensureData().then(() => {
        if (container.isConnected) render(container, opts);
      }).catch(() => { /* データ読み込み失敗時は暫定表示のまま */ });
    }
  }

  return { render };
})();
