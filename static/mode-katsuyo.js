"use strict";

const KatsuyoApp = (function () {
  const FORM_NAMES = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
  const STORE_KEY = "kobun-katsuyo-progress-v1";
  const APP_ID = "kobun-katsuyo";
  const MASTERY_THRESHOLD = 2; // 単語モードと同じ「累計2回正解」で習得扱いに揃える

  const homePanel = document.getElementById("homePanel");
  const sessionPanel = document.getElementById("sessionPanel");

  let DATA = null;
  let currentSet = null;
  let byId = {};
  let cloud = null;

  /* ---------- progress (localStorage) ---------- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) {}
    if (cloud) cloud.queueSave();
  }
  function itemKey(id) {
    return currentSet.id + ":" + id;
  }
  function progressRecord(p, id) {
    return p[itemKey(id)] || (currentSet.id === "jodoshi" ? p[id] : null);
  }
  function getItems() {
    return DATA[currentSet.collection] || [];
  }
  function getGroups() {
    return DATA[currentSet.groups] || [];
  }
  function itemId(item) {
    return item.id || item.no;
  }
  function recordResult(id, ok) {
    const p = loadProgress();
    const key = itemKey(id);
    const rec = p[key] || (currentSet.id === "jodoshi" ? p[id] : null) || { c: 0, w: 0, weak: false };
    if (ok) { rec.c += 1; rec.weak = false; }
    else { rec.w += 1; rec.weak = true; }
    p[key] = rec;
    saveProgress(p);
  }
  function isMastered(rec) {
    return !!rec && rec.c >= MASTERY_THRESHOLD && !rec.weak;
  }
  function weakIds() {
    const p = loadProgress();
    return getItems().filter(item => (progressRecord(p, itemId(item)) || {}).weak).map(itemId);
  }
  function masteredCount() {
    const p = loadProgress();
    return getItems().filter(item => isMastered(progressRecord(p, itemId(item)))).length;
  }
  function groupDoneCount(g, p) {
    return g.ids.filter(id => isMastered(progressRecord(p, id))).length;
  }
  function sessionIdsForGroup(g) {
    return g.shuffle ? shuffle(g.ids) : g.ids.slice();
  }

  /* ---------- 知識項目カバレッジ ---------- */
  // 手順型の知識は「手順確認・条件確認・対比・統合」に分けて出題する。
  // coverageId ごとに、紐づく問題がすべて習得済みかどうかで手順の抜けを判定する。
  function coverageTopics() {
    return (DATA.coverageTopics || []).filter(t => getItems().some(item => item.topic === t.topic));
  }
  function idsForCoverage(coverageId) {
    return getItems().filter(item => item.coverageId === coverageId).map(itemId);
  }
  function isCoverageDone(coverageId, p) {
    const ids = idsForCoverage(coverageId);
    return ids.length > 0 && ids.every(id => isMastered(progressRecord(p, id)));
  }
  function openCoverageIds(p) {
    return coverageTopics().flatMap(t => t.items.map(i => i.id)).filter(id => !isCoverageDone(id, p));
  }
  // groups配列は「重要度順、最後が総仕上げ（全件通し）」という並びを前提に、
  // 最初に手をつけるべき未習得グループを1つ選ぶ。
  function firstIncompleteGroup() {
    const groups = getGroups();
    if (!groups.length) return null;
    const p = loadProgress();
    const focused = groups.slice(0, -1);
    for (const g of focused) {
      const done = groupDoneCount(g, p);
      if (done < g.ids.length) return { group: g, done };
    }
    const last = groups[groups.length - 1];
    const doneLast = groupDoneCount(last, p);
    if (doneLast < last.ids.length) return { group: last, done: doneLast };
    return null;
  }
  function setMode(set) {
    return set.mode || "table";
  }

  /* ---------- cloud sync（生徒別・共有URL ?s=&t= — harness/cloud.js を利用） ---------- */
  function setShareStatus(message, tone = "") {
    const slot = document.getElementById("shareStatus");
    if (!slot) return;
    slot.textContent = message || "";
    slot.className = "shareStatus" + (tone ? " " + tone : "");
  }
  function applyCloudProgress(p) {
    if (!p || typeof p !== "object") return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) {}
  }

  /* ---------- helpers ---------- */
  function normalizeKana(s) {
    return (s || "").replace(/\s+/g, "").replace(/[・･]/g, "").trim();
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const sb = new Set(b);
    return a.every(x => sb.has(x));
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- home ---------- */
  function renderHome() {
    sessionPanel.classList.add("hide");
    sessionPanel.innerHTML = "";
    homePanel.classList.remove("hide");
    homePanel.innerHTML = "";

    const total = getItems().length;
    const mastered = masteredCount();
    const weak = weakIds().length;
    const sharedMode = !!(cloud && cloud.isEnabled());

    const hero = el("section", "card hero");
    hero.appendChild(el("span", "label", currentSet.label + " CHECK"));
    const h2 = el("h2", null, currentSet.homeTitle || (currentSet.name + "の活用表を、行ごとに埋めてテスト"));
    h2.style.color = "var(--parchment)";
    hero.appendChild(h2);
    hero.appendChild(el("p", "hint", currentSet.description + "。間違えた行はセッション末尾で再出題されます。"));

    // ヒーローには「つづきから」の主導線を1本だけ置く（単語モードと同じ構成）
    let primary = null;
    if (weak > 0) {
      primary = {
        tag: "苦手復習・約" + Math.max(1, Math.round(weak * 0.3)) + "分",
        main: "間違えた" + weak + currentSet.unit + "を復習する",
        // 復習は順番を覚えてしまわないようランダム順にする
        action: () => startSession(shuffle(weakIds()), "苦手復習"),
      };
    } else {
      const inc = firstIncompleteGroup();
      if (inc) {
        primary = {
          tag: "つづきから",
          main: inc.group.name + "（" + inc.done + " / " + inc.group.ids.length + "）",
          action: () => startSession(sessionIdsForGroup(inc.group), inc.group.name),
        };
      } else if (total > 0) {
        primary = {
          tag: "総仕上げ",
          main: total + currentSet.unit + "をランダム出題",
          action: () => startSession(shuffle(getItems().map(itemId)), "総仕上げ"),
        };
      }
    }
    if (primary) {
      const btn = el("button", "cta primaryCta", "");
      btn.type = "button";
      const tag = el("span", "ctaTag", primary.tag);
      const main = el("span", "ctaMain", primary.main);
      btn.appendChild(tag);
      btn.appendChild(main);
      btn.addEventListener("click", primary.action);
      hero.appendChild(btn);
    }
    homePanel.appendChild(hero);

    // ---- 進捗カード（単語モードと同じ構成：label→statGrid→masteryBar→補足） ----
    const progressCard = el("section", "card");
    progressCard.appendChild(el("span", "label", "Progress"));
    const grid = el("div", "statGrid");
    const cells = [
      [String(mastered), "/ " + total, "MASTERED・習得"],
      [String(weak), "", "WEAK・苦手"],
      [String(total), "", currentSet.unit],
    ];
    cells.forEach(([num, small, cap]) => {
      const c = el("div", "statCell");
      const n = el("div", "statNum");
      n.appendChild(document.createTextNode(num));
      if (small) { const s = el("small", null, small); n.appendChild(s); }
      c.appendChild(n);
      c.appendChild(el("div", "statCaption", cap));
      grid.appendChild(c);
    });
    progressCard.appendChild(grid);

    const bar = el("div", "masteryBar");
    bar.setAttribute("aria-label", "習得率 " + mastered + "/" + total);
    const fill = el("div", "masteryFill");
    fill.style.width = (total ? Math.round(mastered / total * 100) : 0) + "%";
    bar.appendChild(fill);
    progressCard.appendChild(bar);
    progressCard.appendChild(el("p", "hint", "残り" + Math.max(0, total - mastered) + currentSet.unit + "。"));
    homePanel.appendChild(progressCard);

    if (currentSet.proceduresKey) renderProcedureStepsCard();
    renderCoverageCard();

    // ---- グループ一覧 ----
    const listCard = el("section", "card");
    listCard.appendChild(el("span", "label", "練習グループを選ぶ"));
    const list = el("div", "groupList");
    const p = loadProgress();
    getGroups().forEach(g => {
      const btn = el("button", "groupBtn");
      btn.type = "button";
      const done = groupDoneCount(g, p);
      btn.appendChild(el("span", "groupName", g.name));
      btn.appendChild(el("span", "groupSub", g.sub));
      btn.appendChild(el("span", "groupStat", "習得 " + done + " / " + g.ids.length));
      btn.addEventListener("click", () => startSession(sessionIdsForGroup(g), g.name));
      list.appendChild(btn);
    });
    listCard.appendChild(list);
    homePanel.appendChild(listCard);

    // ---- その他（リセット、単語モードと同じく折りたたみ＋共有モード時は非表示） ----
    if (!sharedMode) {
      const moreCard = el("section", "card");
      const details = document.createElement("details");
      details.className = "moreDetails";
      const summary = document.createElement("summary");
      summary.className = "label";
      summary.textContent = "その他";
      details.appendChild(summary);
      const actionsRow = el("div", "actions");
      const resetBtn = el("button", "ghost", "進捗をすべて削除");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => {
        if (confirm("進捗（習得・苦手）をすべて削除しますか？")) {
          localStorage.removeItem(STORE_KEY);
          renderHome();
        }
      });
      actionsRow.appendChild(resetBtn);
      details.appendChild(actionsRow);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
  }

  // 識別セクション専用：各手順の本文（手順I〜IV）を演習前に確認できるカード。
  function renderProcedureStepsCard() {
    const procedures = DATA[currentSet.proceduresKey] || [];
    if (!procedures.length) return;
    const card = el("section", "card");
    card.appendChild(el("span", "label", "識別手順を確認する"));
    procedures.forEach(proc => {
      const details = document.createElement("details");
      details.className = "procedureDetails";
      const summary = document.createElement("summary");
      summary.appendChild(el("span", "procedureName", proc.name));
      summary.appendChild(el("span", "procedureSub", proc.sub));
      details.appendChild(summary);
      const list = el("ol", "procedureStepList");
      proc.steps.forEach(step => {
        const li = el("li", "procedureStep");
        li.appendChild(el("span", "procedureStepNo", step.no));
        li.appendChild(document.createTextNode(step.text));
        list.appendChild(li);
      });
      details.appendChild(list);
      card.appendChild(details);
    });
    homePanel.appendChild(card);
  }

  // 「知識項目×問題形式」の対応表。どの手順が確認済みで、どこが抜けているかを一覧する。
  // 項目をクリックすると、その手順に対応する問題だけをランダム順で再出題する。
  function renderCoverageCard() {
    const topics = coverageTopics();
    if (!topics.length) return;
    const p = loadProgress();

    const card = el("section", "card");
    card.appendChild(el("span", "label", "知識項目チェック"));
    card.appendChild(el("p", "hint", "手順ごとに確認済みかどうかを表示します。項目を選ぶと、その手順の問題だけを出題します。"));

    topics.forEach(t => {
      const block = el("div", "coverageTopic");
      block.appendChild(el("p", "coverageTopicName", t.topic));
      const row = el("div", "coverageItems");
      t.items.forEach(item => {
        const done = isCoverageDone(item.id, p);
        const btn = el("button", "coverageItem" + (done ? " done" : ""));
        btn.type = "button";
        btn.setAttribute("aria-label", t.topic + "・" + item.label + "（" + (done ? "習得済み" : "未習得") + "）");
        btn.appendChild(el("span", "coverageMark", done ? "✓" : "□"));
        btn.appendChild(el("span", "coverageLabel", item.label));
        btn.addEventListener("click", () => {
          startSession(shuffle(idsForCoverage(item.id)), t.topic + "・" + item.label);
        });
        row.appendChild(btn);
      });
      block.appendChild(row);
      card.appendChild(block);
    });

    const open = openCoverageIds(p);
    const actions = el("div", "actions");
    if (open.length) {
      const btn = el("button", "cta reviewCta", "未習得の" + open.length + "項目だけ復習する");
      btn.type = "button";
      btn.addEventListener("click", () => {
        const ids = shuffle(open.flatMap(idsForCoverage));
        startSession(ids, "未習得の知識項目");
      });
      actions.appendChild(btn);
      card.appendChild(actions);
    } else {
      card.appendChild(el("p", "hint", "すべての知識項目を確認済みです。"));
    }
    homePanel.appendChild(card);
  }

  /* ---------- session ---------- */
  let session = null;

  function startSession(ids, title) {
    if (!ids || ids.length === 0) { renderHome(); return; }
    session = {
      title,
      queue: ids.slice(),
      total: ids.length,
      solved: 0,      // rows cleared correctly
      firstTryOk: 0,  // correct on first attempt
      requeued: new Set(),
      wrongNos: new Set(),
      answered: false,
      choiceSelect: null,
    };
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    renderRow();
  }

  // 3つの出題UI（活用ドリル・4択・統合ステップ）で共通のヘッダー＋進捗バー。
  function renderSessionChrome() {
    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, session.title));
    info.appendChild(el("span", null, "残り " + session.queue.length));
    head.appendChild(info);
    const quit = el("button", "ghost smallGhost", "中断してホームへ（進捗は保存）");
    quit.addEventListener("click", renderHome);
    head.appendChild(quit);
    sessionPanel.appendChild(head);

    const track = el("div", "progressTrack");
    const pf = el("div", "progressFill");
    pf.style.width = Math.round(session.solved / session.total * 100) + "%";
    track.appendChild(pf);
    sessionPanel.appendChild(track);
  }

  // 章番号を持つ文法4択（q.chapter/q.no）と、手順名で分類する識別問題（q.topic/q.step）の両方に対応。
  function choiceQuestionLabel(q) {
    if (q.chapter != null) return "CHAPTER " + q.chapter + " / QUESTION " + q.no;
    return (q.topic || "") + (q.step ? "・" + q.step : "");
  }

  function renderRow() {
    sessionPanel.innerHTML = "";
    if (session.queue.length === 0) { renderDone(); return; }
    session.answered = false;
    session.choiceSelect = null;
    if (setMode(currentSet) === "choice") { renderChoiceRow(); return; }
    const id = session.queue[0];
    const j = byId[itemKey(id)];

    renderSessionChrome();

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", currentSet.askLabel));
    wc.appendChild(el("p", "askWord", j.kihon));
    top.appendChild(wc);
    box.appendChild(top);

    const state = { setsuzoku: null, type: null, meanings: new Set(), inputs: [] };

    // 接続
    if (currentSet.showSetsuzoku) {
      box.appendChild(buildSingleField("接続", DATA.setsuzokuOptions, v => state.setsuzoku = v, state, "setsuzoku"));
    }

    // 活用形
    j.forms.forEach((forms, i) => {
      const row = el("div", "fieldRow");
      row.appendChild(el("p", "fieldName", FORM_NAMES[i]));
      const wrap = el("div", "kanaInputs");
      const slot = { formsIdx: i, expected: forms, boxes: [] };
      if (forms.length === 0) {
        const none = el("span", "markNone", "○");
        wrap.appendChild(none);
      } else {
        forms.forEach(() => {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "kanaInput";
          inp.setAttribute("aria-label", j.kihon + " の" + FORM_NAMES[i]);
          inp.autocomplete = "off";
          inp.autocapitalize = "off";
          inp.spellcheck = false;
          wrap.appendChild(inp);
          slot.boxes.push(inp);
        });
      }
      state.inputs.push(slot);
      row.appendChild(wrap);
      box.appendChild(row);
    });

    // 活用の型
    const typeOptions = Array.from(new Set(getItems().map(item => item.type))).filter(Boolean);
    box.appendChild(buildTypeField("活用の型", typeOptions.length ? typeOptions : DATA.typeOptions, v => state.type = v, state, "type"));

    // 意味
    const mChips = [];
    if (currentSet.showMeanings) {
      const meaningRow = el("div", "fieldRow");
      meaningRow.appendChild(el("p", "fieldName", "意味（" + j.meanings.length + "個すべて選べ）"));
      const mWrap = el("div", "optionWrap");
      const distractors = shuffle(DATA.meaningPool.filter(m => !j.meanings.includes(m)))
        .slice(0, Math.min(4, DATA.meaningPool.length - j.meanings.length));
      const mOptions = shuffle(j.meanings.concat(distractors));
      mOptions.forEach(m => {
        const chip = el("button", "optionChip", m);
        chip.type = "button";
        chip.setAttribute("aria-pressed", "false");
        chip.addEventListener("click", () => {
          const on = chip.getAttribute("aria-pressed") === "true";
          chip.setAttribute("aria-pressed", on ? "false" : "true");
          if (on) state.meanings.delete(m); else state.meanings.add(m);
        });
        mChips.push(chip);
        mWrap.appendChild(chip);
      });
      meaningRow.appendChild(mWrap);
      box.appendChild(meaningRow);
    }

    const submitRow = el("div", "submitRow");
    const submit = el("button", "cta", "採点する");
    submit.addEventListener("click", () => gradeRow(j, state, mChips, box, submit, submitRow));
    submitRow.appendChild(submit);
    box.appendChild(submitRow);

    sessionPanel.appendChild(box);

    // focus first input
    const firstInput = box.querySelector(".kanaInput");
    if (firstInput) firstInput.focus();
  }

  function renderChoiceRow() {
    const id = session.queue[0];
    const q = byId[itemKey(id)];

    // 統合問題（q.steps あり）は手順を1つずつ適用させるステップ実行UIに切り替える。
    if (q.steps && q.steps.length) {
      if (session.stepQid !== id) {
        session.stepQid = id;
        session.stepIdx = 0;
        session.stepFailed = false;
        session.stepHistory = [];
      }
      renderStepRow(q);
      return;
    }

    renderSessionChrome();

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", choiceQuestionLabel(q)));
    wc.appendChild(el("p", "gradeChoiceQuestion", q.question));
    top.appendChild(wc);
    box.appendChild(top);

    const choices = el("div", "gradeChoiceList");
    const buttons = [];
    const choiceOptions = shuffle(q.choices.map((text, originalIndex) => ({ text, originalIndex })));

    // 単語モードの4択と同じく、選んだ瞬間に即採点する（1〜4キーにも対応）
    function selectAndGrade(idx) {
      if (session.answered) return;
      const chosen = choiceOptions[idx].originalIndex;
      gradeChoiceRow(q, chosen, buttons, choiceOptions, box);
    }
    session.choiceSelect = selectAndGrade;

    choiceOptions.forEach((choice, idx) => {
      const btn = el("button", "gradeChoiceBtn");
      btn.type = "button";
      btn.appendChild(el("span", "gradeChoiceMark", String.fromCharCode(65 + idx)));
      btn.appendChild(el("span", "gradeChoiceText", choice.text));
      btn.addEventListener("click", () => selectAndGrade(idx));
      buttons.push(btn);
      choices.appendChild(btn);
    });
    box.appendChild(choices);

    sessionPanel.appendChild(box);
  }

  // 統合問題：古文＋対象の語を示し、識別手順を1ステップずつ適用させる。
  // 途中のステップを1つでも間違えると、問題全体を不正解として扱う（requeueされる）。
  function renderStepRow(q) {
    sessionPanel.innerHTML = "";
    renderSessionChrome();

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", choiceQuestionLabel(q)));
    const passageP = el("p", "gradeChoiceQuestion stepPassage");
    const targetIdx = q.passage.indexOf(q.target);
    if (targetIdx === -1) {
      passageP.appendChild(document.createTextNode(q.passage));
    } else {
      passageP.appendChild(document.createTextNode(q.passage.slice(0, targetIdx)));
      passageP.appendChild(el("span", "targetWord", q.target));
      passageP.appendChild(document.createTextNode(q.passage.slice(targetIdx + q.target.length)));
    }
    wc.appendChild(passageP);
    top.appendChild(wc);
    box.appendChild(top);

    // これまでに答えたステップの履歴（正誤と解説）を積み上げて表示する。
    session.stepHistory.forEach(h => {
      const hist = el("div", "feedback stepHistoryItem " + (h.ok ? "ok" : "ng"));
      hist.appendChild(el("p", "stepPrompt", h.prompt));
      addAnswer(hist, h.ok ? "選んだ答え" : "正解", h.ok ? h.chosenText : h.correctText);
      addAnswer(hist, "解説", h.explanation);
      box.appendChild(hist);
    });

    const stepIdx = session.stepIdx;
    const step = q.steps[stepIdx];
    const stepBox = el("div", "stepCurrent");
    stepBox.appendChild(el("p", "stepPrompt", step.prompt));

    const choices = el("div", "gradeChoiceList");
    const buttons = [];

    function selectStep(idx) {
      if (session.answered) return;
      session.answered = true;
      const ok = idx === step.answerIndex;
      if (!ok) session.stepFailed = true;
      session.stepHistory.push({
        prompt: step.prompt,
        ok,
        chosenText: step.choices[idx],
        correctText: step.choices[step.answerIndex],
        explanation: step.explanation
      });

      buttons.forEach((btn, i) => {
        btn.disabled = true;
        if (i === step.answerIndex) btn.classList.add("correct");
        else if (i === idx) btn.classList.add("wrong");
      });

      const isLastStep = stepIdx >= q.steps.length - 1;
      const nextRow = el("div", "nextRow");
      const next = el("button", "cta", isLastStep ? (session.queue.length > 1 ? "次の問題へ" : "結果を見る") : "次の手順へ");
      next.id = "katsuyoNextBtn";
      if (isLastStep) {
        next.addEventListener("click", () => finalizeStepQuestion(q));
      } else {
        next.addEventListener("click", () => {
          session.stepIdx += 1;
          session.answered = false;
          renderStepRow(q);
        });
      }
      nextRow.appendChild(next);
      stepBox.appendChild(nextRow);
      next.focus();
    }
    session.choiceSelect = selectStep;

    step.choices.forEach((text, idx) => {
      const btn = el("button", "gradeChoiceBtn");
      btn.type = "button";
      btn.appendChild(el("span", "gradeChoiceMark", String.fromCharCode(65 + idx)));
      btn.appendChild(el("span", "gradeChoiceText", text));
      btn.addEventListener("click", () => selectStep(idx));
      buttons.push(btn);
      choices.appendChild(btn);
    });
    stepBox.appendChild(choices);
    box.appendChild(stepBox);

    sessionPanel.appendChild(box);
  }

  // 統合問題の最終ステップまで終えたら、全ステップ正解のときだけ「正解」として記録する。
  function finalizeStepQuestion(q) {
    const id = itemId(q);
    const allOk = !session.stepFailed;
    recordResult(id, allOk);
    const wasRequeued = session.requeued.has(id);
    session.queue.shift();
    if (allOk) {
      session.solved += 1;
      if (!wasRequeued) session.firstTryOk += 1;
    } else {
      session.wrongNos.add(id);
      if (!wasRequeued) session.requeued.add(id);
      session.queue.push(id);
    }
    session.stepQid = null;
    session.stepIdx = 0;
    session.stepFailed = false;
    session.stepHistory = [];
    renderRow();
  }

  function buildSingleField(name, options, onPick, state, key) {
    const row = el("div", "fieldRow");
    row.appendChild(el("p", "fieldName", name));
    const wrap = el("div", "optionWrap");
    const chips = [];
    options.forEach(opt => {
      const chip = el("button", "optionChip", opt);
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        chips.forEach(c => c.setAttribute("aria-pressed", "false"));
        chip.setAttribute("aria-pressed", "true");
        onPick(opt);
      });
      chips.push(chip);
      wrap.appendChild(chip);
    });
    row.appendChild(wrap);
    state[key + "Chips"] = chips;
    return row;
  }

  // 「活用の型」は選択肢が多くなりがちなので、7択を超える場合は
  // 動詞型／形容詞・形容動詞型／特殊 の3ブロックに分けて表示する。
  function typeCategory(t) {
    if (t === "無変化型" || t === "特殊型") return "特殊";
    if (t.includes("活用") || t.includes("形容")) return "形容詞・形容動詞型";
    return "動詞型";
  }
  function buildTypeField(name, options, onPick, state, key) {
    const row = el("div", "fieldRow");
    row.appendChild(el("p", "fieldName", name));
    const chips = [];
    function makeChip(opt) {
      const chip = el("button", "optionChip", opt);
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        chips.forEach(c => c.setAttribute("aria-pressed", "false"));
        chip.setAttribute("aria-pressed", "true");
        onPick(opt);
      });
      chips.push(chip);
      return chip;
    }
    if (options.length > 7) {
      const categories = ["動詞型", "形容詞・形容動詞型", "特殊"];
      categories.forEach(cat => {
        const opts = options.filter(opt => typeCategory(opt) === cat);
        if (!opts.length) return;
        const group = el("div", "optionGroup");
        group.appendChild(el("span", "optionGroupLabel", cat));
        const wrap = el("div", "optionWrap");
        opts.forEach(opt => wrap.appendChild(makeChip(opt)));
        group.appendChild(wrap);
        row.appendChild(group);
      });
    } else {
      const wrap = el("div", "optionWrap");
      options.forEach(opt => wrap.appendChild(makeChip(opt)));
      row.appendChild(wrap);
    }
    state[key + "Chips"] = chips;
    return row;
  }

  function gradeRow(j, state, mChips, box, submit, submitRow) {
    let allOk = true;

    // 接続
    if (currentSet.showSetsuzoku) {
      const setsuzokuOk = state.setsuzoku === j.setsuzoku;
      markChips(state.setsuzokuChips, [j.setsuzoku], state.setsuzoku ? [state.setsuzoku] : []);
      if (!setsuzokuOk) allOk = false;
    }

    // 活用形
    state.inputs.forEach(slot => {
      if (slot.expected.length === 0) return; // ○ auto-correct
      const answers = slot.boxes.map(b => normalizeKana(b.value));
      const expected = slot.expected.map(normalizeKana);
      const ok = sameSet(answers, expected) && answers.every(a => a !== "");
      slot.boxes.forEach(b => { b.classList.add(ok ? "correct" : "wrong"); b.disabled = true; });
      if (!ok) allOk = false;
    });

    // 活用の型
    const typeOk = state.type === j.type;
    markChips(state.typeChips, [j.type], state.type ? [state.type] : []);
    if (!typeOk) allOk = false;

    // 意味
    if (currentSet.showMeanings) {
      const chosen = Array.from(state.meanings);
      const meaningOk = sameSet(chosen, j.meanings);
      mChips.forEach(chip => {
        const label = chip.textContent;
        const isCorrect = j.meanings.includes(label);
        const isChosen = state.meanings.has(label);
        chip.disabled = true;
        if (isCorrect && isChosen) chip.classList.add("correct");
        else if (!isCorrect && isChosen) chip.classList.add("wrong");
        else if (isCorrect && !isChosen) chip.classList.add("missed");
      });
      if (!meaningOk) allOk = false;
    }

    // disable inputs/submit
    submit.disabled = true;
    session.answered = true;
    if (state.setsuzokuChips) state.setsuzokuChips.forEach(c => c.disabled = true);
    state.typeChips.forEach(c => c.disabled = true);

    // record + queue
    const id = itemId(j);
    recordResult(id, allOk);
    const wasRequeued = session.requeued.has(id);
    session.queue.shift();
    if (allOk) {
      session.solved += 1;
      if (!wasRequeued) session.firstTryOk += 1;
    } else {
      session.wrongNos.add(id);
      if (!wasRequeued) {
        session.requeued.add(id);
        session.queue.push(id); // retry at end (once)
      } else {
        session.queue.push(id); // keep retrying until correct
      }
    }

    // feedback
    const fb = el("div", "feedback " + (allOk ? "ok" : "ng"));
    fb.appendChild(el("h3", null, allOk ? "正解" : "不正解"));
    const ansForms = j.forms.map((f, i) => FORM_NAMES[i] + "：" + (f.length ? f.join("・") : "○")).join("　");
    if (currentSet.showSetsuzoku) addAnswer(fb, "接続", j.setsuzoku);
    addAnswer(fb, "活用形", ansForms);
    addAnswer(fb, "活用の型", j.type);
    if (currentSet.showMeanings) addAnswer(fb, "意味", j.meanings.join("・"));
    box.appendChild(fb);

    const nextRow = el("div", "nextRow");
    const next = el("button", "cta", session.queue.length ? "次の問題へ" : "結果を見る");
    next.id = "katsuyoNextBtn";
    next.addEventListener("click", renderRow);
    nextRow.appendChild(next);
    box.appendChild(nextRow);
    next.focus();
  }

  function gradeChoiceRow(q, chosen, buttons, choiceOptions, box) {
    const allOk = chosen === q.answerIndex;
    session.answered = true;

    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      const originalIndex = choiceOptions[idx].originalIndex;
      if (originalIndex === q.answerIndex) btn.classList.add("correct");
      else if (originalIndex === chosen) btn.classList.add("wrong");
    });

    const id = itemId(q);
    recordResult(id, allOk);
    const wasRequeued = session.requeued.has(id);
    session.queue.shift();
    if (allOk) {
      session.solved += 1;
      if (!wasRequeued) session.firstTryOk += 1;
    } else {
      session.wrongNos.add(id);
      if (!wasRequeued) session.requeued.add(id);
      session.queue.push(id);
    }

    const fb = el("div", "feedback " + (allOk ? "ok" : "ng"));
    fb.appendChild(el("h3", null, allOk ? "正解" : "不正解"));
    addAnswer(fb, "正解", q.choices[q.answerIndex]);
    addAnswer(fb, "解説", q.explanation);
    box.appendChild(fb);

    const nextRow = el("div", "nextRow");
    const next = el("button", "cta", session.queue.length ? "次の問題へ" : "結果を見る");
    next.id = "katsuyoNextBtn";
    next.addEventListener("click", renderRow);
    nextRow.appendChild(next);
    box.appendChild(nextRow);
    next.focus();
  }

  function addAnswer(fb, k, v) {
    const line = el("p", "answerLine");
    line.appendChild(el("span", "k", k));
    line.appendChild(document.createTextNode(v));
    fb.appendChild(line);
  }

  function markChips(chips, correctLabels, chosenLabels) {
    chips.forEach(chip => {
      const label = chip.textContent;
      const isCorrect = correctLabels.includes(label);
      const isChosen = chosenLabels.includes(label);
      if (isCorrect && isChosen) chip.classList.add("correct");
      else if (!isCorrect && isChosen) chip.classList.add("wrong");
      else if (isCorrect && !isChosen) chip.classList.add("missed");
    });
  }

  function renderDone() {
    sessionPanel.innerHTML = "";
    const total = session.total;
    const score = session.firstTryOk;
    const pct = total ? Math.round((score / total) * 100) : 0;

    const banner = el("div", "doneBanner");
    banner.appendChild(el("p", "label", "Session Complete"));
    banner.querySelector(".label").style.color = "rgba(250,249,246,.72)";
    banner.appendChild(el("div", "big", score + " / " + total));
    banner.appendChild(el("div", "sub", "正答率 " + pct + "%"));
    sessionPanel.appendChild(banner);

    const card = el("section", "card");
    card.appendChild(el("span", "label", "Next"));
    const wrongCount = session.wrongNos.size;
    card.appendChild(el("p", "resultText", "一発正解は" + score + currentSet.unit + "。" + (wrongCount ? "間違えた" + currentSet.unit + "はホームの「間違えた" + currentSet.unit + "を復習する」に残ります。" : "")));

    const actions = el("div", "actions");
    if (wrongCount > 0) {
      const nos = Array.from(session.wrongNos);
      const retry = el("button", "cta reviewCta", "間違えた" + nos.length + currentSet.unit + "をもう一度");
      retry.addEventListener("click", () => startSession(shuffle(nos), "苦手復習"));
      actions.appendChild(retry);
    }
    const backHome = el("button", "ghost smallGhost", "ホームに戻る");
    backHome.addEventListener("click", renderHome);
    actions.appendChild(backHome);
    card.appendChild(actions);

    if (wrongCount > 0) {
      const list = el("div", "wrongList");
      Array.from(session.wrongNos).forEach(id => {
        const item = byId[itemKey(id)];
        list.appendChild(el("span", null, item.kihon || (item.no != null ? "Q" + item.no : item.topic + "・" + item.step)));
      });
      card.appendChild(list);
    }
    sessionPanel.appendChild(card);
  }

  /* ---------- キーボード（文法4択のみ：1〜4で選択即採点、Enterで次へ） ---------- */
  function handleKey(e) {
    if (!session) return;
    if (setMode(currentSet) !== "choice") return;
    if (["1", "2", "3", "4"].includes(e.key)) {
      if (!session.answered && session.choiceSelect) {
        const i = parseInt(e.key, 10) - 1;
        session.choiceSelect(i);
      }
    } else if (e.key === "Enter" && session.answered) {
      const btn = document.getElementById("katsuyoNextBtn");
      if (btn) btn.click();
    }
  }

  /* ---------- boot ---------- */
  let booted = false;
  let bootPromise = null;
  function boot() {
    bootPromise = Promise.all([
      fetch("data/katsuyo.json?v=20260709-5")
        .then(r => { if (!r.ok) throw new Error("katsuyo data load failed: " + r.status); return r.json(); }),
      fetch("data/multiple_choice.json?v=20260711-1")
        .then(r => { if (!r.ok) throw new Error("choice data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu.json?v=20260711-1")
        .then(r => { if (!r.ok) throw new Error("shikibetsu data load failed: " + r.status); return r.json(); })
    ])
      .then(async ([d, choiceData, shikibetsuData]) => {
        DATA = Object.assign({}, d, choiceData, shikibetsuData);

        const jodoshiSet = d.practiceSets.find(s => s.id === "jodoshi");

        // 動詞・形容詞・形容動詞は「用言の活用」という同じ目的なので1タブに統合する。
        DATA.yougoItems = [].concat(d.verbs, d.adjectives, d.adjectivalVerbs);
        DATA.yougoGroups = [
          Object.assign({}, d.verbGroups[0], { name: "動詞：正格活用" }),
          Object.assign({}, d.verbGroups[1], { name: "動詞：変格活用" }),
          Object.assign({}, d.adjectiveGroups[0], { name: "形容詞すべて" }),
          Object.assign({}, d.adjectivalVerbGroups[0], { name: "形容動詞すべて" }),
          {
            id: "yougo-all",
            name: "総仕上げ：13語ランダム",
            sub: "動詞・形容詞・形容動詞をすべてランダム出題",
            shuffle: true,
            ids: DATA.yougoItems.map(itemId)
          }
        ];
        const yougoSet = {
          id: "yougo",
          name: "用言",
          label: "YOUGO",
          description: "動詞・形容詞・形容動詞の活用形と活用の型を答える",
          collection: "yougoItems",
          groups: "yougoGroups",
          askLabel: "この語の活用表を埋めよ",
          unit: "語",
          showSetsuzoku: false,
          showMeanings: false,
          homeTitle: "動詞・形容詞・形容動詞の活用表を、行ごとに埋めてテスト"
        };
        const choiceSet = {
          id: "choice",
          name: "文法4択",
          label: "MULTIPLE CHOICE",
          description: "章ごとの文法知識を4択で確認する",
          collection: "choiceQuestions",
          groups: "choiceGroups",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "文法知識を、4択でテンポよく確認"
        };
        const shikibetsuSet = {
          id: "shikibetsu",
          name: "識別",
          label: "IDENTIFY",
          description: "助動詞の意味の識別手順を、手順確認→条件確認→対比→統合の順で身につける",
          collection: "shikibetsuQuestions",
          groups: "shikibetsuGroups",
          proceduresKey: "procedures",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "識別手順を、手順→条件→対比→統合の順で確認"
        };

        DATA.practiceSets = [jodoshiSet, yougoSet, choiceSet, shikibetsuSet];
        DATA.practiceSets.forEach(set => {
          (DATA[set.collection] || []).forEach(item => { byId[set.id + ":" + itemId(item)] = item; });
        });

        // 生徒別クラウド同期（共有URL ?s=&t= があり config.json が揃うときのみ有効）。
        // 4つの練習セット（jodoshi/yougo/choice/shikibetsu）の進捗を1つのprogressマップとしてまとめて同期する。
        cloud = createCloud({
          appId: APP_ID,
          getPayload: loadProgress,
          applyLoaded: applyCloudProgress,
          onStatus: setShareStatus,
        });
        await cloud.init();
      })
      .catch(err => {
        homePanel.innerHTML = "";
        const c = el("div", "card");
        c.appendChild(el("h2", null, "データを読み込めませんでした"));
        c.appendChild(el("p", "hint", String(err) + "（ローカルサーバー経由で開いてください）"));
        homePanel.appendChild(c);
      });
    return bootPromise;
  }

  async function mount(setId) {
    if (!booted) {
      booted = true;
      await boot();
    } else {
      await bootPromise;
    }
    if (!DATA) return; // データ読み込み失敗
    currentSet = DATA.practiceSets.find(s => s.id === setId) || DATA.practiceSets[0];
    renderHome();
  }

  return { mount, handleKey };
})();
