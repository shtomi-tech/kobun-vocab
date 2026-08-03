"use strict";

/* ============================================================
   学習マップ — 段階1（古文単語）〜段階4（古文常識）の全体フローと
   現在地を、各ホーム上部に表示する共有コンポーネント。
   段階1（古文単語）と段階2（古典文法）は並行トラックで、どちらも
   最初から進められる。段階3（敬語読解）と段階4（古文常識）も問題は選択できる。
   段階間の完了条件と推奨順は、従来どおり表示する。
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
      goal: "段階1修了条件：確認テスト30問中24問以上（80%）",
      gate: null,
    },
    {
      n: 2, name: "古典文法",
      steps: [
        "必修1 文の骨組み（仮名遣い／文節・品詞／文の成分／活用形・接続）",
        "必修2 用言の活用（活用の種類／見分け方／活用表／語幹・音便／訳し分け）",
        "必修3 未然形接続の助動詞（活用表11語／基本意味／る・らる〜まし）",
        "必修4 連用形接続の助動詞（活用表7語＋り／き・けり・つ・ぬ・たり・けむ・たしの順）",
        "必修5 終止形接続の助動詞（活用表6語／基本意味／らむ・べし・まじ）",
        "必修6 体言・連体形接続の助動詞（活用表3語／なり・その他の識別）",
        "必修7 助詞・呼応・文末（助詞の地図／係り結び／禁止・願望）",
        "必修8 同形語の識別5種（ぬね／るれ／なり／なむ／に）",
        "必修9 敬語・補助動詞（敬語の攻略／補助動詞／敬意の方向）",
        "仕上げ：文法混合確認30問",
      ],
      goal: null,
      gate: "関所②　第2段階（文法混合確認まで）を完了",
    },
    {
      n: 3, name: "敬語読解",
      steps: [
        "敬意の方向を読む 4問",
        "省略主語を補う 4問",
        "短文読解で統合 4問",
      ],
      goal: null,
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
      goal: null,
      gate: null,
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 段階ごとの状態を判定する。問題は全段階で選択でき、完了条件だけを状態に反映する。
  function computeState() {
    const s1 = (typeof VocabApp !== "undefined" && VocabApp.stage1Status) ? VocabApp.stage1Status() : null;
    const stage1Done = !!(s1 && s1.complete);
    const ov = (typeof KatsuyoApp !== "undefined" && KatsuyoApp.pathOverview) ? KatsuyoApp.pathOverview() : { ready: false };
    const grammarComplete = !!(ov.ready && ov.grammarComplete);
    const readingComplete = !!(ov.ready && ov.readingComplete);
    const cultureComplete = !!(ov.ready && ov.cultureComplete);

    const stageStatus = [
      stage1Done ? "done" : "current",
      grammarComplete ? "done" : "current",
      readingComplete ? "done" : "open",
      cultureComplete ? "done" : "open",
    ];
    const allDone = stageStatus.every(s => s === "done");
    const currentStages = [];
    stageStatus.forEach((s, i) => { if (s === "current") currentStages.push(i + 1); });
    const primaryCurrent = currentStages.length ? Math.min.apply(null, currentStages) : null;

    return { s1, stage1Done, ov, grammarComplete, readingComplete, cultureComplete, stageStatus, allDone, currentStages, primaryCurrent };
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
    const navigable = cls !== "is-locked";
    const aria = "段階" + n + " " + NAMES[n - 1] + "（" + word + "）";
    const cur = (n === state.primaryCurrent) ? ' aria-current="step"' : "";
    const inner =
      '<span class="lmapDot" aria-hidden="true">' + dot + "</span>" +
      '<span class="lmapName">' + NAMES[n - 1] + "</span>" +
      '<span class="lmapState">' + word + "</span>";
    let html = '<li class="lmapStep ' + cls + '"' + cur + ">";
    if (navigable) {
      const app = n === 1 ? "vocab" : "grammar";
      html += '<button type="button" class="lmapStepBtn" data-app="' + app + '" aria-label="' + aria + '">' + inner + "</button>";
    } else {
      html += '<span class="lmapStepStatic" aria-label="' + aria + '">' + inner + "</span>";
    }
    html += "</li>";
    return html;
  }

  function stepperHtml(state) {
    const parallelItems = [1, 2].map(n => stepperItemHtml(n, state)).join("");
    const sequentialItems = [3, 4].map(n => stepperItemHtml(n, state)).join("");
    return (
      '<div class="lmapParallel" role="group" aria-label="並行して進められる段階1・段階2">' +
      '<p class="lmapParallelTag">並行して進められます</p>' +
      '<ol class="lmapStepper lmapStepperParallel">' + parallelItems + "</ol>" +
      "</div>" +
      '<div class="lmapArrow" aria-hidden="true">↓</div>' +
      '<ol class="lmapStepper">' + sequentialItems + "</ol>"
    );
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
    const stage1 = FLOW[0], stage2 = FLOW[1], stage3 = FLOW[2], stage4 = FLOW[3];
    let html = '<div class="lmapFlow">';
    html +=
      '<div class="lmapFlowParallel">' +
      '<p class="lmapFlowParallelTag">並行して進める（順不同）</p>' +
      flowStageCardHtml(stage1, state) +
      flowStageCardHtml(stage2, state) +
      "</div>";
    if (stage2.gate) html += gateHtml(stage2.gate);
    html += flowStageCardHtml(stage3, state);
    if (stage3.gate) html += gateHtml(stage3.gate);
    html += flowStageCardHtml(stage4, state);
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
  // 文法データが未読込のときは、読み込み後に同じ枠へ再描画する（段階1の完了状況によらず先読みする）。
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
        if (typeof switchApp === "function") switchApp(btn.getAttribute("data-app"));
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
