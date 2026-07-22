"use strict";

const KatsuyoApp = (function () {
  const FORM_NAMES = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
  const STORE_KEY = "kobun-katsuyo-progress-v1";
  const APP_ID = "kobun-katsuyo";
  const MASTERY_THRESHOLD = 2; // 単語モードと同じ「累計2回正解」で習得扱いに揃える
  const PATH_CUMULATIVE_SIZE = 10;

  const homePanel = document.getElementById("homePanel");
  const sessionPanel = document.getElementById("sessionPanel");

  let DATA = null;
  let currentSet = null;
  let byId = {};
  let cloud = null;
  let flow = null; // 識別セクションの学習フロー文脈（理解→4択→実践）
  let grammarMode = false; // 上段の「古典文法」モードかどうか
  let activeGrammarMode = "roadmap"; // 古典文法内の現在の練習モード
  let activeGrammarPathTask = null; // 文法ロードマップから開始した必修タスク
  const PATH_STORE_KEY = "kobun-katsuyo-path-v1";
  const GRAMMAR_PATH = [
    {
      id: "yougo",
      label: "1. 用言の活用・基礎",
      description: "用言の活用表と、品詞・活用形の基礎を固める",
      tasks: [
        { id: "yougo-table", kind: "group", setId: "yougo", groupId: "yougo-all", label: "用言13語の活用表" },
        { id: "choice-ch1", kind: "group", setId: "choice", groupId: "qa-chapter-1", label: "品詞・活用・係り結び 11問" },
        { id: "choice-ch2", kind: "group", setId: "choice", groupId: "qa-chapter-2", label: "用言の攻略 26問" },
      ],
    },
    {
      id: "jodoshi",
      label: "2. 助動詞の活用・接続",
      description: "助動詞の活用表を埋め、接続と活用を4択で確認する",
      tasks: [
        { id: "jodoshi-table", kind: "group", setId: "jodoshi", groupId: "all", label: "助動詞28語の活用表" },
        { id: "choice-ch3", kind: "group", setId: "choice", groupId: "qa-chapter-3", label: "助動詞の攻略① 15問" },
        { id: "choice-ch5", kind: "group", setId: "choice", groupId: "qa-chapter-5", label: "助動詞の攻略③ 9問" },
      ],
    },
    {
      id: "shikibetsu",
      label: "3. 助動詞の識別",
      description: "内容理解→4択→実践の順で、8種類の助動詞を識別する",
      tasks: [
        { id: "proc-rareru", kind: "procedure", procId: "rareru", label: "る・らるの識別" },
        { id: "proc-sasu", kind: "procedure", procId: "sasu", label: "す・さす・しむの識別" },
        { id: "proc-mu", kind: "procedure", procId: "mu", label: "む・むずの識別" },
        { id: "proc-mashi", kind: "procedure", procId: "mashi", label: "ましの識別" },
        { id: "proc-keri", kind: "procedure", procId: "keri", label: "けりの識別" },
        { id: "proc-ramu", kind: "procedure", procId: "ramu", label: "らむの識別" },
        { id: "proc-beshi", kind: "procedure", procId: "beshi", label: "べしの識別" },
        { id: "proc-nari", kind: "procedure", procId: "nari", label: "なりの識別" },
      ],
    },
    {
      id: "keigo",
      label: "4. 敬語の基礎",
      description: "敬語の種類・敬意の方向・本動詞と補助動詞を確認する",
      tasks: [
        { id: "choice-ch9", kind: "group", setId: "choice", groupId: "qa-chapter-9", label: "敬語の攻略 12問" },
        { id: "proc-keigo", kind: "procedure", procId: "keigo", label: "敬語の識別" },
      ],
    },
    {
      id: "grammar-checkpoint",
      label: "文法混合確認",
      description: "必修範囲からランダムに出題し、文法全体を確認する",
      tasks: [
        { id: "grammar-checkpoint", kind: "checkpoint", label: "文法混合確認30問" },
      ],
    },
  ];
  const READING_PATH = [
    {
      id: "reading-direction",
      label: "1. 敬意の方向を読む",
      description: "動作主・動作の相手・敬語の種類を分けて読む",
      tasks: [
        { id: "reading-direction", kind: "group", setId: "keigo-dokkai", groupId: "reading-direction", label: "敬意の方向を読む 4問" },
      ],
    },
    {
      id: "reading-subject",
      label: "2. 省略主語を補う",
      description: "前文の主語と敬語の向きから、文中の人物をつなぐ",
      tasks: [
        { id: "reading-subject", kind: "group", setId: "keigo-dokkai", groupId: "reading-subject", label: "省略主語を補う 4問" },
      ],
    },
    {
      id: "reading-mixed",
      label: "3. 短文読解で統合する",
      description: "複数の敬語・人物交代・使役を一続きの出来事として読む",
      tasks: [
        { id: "reading-mixed", kind: "group", setId: "keigo-dokkai", groupId: "reading-mixed", label: "短文読解で統合する 4問" },
      ],
    },
    {
      id: "reading-checkpoint",
      label: "敬語読解チェック",
      description: "敬語読解12問で、主語と敬意の方向を確認する",
      tasks: [
        { id: "reading-checkpoint", kind: "checkpoint", checkpointKey: "readingCheckpoint", sourceSetId: "keigo-dokkai", source: "reading", sampleSize: 12, total: 12, label: "敬語読解ミックス12問" },
      ],
    },
  ];
  const CULTURE_PATH = [
    {
      id: "josiki-seikatsu",
      label: "1. 宮廷生活を読む",
      description: "御簾・几帳・牛車・局から、空間と人物の身分を読む",
      tasks: [
        { id: "josiki-seikatsu", kind: "group", setId: "kobun-joshiki", groupId: "josiki-seikatsu", label: "宮廷生活を読む 4問" },
      ],
    },
    {
      id: "josiki-renai",
      label: "2. 恋愛・婚姻を読む",
      description: "通ひ・垣間見・後朝・婚姻儀礼から、時間と関係を読む",
      tasks: [
        { id: "josiki-renai", kind: "group", setId: "kobun-joshiki", groupId: "josiki-renai", label: "恋愛・婚姻を読む 4問" },
      ],
    },
    {
      id: "josiki-gyoji",
      label: "3. 年中行事を読む",
      description: "七夕・重陽・追儺・六月祓から、時期と場面の意味を読む",
      tasks: [
        { id: "josiki-gyoji", kind: "group", setId: "kobun-joshiki", groupId: "josiki-gyoji", label: "年中行事を読む 4問" },
      ],
    },
    {
      id: "josiki-checkpoint",
      label: "古文常識チェック",
      description: "古文常識12問で、本文の行間を背景知識から確認する",
      tasks: [
        { id: "josiki-checkpoint", kind: "checkpoint", checkpointKey: "josikiCheckpoint", sourceSetId: "kobun-joshiki", source: "culture", sampleSize: 12, total: 12, label: "古文常識ミックス12問" },
      ],
    },
  ];
  function allPathTasks() {
    return GRAMMAR_PATH.concat(READING_PATH, CULTURE_PATH).flatMap(stage => stage.tasks);
  }

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

  /* ---------- 「活用」タブ：助動詞＋用言の統合ホーム ---------- */
  // currentSet はグローバルなので、他セットの集計中だけ一時的に差し替えて計算する（同期処理のみなので安全）。
  function statsForSet(set) {
    const prev = currentSet;
    currentSet = set;
    const total = getItems().length;
    const mastered = masteredCount();
    const weak = weakIds().length;
    currentSet = prev;
    return { total, mastered, weak };
  }
  // set内に苦手または未習得グループが残っていれば「つづきから」候補を返す。無ければnull（=そのセットは仕上がっている）。
  function primaryForSet(set) {
    const prev = currentSet;
    currentSet = set;
    let result = null;
    const weak = weakIds();
    if (weak.length > 0) {
      result = {
        tag: "苦手復習・約" + Math.max(1, Math.round(weak.length * 0.3)) + "分",
        main: set.name + "：間違えた" + weak.length + set.unit + "を復習する",
        action: () => { currentSet = set; startSession(shuffle(weakIds()), "苦手復習"); },
      };
    } else {
      const inc = firstIncompleteGroup();
      if (inc) {
        result = {
          tag: "つづきから",
          main: set.name + "：" + inc.group.name + "（" + inc.done + " / " + inc.group.ids.length + "）",
          action: () => { currentSet = set; startSession(sessionIdsForGroup(inc.group), inc.group.name); },
        };
      }
    }
    currentSet = prev;
    return result;
  }
  function goHome() {
    if (grammarMode && activeGrammarMode === "roadmap") renderGrammarRoadmapHome();
    else if (grammarMode && activeGrammarMode === "katsuyo") renderKatsuyoHome();
    else renderHome();
  }

  function renderGrammarNav() {
    const nav = el("nav", "appNav grammarNav");
    nav.setAttribute("aria-label", "古典文法の練習モード");
    const btn = el("button", "appTab");
    btn.type = "button";
    btn.setAttribute("aria-pressed", activeGrammarMode === "roadmap" ? "true" : "false");
    btn.appendChild(el("span", null, "STAGE 2"));
    btn.appendChild(document.createTextNode("文法ロードマップ"));
    btn.addEventListener("click", () => selectGrammarMode("roadmap"));
    nav.appendChild(btn);
    return nav;
  }

  function attachGrammarNav() {
    if (grammarMode) homePanel.prepend(renderGrammarNav());
  }

  function selectGrammarMode(id) {
    activeGrammarMode = id;
    if (id === "roadmap") {
      renderGrammarRoadmapHome();
      return;
    }
    if (id === "katsuyo") {
      currentSet = null;
      renderKatsuyoHome();
      return;
    }
    currentSet = DATA.practiceSets.find(set => set.id === id) || DATA.practiceSets[0];
    renderHome();
  }

  function renderKatsuyoHome() {
    flow = null;
    sessionPanel.classList.add("hide");
    sessionPanel.innerHTML = "";
    homePanel.classList.remove("hide");
    homePanel.innerHTML = "";

    const jodoshiSet = DATA.practiceSets.find(s => s.id === "jodoshi");
    const yougoSet = DATA.practiceSets.find(s => s.id === "yougo");
    const sets = [jodoshiSet, yougoSet];
    const statsList = sets.map(statsForSet);
    const total = statsList.reduce((a, s) => a + s.total, 0);
    const mastered = statsList.reduce((a, s) => a + s.mastered, 0);
    const weak = statsList.reduce((a, s) => a + s.weak, 0);
    const sharedMode = !!(cloud && cloud.isEnabled());

    // ---- hero：つづきから（苦手復習 or 未習得グループ。助動詞→用言の順で優先） ----
    const hero = el("section", "card hero");
    hero.appendChild(el("span", "label", "KATSUYO CHECK"));
    const h2 = el("h2", null, "助動詞・用言の活用を、行ごとに埋めてテスト");
    h2.style.color = "var(--parchment)";
    hero.appendChild(h2);
    hero.appendChild(el("p", "hint", "助動詞と用言（動詞・形容詞・形容動詞）の活用練習を1つにまとめました。間違えた行はセッション末尾で再出題されます。"));

    const jodoshiPrimary = primaryForSet(jodoshiSet);
    const yougoPrimary = primaryForSet(yougoSet);
    const primary = jodoshiPrimary || yougoPrimary;
    if (primary) {
      const btn = el("button", "cta primaryCta", "");
      btn.type = "button";
      btn.appendChild(el("span", "ctaTag", primary.tag));
      btn.appendChild(el("span", "ctaMain", primary.main));
      btn.addEventListener("click", primary.action);
      hero.appendChild(btn);
    } else if (total > 0) {
      hero.appendChild(el("p", "hint", "助動詞・用言はすべて習得済みです。もう一度復習する場合は下の一覧から選べます。"));
    }
    homePanel.appendChild(hero);

    // ---- 進捗カード（助動詞＋用言の合算） ----
    const progressCard = el("section", "card");
    progressCard.appendChild(el("span", "label", "Progress"));
    const grid = el("div", "statGrid");
    [[String(mastered), "/ " + total, "MASTERED・習得"], [String(weak), "", "WEAK・苦手"], [String(total), "", "項目"]]
      .forEach(([num, small, cap]) => {
        const c = el("div", "statCell");
        const n = el("div", "statNum");
        n.appendChild(document.createTextNode(num));
        if (small) n.appendChild(el("small", null, small));
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
    progressCard.appendChild(el("p", "hint", "残り" + Math.max(0, total - mastered) + "項目。"));
    homePanel.appendChild(progressCard);

    // ---- 内訳（助動詞／用言。表示のみ、クリック不可） ----
    const breakdownCard = el("section", "card");
    breakdownCard.appendChild(el("span", "label", "内訳"));
    const chapterListEl = el("div", "breakdownList");
    sets.forEach((set, i) => {
      const s = statsList[i];
      const pct = s.total ? Math.round(s.mastered / s.total * 100) : 0;
      const row = el("div", "breakdownRow");
      const main = el("span", "chapterMain");
      main.appendChild(el("span", "chapterName", set.name));
      const miniBar = el("span", "chapterMiniBar");
      const miniFill = el("span");
      miniFill.style.width = pct + "%";
      miniBar.appendChild(miniFill);
      main.appendChild(miniBar);
      row.appendChild(main);
      row.appendChild(el("span", "chapterStat", s.mastered + "/" + s.total + " 習得"));
      chapterListEl.appendChild(row);
    });
    breakdownCard.appendChild(chapterListEl);
    homePanel.appendChild(breakdownCard);

    // ---- 練習グループを選ぶ（目的ごとに閉じ、最初は推奨カテゴリだけ開く） ----
    const listCard = el("section", "card");
    listCard.appendChild(el("span", "label", "練習グループを選ぶ"));
    const groupSections = [
      { set: jodoshiSet, title: "助動詞から選ぶ", open: !!jodoshiPrimary },
      { set: yougoSet, title: "用言から選ぶ", open: !jodoshiPrimary && !!yougoPrimary },
    ];
    groupSections.forEach(section => {
      const details = document.createElement("details");
      details.className = "groupDetails";
      details.open = section.open;
      const summary = document.createElement("summary");
      summary.className = "groupDetailsSummary";
      summary.textContent = section.title;
      details.appendChild(summary);
      const groupListEl = el("div", "groupList");
      const set = section.set;
      const prev = currentSet;
      currentSet = set;
      const p = loadProgress();
      getGroups().forEach(g => {
        const done = groupDoneCount(g, p);
        const btn = el("button", "groupBtn");
        btn.type = "button";
        const name = set.id === "jodoshi" ? "助動詞：" + g.name : g.name;
        btn.appendChild(el("span", "groupName", name));
        btn.appendChild(el("span", "groupSub", g.sub));
        btn.appendChild(el("span", "groupStat", "習得 " + done + " / " + g.ids.length));
        btn.addEventListener("click", () => { currentSet = set; startSession(sessionIdsForGroup(g), g.name); });
        groupListEl.appendChild(btn);
      });
      currentSet = prev;
      details.appendChild(groupListEl);
      listCard.appendChild(details);
    });
    homePanel.appendChild(listCard);

    // ---- その他（リセットは助動詞・用言・文法4択・識別すべての進捗を含む共有ストアを削除） ----
    if (!sharedMode) {
      const moreCard = el("section", "card");
      const details = document.createElement("details");
      details.className = "moreDetails";
      const summary = document.createElement("summary");
      summary.className = "label";
      summary.textContent = "データ管理";
      details.appendChild(summary);
      const actionsRow = el("div", "actions");
      const resetBtn = el("button", "ghost destructive", "活用・文法・識別の進捗をすべて削除");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => {
        if (confirm("進捗（習得・苦手）をすべて削除しますか？")) {
          localStorage.removeItem(STORE_KEY);
          renderKatsuyoHome();
        }
      });
      actionsRow.appendChild(resetBtn);
      details.appendChild(actionsRow);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
    attachGrammarNav();
  }

  /* ---------- 識別セクション：学習フロー（理解→4択→実践） ---------- */
  function shikibetsuProcedures() {
    return DATA[currentSet.proceduresKey] || [];
  }
  function shikibetsuGroupForProc(procId) {
    return getGroups().find(g => g.id === "sb-" + procId);
  }
  function shikibetsuQuizIds(procId) {
    const g = shikibetsuGroupForProc(procId);
    if (!g) return [];
    return g.ids.filter(id => (byId[itemKey(id)] || {}).questionType !== "integration");
  }
  function shikibetsuPracticeIds(procId) {
    const g = shikibetsuGroupForProc(procId);
    if (!g) return [];
    return g.ids.filter(id => (byId[itemKey(id)] || {}).questionType === "integration");
  }
  // 「習得済み」（isMastered、累計2回正解）は苦手復習・進捗バー用の基準。
  // フローの完了判定はセッションを1周し終えた（1回でも正解した）ことだけを基準にする。
  // 各セッションは誤答をキュー末尾に再出題し続け、全問正解するまで終わらないため、
  // セッション完了＝そのステージの全問が最低1回は正解済み、と言える。
  function shikibetsuIdCleared(id, p) {
    const rec = progressRecord(p, id);
    return !!rec && rec.c >= 1;
  }
  function shikibetsuProcStatus(procId) {
    const p = loadProgress();
    const quizIds = shikibetsuQuizIds(procId);
    const practiceIds = shikibetsuPracticeIds(procId);
    const quizDone = quizIds.filter(id => shikibetsuIdCleared(id, p)).length;
    const practiceDone = practiceIds.filter(id => shikibetsuIdCleared(id, p)).length;
    return {
      quizIds, practiceIds, quizDone, practiceDone,
      complete: quizIds.length > 0 && quizDone === quizIds.length
        && practiceIds.length > 0 && practiceDone === practiceIds.length,
    };
  }
  function firstIncompleteProcedure() {
    return shikibetsuProcedures().find(proc => !shikibetsuProcStatus(proc.id).complete) || null;
  }

  /* ---------- 文法ロードマップ（第2段階） ---------- */
  function loadPathState() {
    try {
      const raw = localStorage.getItem(PATH_STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function savePathState(state) {
    try { localStorage.setItem(PATH_STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function grammarTaskCycles(state) {
    if (!state.grammarTaskCycles || typeof state.grammarTaskCycles !== "object") {
      state.grammarTaskCycles = {};
    }
    return state.grammarTaskCycles;
  }
  function grammarTaskCycle(taskId) {
    const state = loadPathState();
    const cycle = grammarTaskCycles(state)[taskId];
    return cycle && typeof cycle === "object" ? cycle : {};
  }
  function saveGrammarTaskCycle(taskId, patch) {
    const state = loadPathState();
    const cycles = grammarTaskCycles(state);
    cycles[taskId] = Object.assign({}, cycles[taskId] || {}, patch);
    savePathState(state);
  }
  function practiceSetById(id) {
    return DATA.practiceSets.find(set => set.id === id) || null;
  }
  function taskGroup(task) {
    const prev = currentSet;
    const set = practiceSetById(task.setId);
    if (!set) return null;
    currentSet = set;
    const group = getGroups().find(g => g.id === task.groupId) || null;
    currentSet = prev;
    return group;
  }
  function taskIds(task) {
    const group = taskGroup(task);
    return group ? group.ids.slice() : [];
  }
  function isGrammarCumulativeTask(task) {
    return task.kind === "group" && ["yougo", "jodoshi", "choice"].includes(task.setId);
  }
  function cumulativeTaskIds(task) {
    const ids = [];
    let reached = false;
    for (const stage of GRAMMAR_PATH) {
      for (const candidate of stage.tasks) {
        if (candidate.kind === "group" && candidate.setId === task.setId) {
          ids.push(...taskIds(candidate));
        }
        if (candidate.id === task.id) {
          reached = true;
          break;
        }
      }
      if (reached) break;
    }
    return [...new Set(ids)];
  }
  function taskStatus(task) {
    if (task.kind === "procedure") {
      const prev = currentSet;
      currentSet = practiceSetById("shikibetsu");
      const status = shikibetsuProcStatus(task.procId);
      currentSet = prev;
      return {
        done: status.quizDone + status.practiceDone,
        total: status.quizIds.length + status.practiceIds.length,
        complete: status.complete,
      };
    }
    if (task.kind === "checkpoint") {
      const checkpointKey = task.checkpointKey || "grammarCheckpoint";
      const checkpoint = loadPathState()[checkpointKey] || {};
      const total = Number(checkpoint.total) || Number(task.total) || 30;
      const score = Number(checkpoint.score) || 0;
      return { done: checkpoint.passed ? total : score, total, complete: checkpoint.passed };
    }
    const prev = currentSet;
    const set = practiceSetById(task.setId);
    if (!set) return { done: 0, total: 0, complete: false };
    currentSet = set;
    const p = loadProgress();
    const ids = taskIds(task);
    if (!isGrammarCumulativeTask(task)) {
      const done = ids.filter(id => isMastered(progressRecord(p, id))).length;
      currentSet = prev;
      return { done, total: ids.length, complete: ids.length > 0 && done === ids.length };
    }
    const cycle = grammarTaskCycle(task.id);
    const legacyComplete = ids.length > 0 && ids.every(id => isMastered(progressRecord(p, id)));
    const complete = !!cycle.cumulativeCompleted || legacyComplete;
    const passCompleted = !!cycle.passCompleted || legacyComplete;
    const done = complete || passCompleted
      ? ids.length
      : ids.filter(id => {
          const rec = progressRecord(p, id);
          return !!rec && rec.c >= 1;
        }).length;
    currentSet = prev;
    return {
      done,
      total: ids.length,
      complete: ids.length > 0 && complete,
      phase: complete ? "完了" : passCompleted ? "累積10問" : "通し"
    };
  }
  function grammarPathStatus() {
    let previousComplete = true;
    return GRAMMAR_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      const available = previousComplete;
      previousComplete = previousComplete && complete;
      return Object.assign({}, stage, { tasks, complete, available });
    });
  }
  function readingPathStatus() {
    const grammarComplete = grammarPathStatus().every(stage => stage.complete);
    let previousComplete = grammarComplete;
    return READING_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      const available = previousComplete;
      previousComplete = previousComplete && complete;
      return Object.assign({}, stage, { tasks, complete, available });
    });
  }
  function culturePathStatus() {
    const readingComplete = readingPathStatus().every(stage => stage.complete);
    let previousComplete = readingComplete;
    return CULTURE_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      const available = previousComplete;
      previousComplete = previousComplete && complete;
      return Object.assign({}, stage, { tasks, complete, available });
    });
  }
  function firstIncompleteGrammarTask() {
    const stages = grammarPathStatus();
    for (const stage of stages) {
      if (!stage.available || stage.complete) continue;
      const task = stage.tasks.find(item => !item.status.complete);
      if (task) return { stage, task };
    }
    return null;
  }
  function firstIncompleteReadingTask() {
    const stages = readingPathStatus();
    for (const stage of stages) {
      if (!stage.available || stage.complete) continue;
      const task = stage.tasks.find(item => !item.status.complete);
      if (task) return { stage, task };
    }
    return null;
  }
  function firstIncompleteCultureTask() {
    const stages = culturePathStatus();
    for (const stage of stages) {
      if (!stage.available || stage.complete) continue;
      const task = stage.tasks.find(item => !item.status.complete);
      if (task) return { stage, task };
    }
    return null;
  }
  function firstIncompleteRequiredTask() {
    return firstIncompleteGrammarTask() || firstIncompleteReadingTask() || firstIncompleteCultureTask();
  }
  function requiredChoiceIds() {
    const ids = [];
    GRAMMAR_PATH.forEach(stage => stage.tasks.forEach(task => {
      if (task.kind === "group" && task.setId === "choice") ids.push(...taskIds(task));
    }));
    return [...new Set(ids)];
  }
  function requiredReadingIds() {
    const ids = [];
    READING_PATH.forEach(stage => stage.tasks.forEach(task => {
      if (task.kind === "group") ids.push(...taskIds(task));
    }));
    return [...new Set(ids)];
  }
  function requiredCultureIds() {
    const ids = [];
    CULTURE_PATH.forEach(stage => stage.tasks.forEach(task => {
      if (task.kind === "group") ids.push(...taskIds(task));
    }));
    return [...new Set(ids)];
  }
  function sourceIdsForCheckpoint(task) {
    if (task.source === "reading") return requiredReadingIds();
    if (task.source === "culture") return requiredCultureIds();
    return requiredChoiceIds();
  }
  function startRequiredTask(task, review = false) {
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = task.id;
    if (task.kind === "procedure") {
      currentSet = practiceSetById("shikibetsu");
      startShikibetsuFlow(task.procId);
      return;
    }
    if (task.kind === "checkpoint") {
      currentSet = practiceSetById(task.sourceSetId || "choice");
      const ids = shuffle(sourceIdsForCheckpoint(task)).slice(0, task.sampleSize || 30);
      startSession(ids, task.label, { pathTask: task.id });
      return;
    }
    const set = practiceSetById(task.setId);
    const ids = taskIds(task);
    currentSet = set;
    if (!isGrammarCumulativeTask(task)) {
      const p = loadProgress();
      const pending = review ? ids : ids.filter(id => !isMastered(progressRecord(p, id)));
      startSession(pending.length ? pending : ids, task.label, { pathTask: task.id });
      return;
    }
    if (review) {
      startSession(ids, task.label, { pathTask: task.id });
      return;
    }
    const cycle = grammarTaskCycle(task.id);
    if (!cycle.passCompleted) {
      startSession(ids, task.label + "・通し演習", {
        pathTask: task.id,
        pathPhase: "pass",
        requeueWrong: false,
      });
      return;
    }
    const cumulativeIds = shuffle(cumulativeTaskIds(task)).slice(0, PATH_CUMULATIVE_SIZE);
    startSession(cumulativeIds, task.label + "・累積10問", {
      pathTask: task.id,
      pathPhase: "cumulative",
      requeueWrong: false,
    });
  }
  function appendPathSection(title, stages, stats, hintText, lockText) {
    const progress = el("section", "card");
    progress.appendChild(el("span", "label", title + "の進捗"));
    const grid = el("div", "statGrid");
    stats.forEach(([num, small, cap]) => {
      const cell = el("div", "statCell");
      const n = el("div", "statNum");
      n.appendChild(document.createTextNode(num));
      if (small) n.appendChild(el("small", null, small));
      cell.appendChild(n);
      cell.appendChild(el("div", "statCaption", cap));
      grid.appendChild(cell);
    });
    progress.appendChild(grid);
    const completedStages = stages.filter(stage => stage.complete).length;
    const bar = el("div", "masteryBar");
    bar.setAttribute("aria-label", title + "の完了 " + completedStages + "/" + stages.length);
    const fill = el("div", "masteryFill");
    fill.style.width = Math.round(completedStages / stages.length * 100) + "%";
    bar.appendChild(fill);
    progress.appendChild(bar);
    progress.appendChild(el("p", "hint", hintText));
    homePanel.appendChild(progress);

    const list = el("div", "pathStages");
    stages.forEach((stage, stageIndex) => {
      const card = el("section", "card pathStageCard" + (stage.available && !stage.complete ? " current" : ""));
      const head = el("div", "pathStageHead");
      const info = el("div");
      info.appendChild(el("span", "label", "必修 " + (stageIndex + 1)));
      info.appendChild(el("h3", null, stage.label));
      info.appendChild(el("p", "hint", stage.description));
      head.appendChild(info);
      const statusLabel = stage.complete ? "完了" : stage.available ? "進行中" : "未解放";
      head.appendChild(el("span", "pathStageStatus", statusLabel));
      card.appendChild(head);

      const taskList = el("div", "pathTaskList");
      stage.tasks.forEach(task => {
        const row = el("div", "pathTaskRow" + (task.status.complete ? " done" : ""));
        row.appendChild(el("span", "pathTaskMark", task.status.complete ? "✓" : "□"));
        row.appendChild(el("span", "pathTaskLabel", task.label));
        row.appendChild(el("span", "pathTaskStat", task.status.done + "/" + task.status.total + (task.status.phase ? "・" + task.status.phase : "")));
        taskList.appendChild(row);
      });
      card.appendChild(taskList);

      if (stage.complete) {
        const actions = el("div", "actions");
        const review = el("button", "ghost smallGhost", "この必修を復習する");
        review.type = "button";
        review.addEventListener("click", () => startRequiredTask(stage.tasks[0], true));
        actions.appendChild(review);
        card.appendChild(actions);
      } else if (!stage.available) {
        card.appendChild(el("p", "hint pathLockHint", lockText));
      }
      list.appendChild(card);
    });
    homePanel.appendChild(list);
  }
  function renderGrammarRoadmapHome() {
    flow = null;
    session = null;
    currentSet = null;
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = null;
    sessionPanel.classList.add("hide");
    sessionPanel.innerHTML = "";
    homePanel.classList.remove("hide");
    homePanel.innerHTML = "";

    const grammarStages = grammarPathStatus();
    const grammarComplete = grammarStages.every(stage => stage.complete);
    const readingStages = readingPathStatus();
    const readingComplete = readingStages.every(stage => stage.complete);
    const cultureStages = culturePathStatus();
    const cultureComplete = cultureStages.every(stage => stage.complete);
    const sharedMode = !!(cloud && cloud.isEnabled());
    const next = !grammarComplete
      ? firstIncompleteGrammarTask()
      : !readingComplete
        ? firstIncompleteReadingTask()
        : firstIncompleteCultureTask();
    const hero = el("section", "card hero");
    hero.appendChild(el("span", "label", !grammarComplete
      ? "STAGE 2 / GRAMMAR"
      : !readingComplete
        ? "STAGE 3 / KEIGO READING"
        : "STAGE 4 / CLASSICAL CULTURE"));
    hero.appendChild(el("h2", null, !grammarComplete
      ? (next ? "文法を順番に固める" : "第2段階の文法を完了しました")
      : !readingComplete
        ? (next ? "敬語を読解に使う" : "第3段階の敬語読解を完了しました")
        : (next ? "古文常識を読解に使う" : "第4段階の古文常識を完了しました")));
    hero.appendChild(el("p", "hint", !grammarComplete
      ? "用言 → 助動詞 → 助動詞識別 → 敬語基礎の順で進みます。後の項目は、前の必修を終えるまで解放されません。"
      : !readingComplete
        ? "敬意の方向 → 省略主語 → 短文統合の順で、敬語を主語判別に使います。"
        : "宮廷生活 → 恋愛・婚姻 → 年中行事の順で、文法だけでは埋まらない行間を読みます。"));
    if (next) {
      const primary = el("button", "cta primaryCta", "");
      primary.type = "button";
      primary.appendChild(el("span", "ctaTag", "次にやること"));
      primary.appendChild(el("span", "ctaMain", next.task.label));
      primary.addEventListener("click", () => startRequiredTask(next.task));
      hero.appendChild(primary);
    } else {
      hero.appendChild(el("p", "hint", cultureComplete
        ? "現在の必修範囲はここまでです。復習は下の完了済み項目から行えます。"
        : readingComplete
          ? "第4段階（古文常識）の次の必修を選べる状態です。復習は下の完了済み項目から行えます。"
          : "第3段階（敬語読解）の次の必修を選べる状態です。復習は下の完了済み項目から行えます。"));
    }
    homePanel.appendChild(hero);

    const grammarCompleted = grammarStages.filter(stage => stage.complete).length;
    appendPathSection("第2段階", grammarStages,
      [[String(grammarCompleted), "/ " + grammarStages.length, "COMPLETE・完了"], [String(grammarStages.length - grammarCompleted), "", "REMAINING・残り"], [String(requiredChoiceIds().length), "", "確認対象の4択"]],
      "通常問題は1周後に既習範囲から累積10問、識別フローは4択・実践を全問1回正解で完了扱いです。最後に文法混合確認30問を行います。",
      "前の文法必修を完了すると解放されます。");

    const readingCompleted = readingStages.filter(stage => stage.complete).length;
    appendPathSection("第3段階", readingStages,
      [[String(readingCompleted), "/ " + readingStages.length, "COMPLETE・完了"], [String(readingStages.length - readingCompleted), "", "REMAINING・残り"], [String(requiredReadingIds().length), "", "敬語読解の確認"]],
      "敬語読解は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第2段階の文法を完了すると解放されます。");
    const cultureCompleted = cultureStages.filter(stage => stage.complete).length;
    appendPathSection("第4段階", cultureStages,
      [[String(cultureCompleted), "/ " + cultureStages.length, "COMPLETE・完了"], [String(cultureStages.length - cultureCompleted), "", "REMAINING・残り"], [String(requiredCultureIds().length), "", "古文常識の確認"]],
      "古文常識は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第3段階の敬語読解を完了すると解放されます。");
    if (!sharedMode) {
      const moreCard = el("section", "card");
      const details = document.createElement("details");
      details.className = "moreDetails";
      const summary = document.createElement("summary");
      summary.className = "label";
      summary.textContent = "データ管理";
      details.appendChild(summary);
      const actions = el("div", "actions");
      const reset = el("button", "ghost destructive", "文法の進捗をすべて削除");
      reset.type = "button";
      reset.addEventListener("click", () => {
        if (confirm("文法の習得・苦手・確認テストの記録をすべて削除しますか？")) {
          localStorage.removeItem(STORE_KEY);
          localStorage.removeItem(PATH_STORE_KEY);
          renderGrammarRoadmapHome();
        }
      });
      actions.appendChild(reset);
      details.appendChild(actions);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
    attachGrammarNav();
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
    flow = null;
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
    } else if (currentSet.proceduresKey) {
      const proc = firstIncompleteProcedure();
      if (proc) {
        primary = {
          tag: "つづきから",
          main: proc.name + "を学習する",
          action: () => startShikibetsuFlow(proc.id),
        };
      } else if (total > 0) {
        primary = {
          tag: "総仕上げ",
          main: total + currentSet.unit + "をランダム出題",
          action: () => startSession(shuffle(getItems().map(itemId)), "総仕上げ"),
        };
      }
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

    // 識別タブは手順学習カード（つづきから・この手順を学習する）が唯一の導線のため、
    // 知識項目チェック・グループ一覧（練習グループを選ぶ）は表示しない。
    if (currentSet.id !== "shikibetsu") {
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
    }

    // ---- その他（リセット、単語モードと同じく折りたたみ＋共有モード時は非表示） ----
    if (!sharedMode) {
      const moreCard = el("section", "card");
      const details = document.createElement("details");
      details.className = "moreDetails";
      const summary = document.createElement("summary");
      summary.className = "label";
      summary.textContent = "データ管理";
      details.appendChild(summary);
      const actionsRow = el("div", "actions");
      const resetBtn = el("button", "ghost destructive", "活用・文法・識別の進捗をすべて削除");
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
    attachGrammarNav();
  }

  // 識別セクション専用：手順ごとに「学習する」ボタン（理解→4択→実践のフロー開始）と
  // 4択・実践の習得状況、手順本文（手順I〜IV）の折りたたみ確認を並べたカード。
  function renderProcedureStepsCard() {
    const procedures = shikibetsuProcedures();
    if (!procedures.length) return;
    const card = el("section", "card");
    card.appendChild(el("span", "label", "手順を学習する"));
    card.appendChild(el("p", "hint", "手順の内容理解→4択問題→実践問題（統合）の順に進みます。"));
    procedures.forEach(proc => {
      const status = shikibetsuProcStatus(proc.id);
      const block = el("div", "procedureLearnBlock");

      const head = el("div", "procedureLearnHead");
      const info = el("div");
      info.appendChild(el("p", "procedureName", proc.name));
      info.appendChild(el("p", "procedureSub", proc.sub));
      head.appendChild(info);
      const startBtn = el("button", "cta", status.complete ? (proc.name + "をもう一度学ぶ") : (proc.name + "を学ぶ"));
      startBtn.type = "button";
      startBtn.addEventListener("click", () => startShikibetsuFlow(proc.id));
      head.appendChild(startBtn);
      block.appendChild(head);

      block.appendChild(el("p", "procedureLearnStat",
        "4択 完了 " + status.quizDone + " / " + status.quizIds.length
        + "　実践 完了 " + status.practiceDone + " / " + status.practiceIds.length));

      const details = document.createElement("details");
      details.className = "procedureDetails";
      const summary = document.createElement("summary");
      summary.appendChild(el("span", null, "手順本文を読む"));
      details.appendChild(summary);
      const list = el("ol", "procedureStepList");
      proc.steps.forEach(step => {
        const li = el("li", "procedureStep");
        li.appendChild(el("span", "procedureStepNo", step.no));
        li.appendChild(document.createTextNode(step.text));
        list.appendChild(li);
      });
      details.appendChild(list);
      block.appendChild(details);

      card.appendChild(block);
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

  function startSession(ids, title, opts) {
    if (!ids || ids.length === 0) { goHome(); return; }
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
      requeueWrong: !(opts && opts.requeueWrong === false),
      flow: (opts && opts.flow) || null, // 識別の学習フロー内で開始されたセッションかどうか
      pathTask: (opts && opts.pathTask) || activeGrammarPathTask,
      pathPhase: (opts && opts.pathPhase) || null,
    };
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    renderRow();
  }

  function scrollToSessionTop() {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  }

  function renderNextQuestion() {
    renderRow();
    requestAnimationFrame(scrollToSessionTop);
  }

  // 識別セクションの学習フロー：手順本文の理解 → 4択問題 → 実践問題（統合）の順に進む。
  function startShikibetsuFlow(procId) {
    const proc = shikibetsuProcedures().find(pr => pr.id === procId);
    if (!proc) { goHome(); return; }
    flow = { procId, flashIdx: 0 };
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    renderUnderstand();
  }

  function startShikibetsuQuiz() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    flow.stage = "quiz";
    startSession(shikibetsuQuizIds(flow.procId), proc.name + "・4択問題", { flow: Object.assign({}, flow) });
  }

  function startShikibetsuPractice() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    flow.stage = "practice";
    startSession(shikibetsuPracticeIds(flow.procId), proc.name + "・実践問題", { flow: Object.assign({}, flow) });
  }

  // 理解→4択→実践の3ステージを表す帯（eiken2-q1のstageBarに相当する構成）。
  function flowStageBar(stage) {
    const order = ["understand", "quiz", "practice"];
    const labels = { understand: "1 理解", quiz: "2 4択", practice: "3 実践" };
    const cur = order.indexOf(stage);
    const bar = el("div", "flowStageBar");
    order.forEach((s, i) => {
      let cls = "flowStagePill";
      if (i < cur) cls += " cleared";
      if (s === stage) cls += " active";
      bar.appendChild(el("div", cls, labels[s]));
    });
    return bar;
  }

  function flowHead(proc) {
    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, proc.name));
    head.appendChild(info);
     const quit = el("button", "ghost smallGhost", "演習を中断");
     quit.type = "button";
     quit.addEventListener("click", goHome);
     head.appendChild(quit);
     head.appendChild(el("span", "sessionSaveHint", "進捗は保存されます"));
    return head;
  }

  // STEP 1：手順本文（手順I〜IV）を1枚ずつ確認する（eiken2-q1のflashカードに相当）。
  function renderUnderstand() {
    sessionPanel.innerHTML = "";
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    const steps = proc.steps;
    const idx = flow.flashIdx;
    const step = steps[idx];

    sessionPanel.appendChild(flowHead(proc));
    sessionPanel.appendChild(flowStageBar("understand"));

    const box = el("div", "drillBox understandBox");
    box.appendChild(el("p", "askLabel", proc.name + "・" + proc.sub));
    const stepBox = el("div", "understandStep");
    stepBox.appendChild(el("span", "procedureStepNo", step.no));
    stepBox.appendChild(el("p", "understandStepText", step.text));
    box.appendChild(stepBox);

    const nav = el("div", "actions");
    const canBack = idx > 0;
    const prev = el("button", "ghost", "← 前の手順");
    prev.type = "button";
    if (!canBack) prev.disabled = true;
    prev.addEventListener("click", () => { flow.flashIdx -= 1; renderUnderstand(); });
    nav.appendChild(prev);

    const isLast = idx === steps.length - 1;
    const next = el("button", "cta", isLast ? "4択問題へ進む →" : "次の手順 →");
    next.type = "button";
    next.id = "understandNextBtn";
    next.addEventListener("click", () => {
      if (isLast) startShikibetsuQuiz();
      else { flow.flashIdx += 1; renderUnderstand(); }
    });
    nav.appendChild(next);
    box.appendChild(nav);
    box.appendChild(el("p", "cardCounter", "手順 " + (idx + 1) + " / " + steps.length));

    sessionPanel.appendChild(box);
  }

  // フロー内のセッション（4択・実践）が完了したときの分岐：
  // 4択完了→実践へ、実践完了→手順の学習完了（次の未完了手順への導線）。
  function renderFlowDone() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    const card = el("section", "card");
    card.appendChild(el("span", "label", "Next"));

    const actions = el("div", "actions");
    if (session.flow.stage === "quiz") {
      card.appendChild(el("p", "resultText", "4択問題が完了しました。次は実践問題（統合）で、識別手順を最後まで適用します。"));
      const next = el("button", "cta", "実践問題へ進む →");
      next.type = "button";
      next.addEventListener("click", startShikibetsuPractice);
      actions.appendChild(next);
    } else {
      card.appendChild(el("p", "resultText", proc.name + "の学習が完了しました。"));
      const pathNext = session.pathTask ? firstIncompleteRequiredTask() : null;
      const nextProc = firstIncompleteProcedure();
      const nextTask = pathNext ? pathNext.task : (nextProc ? { label: nextProc.name, procId: nextProc.id, kind: "procedure" } : null);
      if (nextTask) {
        const next = el("button", "cta", session.pathTask ? "次の必修へ（" + nextTask.label + "） →" : "次の手順を学習する（" + nextTask.label + "） →");
        next.type = "button";
        next.addEventListener("click", () => session.pathTask ? startRequiredTask(nextTask) : startShikibetsuFlow(nextTask.procId));
        actions.appendChild(next);
      } else if (session.pathTask) {
        const next = el("button", "cta", "文法ロードマップを見る");
        next.type = "button";
        next.addEventListener("click", renderGrammarRoadmapHome);
        actions.appendChild(next);
      }
    }
    const backHome = el("button", "ghost smallGhost", "ホームに戻る");
    backHome.type = "button";
    backHome.addEventListener("click", goHome);
    actions.appendChild(backHome);
    card.appendChild(actions);

    sessionPanel.appendChild(card);
  }

  // 3つの出題UI（活用ドリル・4択・統合ステップ）で共通のヘッダー＋進捗バー。
  function renderSessionChrome() {
    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, session.title));
    info.appendChild(el("span", null, "残り " + session.queue.length));
    head.appendChild(info);
     const quit = el("button", "ghost smallGhost", "演習を中断");
     quit.addEventListener("click", goHome);
     head.appendChild(quit);
     head.appendChild(el("span", "sessionSaveHint", "進捗は保存されます"));
    sessionPanel.appendChild(head);

    if (session.flow) sessionPanel.appendChild(flowStageBar(session.flow.stage));

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

    // 活用の型
    const typeOptions = Array.from(new Set(getItems().map(item => item.type))).filter(Boolean);
    box.appendChild(buildTypeField("活用の型", typeOptions.length ? typeOptions : DATA.typeOptions, v => state.type = v, state, "type"));

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

      if (!ok) {
        const wf = el("div", "feedback ng stepInlineFb");
        addAnswer(wf, "解説", step.explanation);
        const why = q.distractorRationale && q.distractorRationale[step.choices[idx]];
        if (why) addAnswer(wf, "誤答の理由", why);
        stepBox.appendChild(wf);
      }

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
    renderNextQuestion();
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
      if (session.requeueWrong) {
        if (!wasRequeued) {
          session.requeued.add(id);
          session.queue.push(id); // retry at end (once)
        } else {
          session.queue.push(id); // keep retrying until correct
        }
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
    next.addEventListener("click", renderNextQuestion);
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
      if (session.requeueWrong) {
        if (!wasRequeued) session.requeued.add(id);
        session.queue.push(id);
      }
    }

    const fb = el("div", "feedback " + (allOk ? "ok" : "ng"));
    fb.appendChild(el("h3", null, allOk ? "正解" : "不正解"));
    addAnswer(fb, "正解", q.choices[q.answerIndex]);
    if (!allOk && q.distractorRationale) {
      const why = q.distractorRationale[q.choices[chosen]];
      if (why) addAnswer(fb, "誤答の理由", why);
    }
    addAnswer(fb, "解説", q.explanation);
    box.appendChild(fb);

    const nextRow = el("div", "nextRow");
    const next = el("button", "cta", session.queue.length ? "次の問題へ" : "結果を見る");
    next.id = "katsuyoNextBtn";
    next.addEventListener("click", renderNextQuestion);
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

  function renderPathPassDone(taskDef) {
    saveGrammarTaskCycle(taskDef.id, { passCompleted: true });
    sessionPanel.innerHTML = "";
    const score = session.firstTryOk;
    const total = session.total;
    const pct = total ? Math.round((score / total) * 100) : 0;
    const banner = el("div", "doneBanner");
    banner.appendChild(el("p", "label", "通し演習 完了"));
    banner.querySelector(".label").style.color = "rgba(255,255,255,.72)";
    banner.appendChild(el("div", "big", score + " / " + total));
    banner.appendChild(el("div", "sub", "正答率 " + pct + "%"));
    sessionPanel.appendChild(banner);

    const card = el("section", "card");
    card.appendChild(el("span", "label", "Next"));
    card.appendChild(el("p", "resultText", taskDef.label + "を1周しました。次は既習範囲から古典文法の累積10問です。"));
    const actions = el("div", "actions");
    const next = el("button", "cta", "累積10問へ進む →");
    next.type = "button";
    next.addEventListener("click", () => startRequiredTask(taskDef));
    actions.appendChild(next);
    if (session.wrongNos.size) {
      const retry = el("button", "ghost", "間違えた" + session.wrongNos.size + currentSet.unit + "を復習する");
      retry.type = "button";
      retry.addEventListener("click", () => startSession(shuffle(Array.from(session.wrongNos)), taskDef.label + "・苦手復習"));
      actions.appendChild(retry);
    }
    const home = el("button", "ghost smallGhost", "ホームに戻る");
    home.type = "button";
    home.addEventListener("click", goHome);
    actions.appendChild(home);
    card.appendChild(actions);
    sessionPanel.appendChild(card);
  }

  function renderDone() {
    sessionPanel.innerHTML = "";
    const total = session.total;
    const score = session.firstTryOk;
    const pct = total ? Math.round((score / total) * 100) : 0;

    const pathTaskDef = session.pathTask ? allPathTasks().find(task => task.id === session.pathTask) : null;
    if (pathTaskDef && session.pathPhase === "pass") {
      renderPathPassDone(pathTaskDef);
      return;
    }
    if (pathTaskDef && session.pathPhase === "cumulative") {
      saveGrammarTaskCycle(pathTaskDef.id, { passCompleted: true, cumulativeCompleted: true });
    }
    if (pathTaskDef && pathTaskDef.kind === "checkpoint") {
      const pathState = loadPathState();
      const checkpointKey = pathTaskDef.checkpointKey || "grammarCheckpoint";
      pathState[checkpointKey] = {
        score,
        total,
        passed: score >= Math.ceil(total * 0.8),
      };
      savePathState(pathState);
    }

    const banner = el("div", "doneBanner");
    banner.appendChild(el("p", "label", "Session Complete"));
    banner.querySelector(".label").style.color = "rgba(255,255,255,.72)";
    banner.appendChild(el("div", "big", score + " / " + total));
    banner.appendChild(el("div", "sub", "正答率 " + pct + "%"));
    sessionPanel.appendChild(banner);

    if (session.flow) { renderFlowDone(); return; }

    const card = el("section", "card");
    card.appendChild(el("span", "label", "Next"));
    const wrongCount = session.wrongNos.size;
    const wrongResult = wrongCount
      ? (session.requeueWrong ? "誤答はすべて解き直し済みです。" : "誤答は復習に記録されています。")
      : "";
    if (session.pathTask) {
      const next = firstIncompleteRequiredTask();
      const checkpoint = !!(pathTaskDef && pathTaskDef.kind === "checkpoint");
      const passed = checkpoint && score >= Math.ceil(total * 0.8);
      const result = checkpoint
        ? (passed ? pathTaskDef.label + "に合格しました。" : pathTaskDef.label + "は不合格です。" + Math.ceil(total * 0.8) + " / " + total + "以上で次へ進めます。")
        : session.pathPhase === "cumulative"
          ? pathTaskDef.label + "の通し演習と累積10問を完了しました。"
          : "この必修タスクを完了しました。";
      card.appendChild(el("p", "resultText", result + wrongResult));
      const pathActions = el("div", "actions");
      if (next) {
        const nextBtn = el("button", "cta", "次の必修へ（" + next.task.label + "） →");
        nextBtn.type = "button";
        nextBtn.addEventListener("click", () => startRequiredTask(next.task));
        pathActions.appendChild(nextBtn);
      } else {
        const roadmapBtn = el("button", "cta", "学習ロードマップを見る");
        roadmapBtn.type = "button";
        roadmapBtn.addEventListener("click", renderGrammarRoadmapHome);
        pathActions.appendChild(roadmapBtn);
      }
      const homeBtn = el("button", "ghost smallGhost", "ホームに戻る");
      homeBtn.type = "button";
      homeBtn.addEventListener("click", goHome);
      pathActions.appendChild(homeBtn);
      card.appendChild(pathActions);
      sessionPanel.appendChild(card);
      return;
    }
    card.appendChild(el("p", "resultText", "一発正解は" + score + currentSet.unit + "。" + (wrongCount ? "間違えた" + currentSet.unit + "はホームの「間違えた" + currentSet.unit + "を復習する」に残ります。" : "")));

    const actions = el("div", "actions");
    if (wrongCount > 0) {
      const nos = Array.from(session.wrongNos);
      const retry = el("button", "cta reviewCta", "間違えた" + nos.length + currentSet.unit + "をもう一度");
      retry.addEventListener("click", () => startSession(shuffle(nos), "苦手復習"));
      actions.appendChild(retry);
    }
    const backHome = el("button", "ghost smallGhost", "ホームに戻る");
    backHome.addEventListener("click", goHome);
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
    if (flow && !session && e.key === "Enter") {
      const btn = document.getElementById("understandNextBtn");
      if (btn) btn.click();
      return;
    }
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
      fetch("data/multiple_choice.json?v=20260716-1")
        .then(r => { if (!r.ok) throw new Error("choice data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu.json?v=20260722-1")
        .then(r => { if (!r.ok) throw new Error("shikibetsu data load failed: " + r.status); return r.json(); }),
      fetch("data/keigo-dokkai.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("keigo-dokkai data load failed: " + r.status); return r.json(); }),
      fetch("data/kobun-joshiki.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("kobun-joshiki data load failed: " + r.status); return r.json(); })
    ])
      .then(async ([d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData]) => {
        DATA = Object.assign({}, d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData);

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
        const keigoDokkaiSet = {
          id: "keigo-dokkai",
          name: "敬語読解",
          label: "KEIGO READING",
          description: "敬語の方向と省略主語を、短文読解で判断する",
          collection: "keigoDokkaiQuestions",
          groups: "keigoDokkaiGroups",
          askLabel: "手順に沿って本文を読む",
          unit: "問",
          mode: "choice",
          homeTitle: "敬語の方向と主語を短文読解で確認"
        };
        const kobunJoshikiSet = {
          id: "kobun-joshiki",
          name: "古文常識",
          label: "CLASSICAL CULTURE",
          description: "当時の住まい・恋愛・年中行事を短文読解に使う",
          collection: "kobunJoshikiQuestions",
          groups: "kobunJoshikiGroups",
          askLabel: "本文と古文常識を結び付けて読む",
          unit: "問",
          mode: "choice",
          homeTitle: "古文常識を、本文の行間を読む道具として確認"
        };

        DATA.practiceSets = [jodoshiSet, yougoSet, choiceSet, shikibetsuSet, keigoDokkaiSet, kobunJoshikiSet];
        DATA.practiceSets.forEach(set => {
          (DATA[set.collection] || []).forEach(item => { byId[set.id + ":" + itemId(item)] = item; });
        });

        // 生徒別クラウド同期（共有URL ?s=&t= があり config.json が揃うときのみ有効）。
        // 6つの練習セット（jodoshi/yougo/choice/shikibetsu/keigo-dokkai/kobun-joshiki）の進捗を1つのprogressマップとしてまとめて同期する。
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
    grammarMode = (setId === "grammar");
    if (grammarMode) {
      currentSet = null;
      renderGrammarRoadmapHome();
      return;
    }
    currentSet = DATA.practiceSets.find(s => s.id === setId) || DATA.practiceSets[0];
    renderHome();
  }

  return { mount, handleKey };
})();
