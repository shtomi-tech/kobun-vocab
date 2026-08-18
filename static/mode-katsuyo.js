"use strict";

const KatsuyoApp = (function () {
  const FORM_NAMES = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
  const STORE_KEY = "kobun-katsuyo-progress-v2";
  const APP_ID = "kobun-katsuyo-v2";
  const MASTERY_THRESHOLD = 2; // 「累計2回正解」で習得扱いとする
  const IDENTIFICATION_PRACTICE_VERSION = 2;

  const homePanel = document.getElementById("homePanel");
  const sessionPanel = document.getElementById("sessionPanel");

  let DATA = null;
  let currentSet = null;
  let byId = {};
  let cloud = null;
  let flow = null; // 識別セクションの学習フロー文脈（理解→実践）
  let grammarMode = false; // 上段の「古典文法」モードかどうか
  let activeGrammarMode = "roadmap"; // 古典文法内の現在の練習モード
  let activeGrammarPathTask = null; // 文法ロードマップから開始した必修タスク
  let activeGrammarPathReview = false; // ロードマップの小項目を復習中かどうか
  const PATH_STORE_KEY = "kobun-katsuyo-path-v2";

  function clearPreparationProgress() {
    if (typeof KobunPreparation !== "undefined" && KobunPreparation
      && typeof KobunPreparation.clearProgress === "function") {
      KobunPreparation.clearProgress();
    }
  }
  // 段階1（古典文法）の必修は、data/curriculum.json（6章46講）を正本として
  // boot()で読み込み、buildGrammarPathFromCurriculum()で1講=1ステージのGRAMMAR_PATH形状
  // （{id, label, description, tasks:[{id,kind,setId,groupId?,ids?,procId?,label}]}）へ変換する。
  // 起動前（boot完了前）は空配列。予習資料の参照も、旧PREPARATION_PATHSの代わりに
  // 各stageへ持たせたstage.preparation（lesson.preparationそのまま）から解決する。
  let GRAMMAR_PATH = [];
  // curriculum.json（fetch生データ）そのもの。lessonStatus/chapterStatus/firstIncompleteLessonが
  // 章・講の構造（number, title, lessons配列）を辿るために持つ。GRAMMAR_PATHは平坦化済みで
  // 章の境界を持たないため、curriculum.jsonの構造をそのまま参照できる別変数が必要。
  let CURRICULUM = null;
  let CURRICULUM_CHECKPOINT = null;
  let GRAMMAR_EXTENSIONS = [];
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
    const stages = GRAMMAR_PATH.concat(
      CURRICULUM_CHECKPOINT ? [CURRICULUM_CHECKPOINT] : [],
      GRAMMAR_EXTENSIONS,
      READING_PATH,
      CULTURE_PATH,
    );
    return stages.flatMap(stage => stage.tasks);
  }

  /* ---------- progress (localStorage) ---------- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const progress = raw ? JSON.parse(raw) : {};
      if (migrateIdentificationPracticeProgress(progress)) {
        localStorage.setItem(STORE_KEY, JSON.stringify(progress));
      }
      return progress;
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
  function migrateIdentificationPracticeProgress(progress) {
    if (!progress || typeof progress !== "object") return false;
    const version = Number(progress.__identificationPracticeVersion) || 0;
    if (version >= IDENTIFICATION_PRACTICE_VERSION) return false;
    if (DATA && Array.isArray(DATA.practiceSets)) {
      DATA.practiceSets.forEach(set => {
        if (!set || !set.proceduresKey) return;
        (DATA[set.collection] || [])
          .filter(item => item.questionType === "integration")
          .forEach(item => { delete progress[set.id + ":" + itemId(item)]; });
      });
    }
    progress.__identificationPracticeVersion = IDENTIFICATION_PRACTICE_VERSION;
    return true;
  }
  function progressItemIds() {
    if (currentSet && (currentSet.proceduresKey || currentSet.requiredQuestionIdsKey)) return shikibetsuRequiredIds();
    return getItems().map(itemId);
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
    return progressItemIds().filter(id => (progressRecord(p, id) || {}).weak);
  }
  function masteredCount() {
    const p = loadProgress();
    return progressItemIds().filter(id => isMastered(progressRecord(p, id))).length;
  }
  function groupIdsForSet(g, set = currentSet) {
    const required = set && set.requiredQuestionIdsKey
      ? new Set(shikibetsuRequiredIds(set))
      : null;
    return required ? g.ids.filter(id => required.has(id)) : g.ids.slice();
  }
  function groupDoneCount(g, p, set = currentSet) {
    return groupIdsForSet(g, set).filter(id => isMastered(progressRecord(p, id))).length;
  }
  function sessionIdsForGroup(g, set = currentSet) {
    const ids = groupIdsForSet(g, set);
    return g.shuffle ? shuffle(ids) : ids;
  }

  /* ---------- 知識項目カバレッジ ---------- */
  // 手順型の知識は「手順確認・実践」に分けて出題する。
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
      const ids = groupIdsForSet(g);
      const done = ids.filter(id => isMastered(progressRecord(p, id))).length;
      if (done < ids.length) return { group: g, done, total: ids.length };
    }
    const last = groups[groups.length - 1];
    const lastIds = groupIdsForSet(last);
    const doneLast = lastIds.filter(id => isMastered(progressRecord(p, id))).length;
    if (doneLast < lastIds.length) return { group: last, done: doneLast, total: lastIds.length };
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
    const requiredIds = progressItemIds();
    const total = requiredIds.length;
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
          main: set.name + "：" + inc.group.name + "（" + inc.done + " / " + inc.total + "）",
          action: () => { currentSet = set; startSession(sessionIdsForGroup(inc.group, set), inc.group.name); },
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
          clearPreparationProgress();
          renderKatsuyoHome();
        }
      });
      actionsRow.appendChild(resetBtn);
      details.appendChild(actionsRow);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
  }

  /* ---------- 識別セクション：学習フロー（理解→実践） ---------- */
  function shikibetsuProcedures() {
    return DATA[currentSet.proceduresKey] || [];
  }
  // 必修ルートは、全問題（総仕上げ・追加練習を含む）から代表問題を選んだ集合で進める。
  // セットごとに必修IDのキーを持たせ、助動詞の設定が他の識別へ混ざらないようにする。
  // 必修IDが無い旧データでは、総仕上げグループを除く全問題へフォールバックする。
  function shikibetsuRequiredIds(set = currentSet) {
    const configuredKey = set && set.requiredQuestionIdsKey;
    const configured = configuredKey && DATA && DATA[configuredKey];
    if (Array.isArray(configured) && configured.length) return configured.slice();
    const groups = set && DATA ? (DATA[set.groups] || []) : [];
    return groups
      .filter(g => !String(g.id || "").endsWith("-all"))
      .flatMap(g => g.ids || []);
  }
  function shikibetsuRequiredIdSet(set = currentSet) {
    return new Set(shikibetsuRequiredIds(set));
  }
  function shikibetsuSupplementalIds(set = currentSet) {
    const required = shikibetsuRequiredIdSet(set);
    const items = set && DATA ? (DATA[set.collection] || []) : [];
    return items.map(itemId).filter(id => !required.has(id));
  }
  function shikibetsuGroupForProc(procId) {
    return getGroups().find(g => g.id === "sb-" + procId);
  }
  // allowedIds（省略可）を渡すと、そのprocedureの実践問題プールをallowedIdsだけに絞り込む。
  // カリキュラムの講が、1つのprocedureの実践プールを複数講に分割して割り当てる場合に使う
  // （例：h-nariの4問を31講「基本編」2問・32講「応用編」2問に分ける）。
  // allowedIds指定時は旧来のrequiredQuestionIds（グループ単位の代表問題セット）による
  // 絞り込みを経由しない。curriculum.json側で1問単位にどの講の必修に含めるかを既に
  // 確定しているため（例：hg-nari-int4はhomographRequiredQuestionIdsには無いが、
  // 32講の必修としてidsで明示されている＝curriculum.jsonが優先される）。
  // グループを解決できない場合（"sb-"+procId命名規約に一致しない等）は、
  // setのcollectionからintegration問題を直接拾うフォールバックを使う。
  function shikibetsuPracticeIds(procId, allowedIds) {
    const g = shikibetsuGroupForProc(procId);
    if (Array.isArray(allowedIds) && allowedIds.length) {
      // typoで無関係な問題が混入しないよう、グループ（無ければsetの全収集）の範囲内に絞る。
      const pool = new Set(g ? g.ids : getItems().map(itemId));
      return allowedIds.filter(id => pool.has(id) && (byId[itemKey(id)] || {}).questionType === "integration");
    }
    const required = shikibetsuRequiredIdSet();
    if (g) {
      return g.ids.filter(id => required.has(id) && (byId[itemKey(id)] || {}).questionType === "integration");
    }
    return getItems()
      .filter(item => item.questionType === "integration")
      .map(itemId)
      .filter(id => required.has(id));
  }
  // 「習得済み」（isMastered、累計2回正解）は苦手復習・進捗バー用の基準。
  // フローの完了判定はセッションを1周し終えた（1回でも正解した）ことだけを基準にする。
  // 各セッションは誤答をキュー末尾に再出題し続け、全問正解するまで終わらないため、
  // セッション完了＝そのステージの全問が最低1回は正解済み、と言える。
  function shikibetsuIdCleared(id, p) {
    const rec = progressRecord(p, id);
    return !!rec && rec.c >= 1;
  }
  function shikibetsuProcStatus(procId, allowedIds) {
    const p = loadProgress();
    const practiceIds = shikibetsuPracticeIds(procId, allowedIds);
    const practiceDone = practiceIds.filter(id => shikibetsuIdCleared(id, p)).length;
    return {
      practiceIds, practiceDone,
      complete: practiceIds.length > 0 && practiceDone === practiceIds.length,
    };
  }
  function firstIncompleteProcedure() {
    return shikibetsuProcedures().find(proc => !shikibetsuProcStatus(proc.id).complete) || null;
  }

  /* ---------- 文法ロードマップ（第1段階） ---------- */
  function loadPathState() {
    try {
      const raw = localStorage.getItem(PATH_STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function savePathState(state) {
    try { localStorage.setItem(PATH_STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function nowIso() {
    const injected = typeof window !== "undefined" && window.__KATSUYO_NOW__;
    return typeof injected === "string" ? injected : new Date().toISOString();
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
  // 46講版（lessonCycles）は、旧10必修版（grammarTaskCycles、上）とは別の器として持つ。
  // 旧フィールドは読み取り互換のため残すだけで、新規保存は行わない。
  function lessonCycles(state) {
    if (!state.lessonCycles || typeof state.lessonCycles !== "object") {
      state.lessonCycles = {};
    }
    return state.lessonCycles;
  }
  function lessonCycle(lessonId) {
    const state = loadPathState();
    const cycle = lessonCycles(state)[lessonId];
    return cycle && typeof cycle === "object" ? cycle : { completedAt: "", lastReviewedAt: "" };
  }
  // 冪等：既にcompletedAtが入っているlessonへは書き込まない（正誤回数・完了日時の増殖防止）。
  function markLessonCompleted(lessonId, completedAt = nowIso()) {
    const state = loadPathState();
    const cycles = lessonCycles(state);
    const existing = cycles[lessonId] && typeof cycles[lessonId] === "object" ? cycles[lessonId] : {};
    if (existing.completedAt) return false;
    cycles[lessonId] = Object.assign({ lastReviewedAt: "" }, existing, { completedAt });
    savePathState(state);
    return true;
  }
  function markLessonReviewed(lessonId, reviewedAt = nowIso()) {
    const state = loadPathState();
    const cycles = lessonCycles(state);
    const existing = cycles[lessonId] && typeof cycles[lessonId] === "object" ? cycles[lessonId] : {};
    cycles[lessonId] = Object.assign({ completedAt: "", lastReviewedAt: "" }, existing, { lastReviewedAt: reviewedAt });
    savePathState(state);
    return true;
  }
  function curriculumLessonById(lessonId) {
    if (!CURRICULUM || !Array.isArray(CURRICULUM.chapters)) return null;
    for (const chapter of CURRICULUM.chapters) {
      const lesson = (chapter.lessons || []).find(item => item.id === lessonId);
      if (lesson) return lesson;
    }
    return null;
  }
  function curriculumTaskById(taskId) {
    for (const stage of GRAMMAR_PATH) {
      const task = stage.tasks.find(item => item.id === taskId);
      if (task) return task;
    }
    return null;
  }
  // activity単位の終了処理。UIと回帰テストが同じ保存経路を通るようにする。
  function applyActivityCompletion(taskId, options = {}) {
    const task = curriculumTaskById(taskId);
    if (!task || !task.lessonId) return false;
    const lesson = curriculumLessonById(task.lessonId);
    if (!lesson) return false;
    const at = options.now || nowIso();
    if (options.review) {
      markLessonReviewed(lesson.id, at);
      return true;
    }
    if (!lessonStatus(lesson).complete) return false;
    return markLessonCompleted(lesson.id, at);
  }
  function saveCheckpointResult(taskDef, score, total) {
    const pathState = loadPathState();
    const checkpointKey = taskDef.checkpointKey || "grammarCheckpoint";
    pathState[checkpointKey] = {
      score,
      total,
      passed: score >= Math.ceil(total * 0.8),
    };
    savePathState(pathState);
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
    // カリキュラムのactivityがids（明示リスト）を持つ場合はgroup検索を省略してそのまま返す。
    // requiredQuestionIdsによる絞り込みは明示idsの場合は不要（既に確定した具体IDのため）。
    if (Array.isArray(task.ids)) return task.ids.slice();
    const group = taskGroup(task);
    const set = practiceSetById(task.setId);
    return group ? groupIdsForSet(group, set) : [];
  }
  // taskStatus()が実際に完了判定へ使う具体ID一覧を、kindに応じて返す（読み取り専用）。
  // procedure種別はtaskIds()ではなくshikibetsuPracticeIds()（procId基準）で解決するため、
  // taskStatus()と同じ分岐をここでも辿る。判定ロジック自体（isMastered等）は複製しない。
  // __testフック（fixture生成・回帰テスト用）からのみ使う想定。
  function taskCheckedIds(task) {
    if (task.kind === "checkpoint") return [];
    if (task.kind === "procedure") {
      const prev = currentSet;
      currentSet = practiceSetById(task.setId || "shikibetsu");
      const ids = shikibetsuPracticeIds(task.procId, task.ids);
      currentSet = prev;
      return ids;
    }
    return taskIds(task);
  }
  function isGrammarOnePassTask(task) {
    return task.kind === "group" && ["kiso", "yougo", "jodoshi", "choice"].includes(task.setId);
  }
  function setModeById(setId) {
    const set = practiceSetById(setId);
    return set ? setMode(set) : null;
  }
  function entriesToSetMap(entries) {
    const map = {};
    entries.forEach(e => { map[e.id] = e.setId; });
    return map;
  }
  function taskStatus(task) {
    if (task.kind === "procedure") {
      const prev = currentSet;
      currentSet = practiceSetById(task.setId || "shikibetsu");
      const status = shikibetsuProcStatus(task.procId, task.ids);
      currentSet = prev;
      return {
        done: status.practiceDone,
        total: status.practiceIds.length,
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
    if (!task.curriculumActivity && !isGrammarOnePassTask(task)) {
      const done = ids.filter(id => isMastered(progressRecord(p, id))).length;
      currentSet = prev;
      return { done, total: ids.length, complete: ids.length > 0 && done === ids.length };
    }
    const done = ids.filter(id => {
      const rec = progressRecord(p, id);
      return !!rec && rec.c >= 1;
    }).length;
    const complete = ids.length > 0 && done === ids.length;
    currentSet = prev;
    return {
      done,
      total: ids.length,
      complete: ids.length > 0 && complete,
      phase: complete ? "完了" : "通し"
    };
  }
  // 全段階の問題は、前段階の完了を待たずにアクセスできる。
  // ただし、各必修の完了判定とチェックポイントの合否は従来どおり維持する。
  function grammarPathStatus() {
    return GRAMMAR_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      return Object.assign({}, stage, { tasks, complete, available: true });
    });
  }
  function grammarLessonsComplete() {
    return GRAMMAR_PATH.length > 0 && GRAMMAR_PATH.every(stage => {
      const lesson = curriculumLessonById(stage.id);
      return !!lesson && lessonStatus(lesson).complete;
    });
  }
  function grammarCheckpointStatus() {
    return CURRICULUM_CHECKPOINT
      ? taskStatus(CURRICULUM_CHECKPOINT.task)
      : { done: 0, total: 0, complete: false };
  }
  function grammarCourseStatus() {
    const lessonsComplete = grammarLessonsComplete();
    const checkpoint = grammarCheckpointStatus();
    return {
      lessonsComplete,
      checkpoint,
      complete: lessonsComplete && checkpoint.complete,
    };
  }
  function readingPathStatus() {
    return READING_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      return Object.assign({}, stage, { tasks, complete, available: true });
    });
  }
  function culturePathStatus() {
    return CULTURE_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      return Object.assign({}, stage, { tasks, complete, available: true });
    });
  }

  /* ---------- 講・章単位の進捗集計（curriculum.json正本） ---------- */
  // 1講=1ステージという既存のGRAMMAR_PATH形状（buildGrammarPathFromCurriculum）をそのまま使い、
  // taskStatus()の判定結果を集計するだけ。完了判定ロジック自体は二重実装しない。
  function lessonStatus(lesson) {
    const stage = GRAMMAR_PATH.find(s => s.id === lesson.id);
    const tasks = stage ? stage.tasks : [];
    const statuses = tasks.map(taskStatus);
    const requiredCount = tasks.length;
    const doneCount = statuses.filter(s => s.complete).length;
    // 必修が0件（status:"blocked"の講）はvacuously completeにしない＝未完了として扱う。
    const complete = requiredCount > 0 && statuses.every(s => s.complete);
    return {
      lessonId: lesson.id,
      number: lesson.number,
      title: lesson.title,
      curriculumStatus: lesson.status,
      requiredCount,
      doneCount,
      complete,
    };
  }
  // taskの具体的id群のうち、苦手フラグ（rec.weak）が立っているものが1件でもあればtrue。
  // weakIds()と同じ「rec.weak」基準を、必修task単位（curriculum.jsonのrequiredActivities）に適用する。
  // id解決はtaskIds()ではなくtaskCheckedIds()を使う：kind==="procedure"のtask（ids未指定のもの、
  // 章3〜6の必修の大半）はgroupIdを持たずtaskIds()では[]になってしまうため、taskStatus()と
  // 同じ解決（shikibetsuPracticeIds経由）をするtaskCheckedIds()を再利用する。
  function taskHasWeakRecord(task) {
    if (task.kind === "checkpoint") return false;
    const set = practiceSetById(task.setId);
    if (!set) return false;
    const prev = currentSet;
    currentSet = set;
    const p = loadProgress();
    const ids = taskCheckedIds(task);
    const weak = ids.some(id => {
      const rec = progressRecord(p, id);
      return !!rec && rec.weak;
    });
    currentSet = prev;
    return weak;
  }
  function chapterStatus(chapter) {
    const lessons = chapter.lessons || [];
    const lessonStatuses = lessons.map(lessonStatus);
    const completedLessons = lessonStatuses.filter(s => s.complete).length;
    let weakCount = 0;
    lessons.forEach(lesson => {
      const stage = GRAMMAR_PATH.find(s => s.id === lesson.id);
      if (!stage) return;
      stage.tasks.forEach(task => { if (taskHasWeakRecord(task)) weakCount += 1; });
    });
    return {
      chapterId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      totalLessons: lessonStatuses.length,
      completedLessons,
      weakCount,
    };
  }
  // 46講のみを対象に、chapter.number昇順→lesson.number昇順で走査し、最初の未完了講を返す。
  // 発展学習（keigo）・文法混合確認（grammar-checkpoint）はcurriculum.chaptersに含まれないため対象外。
  function firstIncompleteLesson() {
    if (!CURRICULUM || !Array.isArray(CURRICULUM.chapters)) return null;
    const chapters = CURRICULUM.chapters.slice().sort((a, b) => a.number - b.number);
    for (const chapter of chapters) {
      const lessons = (chapter.lessons || []).slice().sort((a, b) => a.number - b.number);
      for (const lesson of lessons) {
        if (!lessonStatus(lesson).complete) return lesson;
      }
    }
    return null;
  }
  function firstIncompleteGrammarTask() {
    const stages = grammarPathStatus();
    for (const stage of stages) {
      if (!stage.available || stage.complete) continue;
      const task = stage.tasks.find(item => !item.status.complete);
      if (task) return { stage, task, lesson: curriculumLessonById(stage.id) };
    }
    if (grammarLessonsComplete() && CURRICULUM_CHECKPOINT) {
      const status = taskStatus(CURRICULUM_CHECKPOINT.task);
      if (!status.complete) return { stage: CURRICULUM_CHECKPOINT, task: CURRICULUM_CHECKPOINT.task, lesson: null };
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
  function grammarStageForLesson(lessonId) {
    return GRAMMAR_PATH.find(stage => stage.id === lessonId) || null;
  }
  function lessonActivityTasks(lessonId) {
    const stage = grammarStageForLesson(lessonId);
    return stage ? stage.tasks.slice() : [];
  }
  function lessonQueueEntries(lesson, review = false) {
    return lessonActivityTasks(lesson.id)
      .filter(task => review || !taskStatus(task).complete)
      .map(task => ({ task, review }));
  }
  function chapterQueueEntries(chapter) {
    return (chapter.lessons || []).flatMap(lesson => lessonQueueEntries(lesson, true));
  }
  function weakQueueEntries(lessons) {
    return lessons.flatMap(lesson => lessonActivityTasks(lesson.id).flatMap(task => {
      const set = practiceSetById(task.setId);
      if (!set || task.kind === "checkpoint") return [];
      const prev = currentSet;
      currentSet = set;
      const p = loadProgress();
      const weak = taskCheckedIds(task).filter(id => (progressRecord(p, id) || {}).weak);
      currentSet = prev;
      if (!weak.length) return [];
      return [{ task: Object.assign({}, task, { ids: weak }), review: true }];
    }));
  }
  function makeActivityQueue(type, entries, meta = {}) {
    return { type, entries, index: 0, ...meta };
  }
  // 文法混合確認の母集団。入口・章別の4択問題を混ぜる。
  // 除外するもの:
  //   - 活用表の行埋め（yougo/jodoshi）… 出題形式が違い、30問の確認には重すぎる
  //   - 実践問題（integration）… 文脈中の傍線部の意味を4択で答える
  function requiredGrammarEntries() {
    const entries = [];
    GRAMMAR_PATH.forEach(stage => stage.tasks.forEach(task => {
      if (task.kind === "group") {
        if (setModeById(task.setId) !== "choice") return;
        taskIds(task).forEach(id => entries.push({ id, setId: task.setId }));
      }
    }));
    const seen = new Set();
    return entries.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  }
  // 進捗カードの表示用（確認対象の問題数）
  function requiredChoiceIds() {
    return requiredGrammarEntries().map(e => e.id);
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
  function sourceEntriesForCheckpoint(task) {
    if (task.source === "reading") return requiredReadingIds().map(id => ({ id, setId: "keigo-dokkai" }));
    if (task.source === "culture") return requiredCultureIds().map(id => ({ id, setId: "kobun-joshiki" }));
    return requiredGrammarEntries();
  }
  // task（GRAMMAR_PATHの個々の必修活動）が属するstage（=lesson）を探し、
  // そのlessonのpreparation配列（1講に複数資料の可能性がある）を返す。
  // 予習資料が無い講（statusがblocked等でpreparationが空）はnullを返す。
  function preparationForTask(task) {
    if (!task) return null;
    const stage = GRAMMAR_PATH.find(item => item.tasks.some(candidate => candidate.id === task.id));
    if (!stage) return null;
    const preparation = Array.isArray(stage.preparation) ? stage.preparation : [];
    if (!preparation.length) return null;
    return { stage, preparation };
  }
  function openTaskPreparation(task, review = false, options = {}) {
    const prep = preparationForTask(task);
    if (!prep || typeof KobunPreparation === "undefined") return false;
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = task.id;
    activeGrammarPathReview = review;
    sessionPanel.classList.add("hide");
    sessionPanel.innerHTML = "";
    homePanel.classList.remove("hide");
    KobunPreparation.render({
      container: homePanel,
      task,
      stage: prep.stage,
      preparation: prep.preparation,
      onBack: renderGrammarRoadmapHome,
      onPractice: () => startRequiredTask(task, review, Object.assign({}, options, { skipPreparation: true })),
    });
    return true;
  }
  function startRequiredTask(task, review = false, options = {}) {
    if (!options.skipPreparation && !review && openTaskPreparation(task, review, options)) return;
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = task.id;
    activeGrammarPathReview = review;
    if (task.kind === "procedure") {
      currentSet = practiceSetById(task.setId || "shikibetsu");
      startShikibetsuFlow(task.procId, {
        pathTask: task.id,
        pathReview: review,
        allowedIds: task.ids,
        stepRange: task.stepRange,
        activityQueue: options.activityQueue,
      });
      return;
    }
    if (task.kind === "checkpoint") {
      const entries = shuffle(sourceEntriesForCheckpoint(task)).slice(0, task.sampleSize || 30);
      currentSet = practiceSetById(entries.length ? entries[0].setId : (task.sourceSetId || "choice"));
      startSession(entries.map(e => e.id), task.label, {
        pathTask: task.id,
        pathReview: review,
        setMap: entriesToSetMap(entries),
        activityQueue: options.activityQueue,
      });
      return;
    }
    const set = practiceSetById(task.setId);
    const ids = taskIds(task);
    currentSet = set;
    if (!task.curriculumActivity && !isGrammarOnePassTask(task)) {
      const p = loadProgress();
      const pending = review ? ids : ids.filter(id => !isMastered(progressRecord(p, id)));
      startSession(pending.length ? pending : ids, task.label, { pathTask: task.id, pathReview: review });
      return;
    }
    // 通し演習で、各問題を1回以上正解した時点で必修タスクを完了にする。
    // 正答記録は1問ごとに保存されるため、途中で離脱しても未正解だけ再開できる。
    const p = loadProgress();
    const pending = review
      ? ids
      : ids.filter(id => {
          const rec = progressRecord(p, id);
          return !(rec && rec.c >= 1);
        });
    startSession(pending.length ? pending : ids, task.label + "・通し演習", {
      pathTask: task.id,
      pathReview: review,
      pathPhase: "pass",
      requeueWrong: true,
      activityQueue: options.activityQueue,
    });
  }
  function startLesson(lesson, options = {}) {
    const target = typeof lesson === "string" ? curriculumLessonById(lesson) : lesson;
    if (!target) { renderGrammarRoadmapHome(); return; }
    const ownerChapter = (CURRICULUM && CURRICULUM.chapters || []).find(chapter =>
      (chapter.lessons || []).some(item => item.id === target.id));
    const chapterId = options.chapterId || (ownerChapter && ownerChapter.id);
    const entries = lessonQueueEntries(target, !!options.review);
    if (!entries.length) {
      if (options.review) {
        const queue = makeActivityQueue("lesson", [], {
          lessonId: target.id,
          chapterId,
          review: true,
        });
        renderQueuedDone(queue);
      } else {
        renderGrammarRoadmapHome();
      }
      return;
    }
    const queue = makeActivityQueue("lesson", entries, {
      lessonId: target.id,
      chapterId,
      review: !!options.review,
    });
    const first = entries[0];
    if (!options.skipPreparation && !options.review && openTaskPreparation(first.task, false, { activityQueue: queue })) return;
    startRequiredTask(first.task, first.review, { skipPreparation: true, activityQueue: queue });
  }
  function startChapterReview(chapter) {
    const target = typeof chapter === "string"
      ? (CURRICULUM && CURRICULUM.chapters || []).find(item => item.id === chapter)
      : chapter;
    if (!target) { renderGrammarRoadmapHome(); return; }
    const entries = chapterQueueEntries(target);
    if (!entries.length) { renderGrammarRoadmapHome(); return; }
    const queue = makeActivityQueue("chapter", entries, { chapterId: target.id, review: true });
    startRequiredTask(entries[0].task, true, { skipPreparation: true, activityQueue: queue });
  }
  function startWeakReview(scope = "all") {
    const chapters = (CURRICULUM && CURRICULUM.chapters) || [];
    const lessons = scope && scope !== "all"
      ? chapters.flatMap(chapter => chapter.id === scope ? chapter.lessons : [])
      : chapters.flatMap(chapter => chapter.lessons || []);
    const entries = weakQueueEntries(lessons);
    if (!entries.length) { renderGrammarRoadmapHome(); return; }
    const queue = makeActivityQueue("weak", entries, { scope, review: true });
    startRequiredTask(entries[0].task, true, { skipPreparation: true, activityQueue: queue });
  }
  function appendPathSection(title, stages, stats, hintText, lockText, collapsed, sectionId) {
    const progress = el("section", "card");
    if (sectionId) progress.id = sectionId;
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
        if (stage.available) {
          const taskActions = el("div", "pathTaskActions");
          const preparation = preparationForTask(task);
          if (preparation) {
            const prep = el("button", "ghost smallGhost pathTaskAction pathPrepAction", "予習");
            prep.type = "button";
            prep.title = "予習資料を読む";
            prep.setAttribute("aria-label", task.label + "の予習資料を読む");
            prep.addEventListener("click", () => openTaskPreparation(task, task.status.complete));
            taskActions.appendChild(prep);
          }
          const actionLabel = task.status.complete
            ? "復習する"
            : task.status.done > 0
              ? (task.kind === "checkpoint" ? "再挑戦する" : task.kind === "procedure" ? "学び直す" : "つづきから")
              : "演習する";
          const action = el("button", "ghost smallGhost pathTaskAction", actionLabel);
          action.type = "button";
          action.setAttribute("aria-label", task.label + "を" + actionLabel);
          action.addEventListener("click", () => startRequiredTask(task, task.status.complete, { skipPreparation: true }));
          taskActions.appendChild(action);
          row.appendChild(taskActions);
        }
        taskList.appendChild(row);
      });
      card.appendChild(taskList);

      if (!stage.available) {
        card.appendChild(el("p", "hint pathLockHint", lockText));
      }
      list.appendChild(card);
    });

    if (collapsed) {
      const wrap = el("section", "card");
      const details = document.createElement("details");
      details.className = "pathStagesDetails";
      const summary = document.createElement("summary");
      summary.className = "label";
      summary.textContent = title + "のタスク一覧を見る（" + completedStages + " / " + stages.length + " 完了）";
      details.appendChild(summary);
      details.appendChild(list);
      wrap.appendChild(details);
      homePanel.appendChild(wrap);
    } else {
      homePanel.appendChild(list);
    }
  }
  function renderGrammarCurriculumRoadmap(chapters, nextLesson) {
    const card = el("section", "card curriculumRoadmapCard");
    card.appendChild(el("span", "label", "TEXTBOOK ROADMAP"));
    card.appendChild(el("h2", null, "6章・46講の文法ロードマップ"));
    const allLessons = chapters.flatMap(chapter => chapter.lessons || []);
    const completed = allLessons.filter(lesson => lessonStatus(lesson).complete).length;
    const statGrid = el("div", "statGrid");
    [[String(completed), "/ 46", "LESSONS・講"], [String(chapters.length), "", "CHAPTERS・章"], [String(Math.max(0, allLessons.length - completed)), "", "REMAINING・残り"]]
      .forEach(([num, small, caption]) => {
        const cell = el("div", "statCell");
        const value = el("div", "statNum");
        value.appendChild(document.createTextNode(num));
        if (small) value.appendChild(el("small", null, small));
        cell.appendChild(value);
        cell.appendChild(el("div", "statCaption", caption));
        statGrid.appendChild(cell);
      });
    card.appendChild(statGrid);
    const progress = el("div", "masteryBar");
    progress.setAttribute("aria-label", "文法講の完了 " + completed + "/" + allLessons.length);
    const fill = el("div", "masteryFill");
    fill.style.width = (allLessons.length ? Math.round(completed / allLessons.length * 100) : 0) + "%";
    progress.appendChild(fill);
    card.appendChild(progress);

    const currentChapter = nextLesson
      ? chapters.find(chapter => (chapter.lessons || []).some(lesson => lesson.id === nextLesson.id))
      : null;
    const stepper = el("ol", "chapterStepper");
    chapters.forEach(chapter => {
      const item = el("li", "chapterStep" + (currentChapter && currentChapter.id === chapter.id ? " current" : ""));
      const jump = el("button", "chapterStepButton", "第" + chapter.number + "章");
      jump.type = "button";
      jump.setAttribute("aria-controls", "curriculum-chapter-" + chapter.number);
      if (currentChapter && currentChapter.id === chapter.id) jump.setAttribute("aria-current", "step");
      jump.addEventListener("click", () => {
        const target = document.getElementById("curriculum-chapter-" + chapter.number);
        if (target) {
          const details = target.querySelector("details");
          document.querySelectorAll(".chapterRoadmapCard details").forEach(item => { item.open = item === details; });
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      item.appendChild(jump);
      item.appendChild(el("span", "chapterStepLabel", chapter.title));
      stepper.appendChild(item);
    });
    card.appendChild(stepper);
    homePanel.appendChild(card);

    chapters.forEach(chapter => {
      const statuses = (chapter.lessons || []).map(lesson => ({ lesson, status: lessonStatus(lesson) }));
      const completedLessons = statuses.filter(item => item.status.complete).length;
      const chapterCard = el("section", "card chapterRoadmapCard" + (currentChapter && currentChapter.id === chapter.id ? " current" : ""));
      chapterCard.id = "curriculum-chapter-" + chapter.number;
      const head = el("div", "chapterRoadmapHead");
      const heading = el("div");
      heading.appendChild(el("span", "label", "CHAPTER " + chapter.number));
      heading.appendChild(el("h3", null, "第" + chapter.number + "章　" + chapter.title));
      heading.appendChild(el("p", "hint", completedLessons + " / " + statuses.length + "講 完了"));
      head.appendChild(heading);
      const chapterAction = el("button", "ghost smallGhost", "章を復習する");
      chapterAction.type = "button";
      chapterAction.disabled = completedLessons === 0;
      chapterAction.setAttribute("aria-label", "第" + chapter.number + "章を復習する");
      chapterAction.addEventListener("click", () => startChapterReview(chapter));
      head.appendChild(chapterAction);
      chapterCard.appendChild(head);

      const details = document.createElement("details");
      details.className = "chapterLessonsDetails";
      details.open = !currentChapter || currentChapter.id === chapter.id;
      const summary = document.createElement("summary");
      summary.textContent = "講の一覧を" + (details.open ? "閉じる" : "開く");
      details.addEventListener("toggle", () => {
        summary.textContent = "講の一覧を" + (details.open ? "閉じる" : "開く");
      });
      details.appendChild(summary);
      const lessonList = el("ol", "lessonRoadmapList");
      statuses.forEach(({ lesson, status }) => {
        const row = el("li", "lessonRoadmapRow" + (status.complete ? " done" : "") + (nextLesson && nextLesson.id === lesson.id ? " current" : ""));
        row.id = "curriculum-" + lesson.id;
        if (nextLesson && nextLesson.id === lesson.id) row.setAttribute("aria-current", "step");
        const marker = el("span", "lessonRoadmapMarker", status.complete ? "✓" : "" + lesson.number);
        marker.setAttribute("aria-label", status.complete ? "完了" : "未完了");
        row.appendChild(marker);
        const body = el("div", "lessonRoadmapBody");
        body.appendChild(el("span", "lessonRoadmapNumber", String(lesson.number).padStart(2, "0") + "講"));
        body.appendChild(el("h4", null, lesson.title));
        body.appendChild(el("p", "hint", "活動 " + status.doneCount + " / " + status.requiredCount + (status.complete ? "・完了" : "・未完了")));
        row.appendChild(body);
        const actions = el("div", "lessonRoadmapActions");
        const action = el("button", status.complete ? "ghost smallGhost" : "cta smallGhost", status.complete ? "復習する" : "この講を始める");
        action.type = "button";
        action.setAttribute("aria-label", lesson.number + "講「" + lesson.title + "」を" + (status.complete ? "復習する" : "始める"));
        action.addEventListener("click", () => startLesson(lesson, { review: status.complete, chapterId: chapter.id }));
        actions.appendChild(action);
        row.appendChild(actions);
        lessonList.appendChild(row);
      });
      details.appendChild(lessonList);
      chapterCard.appendChild(details);
      homePanel.appendChild(chapterCard);
    });
    const weakCount = weakQueueEntries(allLessons).length;
    if (weakCount) {
      const weakCard = el("section", "card weakRoadmapCard");
      weakCard.appendChild(el("span", "label", "REVIEW"));
      weakCard.appendChild(el("h2", null, "苦手をまとめて復習する"));
      weakCard.appendChild(el("p", "hint", "文法の必修活動から、苦手と記録された問題だけを順に出題します。"));
      const weakButton = el("button", "cta", "苦手" + weakCount + "活動を復習する");
      weakButton.type = "button";
      weakButton.addEventListener("click", () => startWeakReview("all"));
      weakCard.appendChild(weakButton);
      homePanel.appendChild(weakCard);
    }
  }
  function renderGrammarCheckpointCard() {
    if (!CURRICULUM_CHECKPOINT) return;
    const status = grammarCheckpointStatus();
    const card = el("section", "card checkpointRoadmapCard");
    card.appendChild(el("span", "label", "CHECKPOINT"));
    card.appendChild(el("h2", null, CURRICULUM_CHECKPOINT.label));
    card.appendChild(el("p", "hint", "46講とは別の仕上げ確認です。合否は講の完了数に含めません。"));
    card.appendChild(el("p", "procedureLearnStat", status.complete ? "合格済み" : "未実施・合格基準 24 / 30"));
    const action = el("button", status.complete ? "ghost" : "cta", status.complete ? "もう一度確認する" : "文法混合確認を始める");
    action.type = "button";
    action.addEventListener("click", () => startRequiredTask(CURRICULUM_CHECKPOINT.task, status.complete, { skipPreparation: true }));
    card.appendChild(action);
    homePanel.appendChild(card);
  }
  function renderGrammarExtensionCard() {
    if (!GRAMMAR_EXTENSIONS.length) return;
    const card = el("section", "card extensionRoadmapCard");
    card.appendChild(el("span", "label", "EXTENSIONS"));
    card.appendChild(el("h2", null, "発展学習"));
    card.appendChild(el("p", "hint", "発展学習は46講と文法checkpointの完了条件に含めません。"));
    GRAMMAR_EXTENSIONS.forEach(stage => {
      const block = el("div", "extensionRoadmapBlock");
      block.appendChild(el("h3", null, stage.label));
      block.appendChild(el("p", "hint", stage.description));
      stage.tasks.forEach(task => {
        const status = taskStatus(task);
        const row = el("div", "pathTaskRow" + (status.complete ? " done" : ""));
        row.appendChild(el("span", "pathTaskMark", status.complete ? "✓" : "□"));
        row.appendChild(el("span", "pathTaskLabel", task.label));
        row.appendChild(el("span", "pathTaskStat", status.done + "/" + status.total));
        const action = el("button", "ghost smallGhost pathTaskAction", status.complete ? "復習する" : "演習する");
        action.type = "button";
        action.addEventListener("click", () => startRequiredTask(task, status.complete, { skipPreparation: true }));
        row.appendChild(action);
        block.appendChild(row);
      });
      card.appendChild(block);
    });
    homePanel.appendChild(card);
  }
  function renderGrammarRoadmapHome() {
    flow = null;
    session = null;
    currentSet = null;
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = null;
    activeGrammarPathReview = false;
    sessionPanel.classList.add("hide");
    sessionPanel.innerHTML = "";
    homePanel.classList.remove("hide");
    homePanel.innerHTML = "";

    const grammarStages = grammarPathStatus();
    const grammarStatus = grammarCourseStatus();
    const grammarComplete = grammarStatus.complete;
    const readingStages = readingPathStatus();
    const readingComplete = readingStages.every(stage => stage.complete);
    const cultureStages = culturePathStatus();
    const cultureComplete = cultureStages.every(stage => stage.complete);
    const sharedMode = !!(cloud && cloud.isEnabled());
    const nextLesson = firstIncompleteLesson();
    const next = !grammarComplete
      ? (nextLesson ? { lesson: nextLesson } : firstIncompleteGrammarTask())
      : !readingComplete
        ? firstIncompleteReadingTask()
        : firstIncompleteCultureTask();
    const hero = el("section", "card hero");
    hero.appendChild(el("span", "label", !grammarComplete
      ? "TEXTBOOK / 6 CHAPTERS・46 LESSONS"
      : !readingComplete
        ? "STAGE 2 / KEIGO READING"
        : "STAGE 3 / CLASSICAL CULTURE"));
    hero.appendChild(el("h2", null, !grammarComplete
      ? (nextLesson ? "次は第" + nextLesson.number + "講を進める" : next ? "文法checkpointを確認する" : "第1段階の文法を完了しました")
      : !readingComplete
        ? (next ? "次は" + next.task.label + "を進める" : "第2段階の敬語読解を完了しました")
        : (next ? "次は" + next.task.label + "を進める" : "第3段階の古文常識を完了しました")));
    if (next) {
      const primary = el("button", "cta primaryCta", "");
      primary.type = "button";
      primary.appendChild(el("span", "ctaTag", nextLesson ? "次にやること" : "仕上げ確認"));
      primary.appendChild(el("span", "ctaMain", nextLesson ? nextLesson.number + "講　" + nextLesson.title : next.task.label));
      primary.addEventListener("click", () => nextLesson
        ? startLesson(nextLesson, { chapterId: nextLesson.chapterId })
        : startRequiredTask(next.task));
      hero.appendChild(primary);
    }
    hero.appendChild(el("p", "hint", next
      ? (!grammarComplete
        ? "講を順に進めます。講の中では予習を確認してから、必要な活動を一つの流れで行います。"
        : !readingComplete
          ? "敬意の方向 → 省略主語 → 短文統合の順で、敬語を主語判別に使います。"
          : "宮廷生活 → 恋愛・婚姻 → 年中行事の順で、文法だけでは埋まらない行間を読みます。")
      : (cultureComplete
        ? "現在の必修範囲はここまでです。復習は下の完了済み項目から行えます。"
        : readingComplete
          ? "第3段階（古文常識）の次の必修を選べる状態です。復習は下の完了済み項目から行えます。"
          : "第2段階（敬語読解）の次の必修を選べる状態です。復習は下の完了済み項目から行えます。")));
    homePanel.appendChild(hero);

    const grammarCurrent = !grammarComplete;
    const readingCurrent = grammarComplete && !readingComplete;
    const cultureCurrent = grammarComplete && readingComplete && !cultureComplete;
    renderGrammarCurriculumRoadmap((CURRICULUM && CURRICULUM.chapters) || [], nextLesson);
    renderGrammarCheckpointCard();
    renderGrammarExtensionCard();

    const readingCompleted = readingStages.filter(stage => stage.complete).length;
    appendPathSection("第2段階", readingStages,
      [[String(readingCompleted), "/ " + readingStages.length, "COMPLETE・完了"], [String(readingStages.length - readingCompleted), "", "REMAINING・残り"], [String(requiredReadingIds().length), "", "敬語読解の確認"]],
      "敬語読解は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第1段階の文法を完了すると解放されます。",
      !readingCurrent,
      "readingStage");
    const cultureCompleted = cultureStages.filter(stage => stage.complete).length;
    appendPathSection("第3段階", cultureStages,
      [[String(cultureCompleted), "/ " + cultureStages.length, "COMPLETE・完了"], [String(cultureStages.length - cultureCompleted), "", "REMAINING・残り"], [String(requiredCultureIds().length), "", "古文常識の確認"]],
      "古文常識は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第2段階の敬語読解を完了すると解放されます。",
      !cultureCurrent,
      "cultureStage");
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
          clearPreparationProgress();
          renderGrammarRoadmapHome();
        }
      });
      actions.appendChild(reset);
      details.appendChild(actions);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
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
    const changed = migrateIdentificationPracticeProgress(p);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) {}
    if (changed && cloud) cloud.queueSave();
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

    const requiredIds = progressItemIds();
    const total = requiredIds.length;
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
          tag: "必修総仕上げ",
          main: total + currentSet.unit + "をランダム出題",
          action: () => startSession(shuffle(requiredIds), "必修総仕上げ"),
        };
      }
    } else {
      const inc = firstIncompleteGroup();
      if (inc) {
        primary = {
          tag: "つづきから",
          main: inc.group.name + "（" + inc.done + " / " + inc.total + "）",
          action: () => startSession(sessionIdsForGroup(inc.group, currentSet), inc.group.name),
        };
      } else if (total > 0) {
        primary = {
          tag: currentSet.requiredQuestionIdsKey ? "必修総仕上げ" : "総仕上げ",
          main: total + currentSet.unit + "をランダム出題",
          action: () => startSession(shuffle(requiredIds), currentSet.requiredQuestionIdsKey ? "必修総仕上げ" : "総仕上げ"),
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

    if (currentSet.proceduresKey || currentSet.requiredQuestionIdsKey) {
      if (currentSet.proceduresKey) renderProcedureStepsCard();
      renderSupplementalPracticeCard(currentSet);
    }

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
        const ids = groupIdsForSet(g, currentSet);
        const done = groupDoneCount(g, p, currentSet);
        btn.appendChild(el("span", "groupName", g.name));
        btn.appendChild(el("span", "groupSub", g.sub));
        btn.appendChild(el("span", "groupStat", "習得 " + done + " / " + ids.length));
        btn.addEventListener("click", () => startSession(sessionIdsForGroup(g, currentSet), g.name));
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
          clearPreparationProgress();
          renderHome();
        }
      });
      actionsRow.appendChild(resetBtn);
      details.appendChild(actionsRow);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
  }

  // 識別セクション専用：手順ごとに「学習する」ボタン（実践問題の開始）と
  // 実践の習得状況、手順本文（手順I〜IV）の折りたたみ確認を並べたカード。
  function renderProcedureStepsCard() {
    const procedures = shikibetsuProcedures();
    if (!procedures.length) return;
    const card = el("section", "card");
    card.appendChild(el("span", "label", "手順を学習する"));
    card.appendChild(el("p", "hint", "手順は予習資料で確認し、ここでは実践問題（傍線部の意味）に取り組みます。演習中も手順を参照できます。"));
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
        "実践 完了 " + status.practiceDone + " / " + status.practiceIds.length));

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

  // 必修ルートから外した問題は削除せず、完了条件に含めない追加練習として残す。
  function renderSupplementalPracticeCard(targetSet = currentSet) {
    const prev = currentSet;
    const set = targetSet || practiceSetById("shikibetsu");
    if (!set) return;
    currentSet = set;
    const ids = shikibetsuSupplementalIds();
    if (!ids.length) {
      currentSet = prev;
      return;
    }
    const p = loadProgress();
    const mastered = ids.filter(id => isMastered(progressRecord(p, id))).length;
    const weak = ids.filter(id => (progressRecord(p, id) || {}).weak).length;
    const card = el("section", "card");
    card.appendChild(el("span", "label", "追加練習"));
    card.appendChild(el("p", "hint", "必修ルート外の" + ids.length + "問です。文法の完了条件には含めず、必要なときだけ練習できます。"));
    card.appendChild(el("p", "procedureLearnStat", "習得 " + mastered + " / " + ids.length + (weak ? "　苦手 " + weak : "")));
    const actions = el("div", "actions");
    const startBtn = el("button", "ghost", "追加練習を始める");
    startBtn.type = "button";
    startBtn.addEventListener("click", () => {
      currentSet = set;
      activeGrammarPathTask = null;
      startSession(shuffle(ids), "追加練習（" + ids.length + "問）");
    });
    actions.appendChild(startBtn);
    card.appendChild(actions);
    homePanel.appendChild(card);
    currentSet = prev;
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
      integrationQuestionId: null,
      integrationStep: 0,
      integrationAllOk: true,
      requeueWrong: !(opts && opts.requeueWrong === false),
      flow: (opts && opts.flow) || null, // 識別の学習フロー内で開始されたセッションかどうか
      pathTask: (opts && opts.pathTask) || activeGrammarPathTask,
      pathReview: opts && Object.prototype.hasOwnProperty.call(opts, "pathReview")
        ? !!opts.pathReview
        : activeGrammarPathReview,
      pathPhase: (opts && opts.pathPhase) || null,
      activityQueue: (opts && opts.activityQueue) || null,
      // 混合確認は複数の練習セットから出題するため、問題ごとに所属セットを持たせる。
      // 問題IDは全セットで接頭辞が異なるので、フラットな id→setId の対応で衝突しない。
      setMap: (opts && opts.setMap) || null,
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

  // 識別セクションの学習フロー：手順本文は予習資料（data/preparation/）に一本化したため、
  // フロー開始と同時に実践問題（傍線部の意味）へ入る。手順本文は実践中の参照カードで確認する。
  function startShikibetsuFlow(procId, pathContext = {}) {
    const proc = shikibetsuProcedures().find(pr => pr.id === procId);
    if (!proc) { goHome(); return; }
    flow = {
      procId,
      pathTask: pathContext.pathTask || activeGrammarPathTask,
      pathReview: !!pathContext.pathReview,
      allowedIds: pathContext.allowedIds || null,
      stepRange: pathContext.stepRange || null,
      activityQueue: pathContext.activityQueue || null,
    };
    startShikibetsuPractice();
  }

  function startShikibetsuPractice() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    startSession(shikibetsuPracticeIds(flow.procId, flow.allowedIds), proc.name + "・実践問題", {
      flow: Object.assign({}, flow),
      pathTask: flow.pathTask,
      pathReview: flow.pathReview,
      activityQueue: flow.activityQueue,
    });
  }

  function queuedTaskIsLessonBoundary(taskDef) {
    const queue = session && session.activityQueue;
    if (!queue) return true;
    const next = queue.entries[queue.index + 1];
    return !next || next.task.lessonId !== taskDef.lessonId;
  }
  function completeQueuedActivity(taskDef) {
    if (!taskDef || !taskDef.curriculumActivity || !queuedTaskIsLessonBoundary(taskDef)) return;
    applyActivityCompletion(taskDef.id, { review: session.pathReview });
  }
  function startNextQueuedActivity() {
    const queue = session && session.activityQueue;
    if (!queue || queue.index + 1 >= queue.entries.length) return false;
    queue.index += 1;
    const entry = queue.entries[queue.index];
    startRequiredTask(entry.task, entry.review, { skipPreparation: true, activityQueue: queue });
    return true;
  }
  function renderQueueTransition(taskDef) {
    const queue = session.activityQueue;
    const nextEntry = queue.entries[queue.index + 1];
    sessionPanel.innerHTML = "";
    const card = el("section", "card activityQueueCard");
    card.appendChild(el("span", "label", queue.type === "chapter" ? "章の復習" : "講の進行"));
    card.appendChild(el("h2", null, taskDef.label + "を完了"));
    card.appendChild(el("p", "resultText", "次の活動も同じ流れで続けます。"));
    const actions = el("div", "actions");
    const next = el("button", "cta", "次へ：" + nextEntry.task.label);
    next.type = "button";
    next.addEventListener("click", startNextQueuedActivity);
    actions.appendChild(next);
    const roadmap = el("button", "ghost smallGhost", "ロードマップへ戻る");
    roadmap.type = "button";
    roadmap.addEventListener("click", renderGrammarRoadmapHome);
    actions.appendChild(roadmap);
    card.appendChild(actions);
    sessionPanel.appendChild(card);
    next.focus();
  }
  function renderQueuedDone(queue) {
    sessionPanel.innerHTML = "";
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    const card = el("section", "card activityQueueCard");
    const label = queue.type === "chapter" ? "章の復習完了" : queue.type === "weak" ? "苦手復習完了" : "講の完了";
    card.appendChild(el("span", "label", label));
    let title = "復習が終わりました。";
    let lesson = null;
    let chapter = null;
    if (queue.lessonId) {
      lesson = curriculumLessonById(queue.lessonId);
      title = lesson ? lesson.number + "講「" + lesson.title + "」を完了しました。" : title;
    }
    if (queue.chapterId && CURRICULUM) chapter = CURRICULUM.chapters.find(item => item.id === queue.chapterId) || null;
    if (queue.type === "chapter" && chapter) title = chapter.number + "章「" + chapter.title + "」の復習が終わりました。";
    card.appendChild(el("p", "resultText", title));
    const actions = el("div", "actions");
    const roadmap = el("button", "cta", "学習ロードマップへ戻る");
    roadmap.type = "button";
    roadmap.addEventListener("click", renderGrammarRoadmapHome);
    actions.appendChild(roadmap);
    if (lesson) {
      const again = el("button", "ghost", "この講をもう一度");
      again.type = "button";
      again.addEventListener("click", () => startLesson(lesson, { review: true, chapterId: queue.chapterId }));
      actions.appendChild(again);
      if (chapter) {
        const chapterAgain = el("button", "ghost", "この章を復習する");
        chapterAgain.type = "button";
        chapterAgain.addEventListener("click", () => startChapterReview(chapter));
        actions.appendChild(chapterAgain);
      }
    }
    const weak = el("button", "ghost", "文法の苦手を復習する");
    weak.type = "button";
    weak.addEventListener("click", () => startWeakReview("all"));
    actions.appendChild(weak);
    card.appendChild(actions);
    sessionPanel.appendChild(card);
  }

  // フロー内の実践セッションが完了したときの分岐。
  function renderFlowDone() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    const pathTaskDef = session.pathTask ? allPathTasks().find(task => task.id === session.pathTask) : null;
    if (pathTaskDef) {
      completeQueuedActivity(pathTaskDef);
      if (session.activityQueue && !queuedTaskIsLessonBoundary(pathTaskDef)) {
        renderQueueTransition(pathTaskDef);
        return;
      }
      if (session.activityQueue) {
        renderQueuedDone(session.activityQueue);
        return;
      }
    }
    const card = el("section", "card");
    card.appendChild(el("span", "label", session.pathReview ? "復習完了" : "Next"));

    const actions = el("div", "actions");
    if (session.pathReview) {
      card.appendChild(el("p", "resultText", proc.name + "の復習が終わりました。進捗は保存されています。"));
      const roadmap = el("button", "cta", "学習ロードマップへ戻る");
      roadmap.type = "button";
      roadmap.addEventListener("click", renderGrammarRoadmapHome);
      actions.appendChild(roadmap);
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

  // 3つの出題UI（活用ドリル・4択・実践4択）で共通のヘッダー＋進捗バー。
  function renderSessionChrome() {
    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, session.title));
    info.appendChild(el("span", null, "残り " + session.queue.length));
    head.appendChild(info);
     const exitGroup = el("div", "sessionExitGroup");
     const quit = el("button", "ghost smallGhost", "演習を中断");
     quit.addEventListener("click", goHome);
     exitGroup.appendChild(quit);
     exitGroup.appendChild(el("span", "sessionSaveHint", "進捗は保存されます"));
     head.appendChild(exitGroup);
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

  // 複数セット混在セッションでは、次の問題が属する練習セットへ currentSet を切り替える。
  // itemKey / byId / recordResult はいずれも currentSet を見るので、ここで揃えれば以降の処理は変わらない。
  function syncSetForCurrentQuestion() {
    if (!session || !session.setMap || !session.queue.length) return;
    const setId = session.setMap[session.queue[0]];
    if (setId) {
      const set = practiceSetById(setId);
      if (set) currentSet = set;
    }
  }

  function renderRow() {
    sessionPanel.innerHTML = "";
    if (session.queue.length === 0) { renderDone(); return; }
    syncSetForCurrentQuestion();
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

  function highlightedPassage(q) {
    const passage = String(q.passage || "");
    const fallbackStart = q.target ? passage.indexOf(q.target) : -1;
    const ranges = (Array.isArray(q.targetRanges) && q.targetRanges.length
      ? q.targetRanges
      : (fallbackStart >= 0 ? [{ start: fallbackStart, text: q.target }] : []))
      .map(range => ({
        start: Number(range.start),
        text: String(range.text || ""),
      }))
      .filter(range => Number.isInteger(range.start) && range.start >= 0 && range.text.length > 0)
      .sort((a, b) => a.start - b.start);
    const line = el("p", "gradeChoiceQuestion stepPassage");
    let cursor = 0;
    ranges.forEach(range => {
      if (range.start < cursor || range.start > passage.length) return;
      const end = range.start + range.text.length;
      if (end > passage.length || passage.slice(range.start, end) !== range.text) return;
      line.appendChild(document.createTextNode(passage.slice(cursor, range.start)));
      line.appendChild(el("span", "targetWord", range.text));
      cursor = end;
    });
    line.appendChild(document.createTextNode(passage.slice(cursor)));
    return line;
  }

  // 敬語読解・古文常識の統合問題は、本文1つに3つの確認設問を持つ。
  // 進捗上は本文を1問として扱い、3設問をすべて終えてから結果を保存する。
  function renderIntegrationRow(q) {
    const id = itemId(q);
    if (session.integrationQuestionId !== id) {
      session.integrationQuestionId = id;
      session.integrationStep = 0;
      session.integrationAllOk = true;
    }
    const stepIndex = Math.min(Math.max(session.integrationStep || 0, 0), q.steps.length - 1);
    const step = q.steps[stepIndex];

    renderSessionChrome();

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", choiceQuestionLabel(q)));
    wc.appendChild(highlightedPassage(q));
    wc.appendChild(el("p", "gradeChoiceQuestion", step.prompt));
    top.appendChild(wc);
    box.appendChild(top);
    box.appendChild(el("p", "cardCounter", "設問 " + (stepIndex + 1) + " / " + q.steps.length));

    const choices = el("div", "gradeChoiceList");
    const buttons = [];
    const choiceOptions = shuffle(step.choices.map((text, originalIndex) => ({ text, originalIndex })));

    function selectAndGrade(idx) {
      if (session.answered || !choiceOptions[idx]) return;
      gradeIntegrationStep(q, step, choiceOptions[idx].originalIndex, buttons, choiceOptions, box, stepIndex);
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

  function gradeIntegrationStep(q, step, chosen, buttons, choiceOptions, box, stepIndex) {
    const stepOk = chosen === step.answerIndex;
    session.answered = true;
    if (!stepOk) session.integrationAllOk = false;

    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      const originalIndex = choiceOptions[idx].originalIndex;
      const text = btn.querySelector(".gradeChoiceText");
      if (originalIndex === step.answerIndex) {
        btn.classList.add("correct");
        text.appendChild(el("span", "gradeChoiceIcon", "✓"));
      } else if (originalIndex === chosen) {
        btn.classList.add("wrong");
        text.appendChild(el("span", "gradeChoiceIcon", "✗"));
      }
    });

    const feedback = el("div", "feedback " + (stepOk ? "ok" : "ng"));
    feedback.appendChild(el("h3", null, stepOk ? "正解" : "不正解"));
    addAnswer(feedback, "正解", step.choices[step.answerIndex]);
    addAnswer(feedback, "解説", step.explanation || q.explanation);

    const hasNextStep = stepIndex + 1 < q.steps.length;
    if (hasNextStep) {
      const nextRow = el("div", "nextRow");
      const next = el("button", "cta", "次の設問へ");
      next.id = "katsuyoNextBtn";
      next.addEventListener("click", () => {
        session.integrationStep = stepIndex + 1;
        renderNextQuestion();
      });
      nextRow.appendChild(next);
      feedback.appendChild(nextRow);
      box.appendChild(feedback);
      next.focus();
      return;
    }

    const allOk = session.integrationAllOk;
    addAnswer(feedback, "この問題の判定", allOk
      ? "3つの設問をすべて正解しました。"
      : "3つの設問のうち誤答があったため、復習対象です。");
    box.appendChild(feedback);

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
    session.integrationQuestionId = null;
    session.integrationStep = 0;
    session.integrationAllOk = true;

    const nextRow = el("div", "nextRow");
    const next = el("button", "cta", session.queue.length ? "次の問題へ" : "結果を見る");
    next.id = "katsuyoNextBtn";
    next.addEventListener("click", renderNextQuestion);
    nextRow.appendChild(next);
    box.appendChild(nextRow);
    next.focus();
  }

  // 実践中に識別手順を参照するためのカード。手順本文を「1手順ずつ＋前後移動」で確認する
  // 唯一の演習内UI（予習資料が事前学習を担う）。参照位置は session.flow.refIdx に保持し、
  // 採点・次の問題への遷移をまたいでも参照中の手順が保たれるようにする。
  function renderProcedureReferenceBox(proc) {
    const box = el("div", "drillBox procedureRefBox");
    function paint() {
      box.innerHTML = "";
      const range = Array.isArray(session.flow.stepRange) && session.flow.stepRange.length === 2
        ? [Math.max(0, session.flow.stepRange[0]), Math.min(proc.steps.length - 1, session.flow.stepRange[1])]
        : [0, proc.steps.length - 1];
      const steps = proc.steps;
      const idx = Math.min(Math.max(session.flow.refIdx == null ? range[0] : session.flow.refIdx, range[0]), range[1]);
      session.flow.refIdx = idx;
      const step = steps[idx];

      box.appendChild(el("p", "askLabel", "識別方法を確認する・" + proc.name));
      const stepBox = el("div", "procedureRefStep");
      stepBox.appendChild(el("span", "procedureStepNo", step.no));
      stepBox.appendChild(el("p", "procedureRefStepText", step.text));
      box.appendChild(stepBox);

      const nav = el("div", "actions");
      const prevBtn = el("button", "ghost smallGhost", "← 前の手順");
      prevBtn.type = "button";
      if (idx === range[0]) prevBtn.disabled = true;
      prevBtn.addEventListener("click", () => { session.flow.refIdx = idx - 1; paint(); });
      nav.appendChild(prevBtn);
      const nextBtn = el("button", "ghost smallGhost", "次の手順 →");
      nextBtn.type = "button";
      if (idx === range[1]) nextBtn.disabled = true;
      nextBtn.addEventListener("click", () => { session.flow.refIdx = idx + 1; paint(); });
      nav.appendChild(nextBtn);
      box.appendChild(nav);
      box.appendChild(el("p", "cardCounter", "手順 " + (idx - range[0] + 1) + " / " + (range[1] - range[0] + 1)));
    }
    paint();
    return box;
  }

  function renderChoiceRow() {
    const id = session.queue[0];
    const q = byId[itemKey(id)];

    if (q.questionType === "integration" && Array.isArray(q.steps) && q.steps.length) {
      renderIntegrationRow(q);
      return;
    }

    renderSessionChrome();

    if (session.flow && currentSet.proceduresKey) {
      const proc = shikibetsuProcedures().find(pr => pr.id === session.flow.procId);
      if (proc) sessionPanel.appendChild(renderProcedureReferenceBox(proc));
    }

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", choiceQuestionLabel(q)));
    if (q.questionType === "integration") wc.appendChild(highlightedPassage(q));
    wc.appendChild(el("p", "gradeChoiceQuestion", q.question));
    top.appendChild(wc);
    box.appendChild(top);

    if (q.questionType === "multi-select") {
      renderMultiSelectChoices(q, box);
      sessionPanel.appendChild(box);
      return;
    }

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

  // 「所属語をすべて選べ」のような複数正解の選択式問題。
  // トグルチップで複数選び、「決定する」ボタンで確定してから採点する（単一選択の即時採点とは異なる）。
  function renderMultiSelectChoices(q, box) {
    const chosen = new Set();
    const chips = [];
    const wrap = el("div", "optionWrap");
    const choiceOptions = shuffle(q.choices.map((text, originalIndex) => ({ text, originalIndex })));

    choiceOptions.forEach(opt => {
      const chip = el("button", "optionChip", opt.text);
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (session.answered) return;
        const on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", on ? "false" : "true");
        if (on) chosen.delete(opt.originalIndex); else chosen.add(opt.originalIndex);
      });
      chips.push(chip);
      wrap.appendChild(chip);
    });
    box.appendChild(wrap);

    const submitRow = el("div", "submitRow");
    const submit = el("button", "cta", "決定する");
    submit.addEventListener("click", () => gradeMultiSelectChoiceRow(q, chosen, chips, choiceOptions, box, submit));
    submitRow.appendChild(submit);
    box.appendChild(submitRow);
  }

  function gradeMultiSelectChoiceRow(q, chosenIndices, chips, choiceOptions, box, submit) {
    if (session.answered) return;
    session.answered = true;
    submit.disabled = true;

    const correctSet = new Set(q.answerIndices);
    const allOk = chosenIndices.size === correctSet.size &&
      Array.from(chosenIndices).every(i => correctSet.has(i));

    chips.forEach(chip => { chip.disabled = true; });
    markChips(chips, q.answerIndices.map(i => q.choices[i]), Array.from(chosenIndices).map(i => q.choices[i]));

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
    addAnswer(fb, "正解", q.answerIndices.map(i => q.choices[i]).join("・"));
    if (!allOk && q.distractorRationale) {
      Array.from(chosenIndices)
        .filter(i => !correctSet.has(i))
        .forEach(i => {
          const why = q.distractorRationale[q.choices[i]];
          if (why) addAnswer(fb, "誤答の理由", why);
        });
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
      const text = btn.querySelector(".gradeChoiceText");
      if (originalIndex === q.answerIndex) {
        btn.classList.add("correct");
        text.appendChild(el("span", "gradeChoiceIcon", "✓"));
      } else if (originalIndex === chosen) {
        btn.classList.add("wrong");
        text.appendChild(el("span", "gradeChoiceIcon", "✗"));
      }
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
      if (isCorrect && isChosen) {
        chip.classList.add("correct");
        chip.appendChild(el("span", "optionChipIcon", "✓"));
      } else if (!isCorrect && isChosen) {
        chip.classList.add("wrong");
        chip.appendChild(el("span", "optionChipIcon", "✗"));
      } else if (isCorrect && !isChosen) {
        chip.classList.add("missed");
      }
    });
  }

  function renderPathPassDone(taskDef) {
    if (taskDef.curriculumActivity) {
      completeQueuedActivity(taskDef);
      if (session.activityQueue && !queuedTaskIsLessonBoundary(taskDef)) {
        renderQueueTransition(taskDef);
        return;
      }
      if (session.activityQueue) {
        renderQueuedDone(session.activityQueue);
        return;
      }
    }
    sessionPanel.innerHTML = "";
    const score = session.firstTryOk;
    const total = session.total;
    const pct = total ? Math.round((score / total) * 100) : 0;
    const banner = el("div", "doneBanner");
    banner.appendChild(el("p", "label", session.pathReview ? "小項目の復習 完了" : "通し演習 完了"));
    banner.querySelector(".label").style.color = "rgba(255,255,255,.72)";
    banner.appendChild(el("div", "big", score + " / " + total));
    banner.appendChild(el("div", "sub", "正答率 " + pct + "%"));
    sessionPanel.appendChild(banner);

    const card = el("section", "card");
    card.appendChild(el("span", "label", session.pathReview ? "復習完了" : "Next"));
    card.appendChild(el("p", "resultText", session.pathReview
      ? taskDef.label + "の復習が終わりました。進捗は保存されています。"
      : taskDef.label + "を完了しました。"));
    const actions = el("div", "actions");
    if (session.pathReview) {
      const roadmap = el("button", "cta", "学習ロードマップへ戻る");
      roadmap.type = "button";
      roadmap.addEventListener("click", renderGrammarRoadmapHome);
      actions.appendChild(roadmap);
    } else {
      const nextTask = firstIncompleteRequiredTask();
      if (nextTask) {
        const next = el("button", "cta", "次の必修へ（" + nextTask.task.label + "） →");
        next.type = "button";
        next.addEventListener("click", () => startRequiredTask(nextTask.task));
        actions.appendChild(next);
      } else {
        const roadmap = el("button", "cta", "学習ロードマップを見る");
        roadmap.type = "button";
        roadmap.addEventListener("click", renderGrammarRoadmapHome);
        actions.appendChild(roadmap);
      }
    }
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
    if (pathTaskDef && pathTaskDef.kind === "checkpoint" && !session.pathReview) {
      saveCheckpointResult(pathTaskDef, score, total);
    }

    const banner = el("div", "doneBanner");
    banner.appendChild(el("p", "label", session.pathReview ? "小項目の復習 完了" : "Session Complete"));
    banner.querySelector(".label").style.color = "rgba(255,255,255,.72)";
    banner.appendChild(el("div", "big", score + " / " + total));
    banner.appendChild(el("div", "sub", "正答率 " + pct + "%"));
    sessionPanel.appendChild(banner);

    if (session.flow) { renderFlowDone(); return; }

    const card = el("section", "card");
    card.appendChild(el("span", "label", session.pathReview ? "復習完了" : "Next"));
    const wrongCount = session.wrongNos.size;
    const wrongResult = wrongCount
      ? (session.requeueWrong ? "誤答はすべて解き直し済みです。" : "誤答は復習に記録されています。")
      : "";
    if (session.pathTask) {
      if (session.pathReview) {
        card.appendChild(el("p", "resultText", pathTaskDef
          ? pathTaskDef.label + "の復習が終わりました。進捗は保存されています。" + wrongResult
          : "小項目の復習が終わりました。進捗は保存されています。" + wrongResult));
        const reviewActions = el("div", "actions");
        const roadmapBtn = el("button", "cta", "学習ロードマップへ戻る");
        roadmapBtn.type = "button";
        roadmapBtn.addEventListener("click", renderGrammarRoadmapHome);
        reviewActions.appendChild(roadmapBtn);
        const homeBtn = el("button", "ghost smallGhost", "ホームに戻る");
        homeBtn.type = "button";
        homeBtn.addEventListener("click", goHome);
        reviewActions.appendChild(homeBtn);
        card.appendChild(reviewActions);
        sessionPanel.appendChild(card);
        return;
      }
      const next = firstIncompleteRequiredTask();
      const checkpoint = !!(pathTaskDef && pathTaskDef.kind === "checkpoint");
      const passed = checkpoint && score >= Math.ceil(total * 0.8);
      const result = checkpoint
        ? (passed ? pathTaskDef.label + "に合格しました。" : pathTaskDef.label + "は不合格です。" + Math.ceil(total * 0.8) + " / " + total + "以上で次へ進めます。")
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
  // 品質評価で退役させた問題(retired)を、出題・必修ルート・グループから外す。
  // 正本のJSONには問題文が残るので、retired の行を消せば元に戻る。
  const RETIRABLE_SETS = [
    ["choiceQuestions", "choiceRequiredQuestionIds", "choiceGroups", null],
    ["kisoQuestions", "kisoRequiredQuestionIds", "kisoGroups", null],
    ["shikibetsuQuestions", "requiredQuestionIds", "shikibetsuGroups", "coverageTopics"],
    ["joshiQuestions", "joshiRequiredQuestionIds", "joshiGroups", "joshiCoverageTopics"],
    ["homographQuestions", "homographRequiredQuestionIds", "homographGroups", "homographCoverageTopics"],
    ["keigoQuestions", "keigoRequiredQuestionIds", "keigoGroups", "keigoCoverageTopics"]
  ];
  function pruneRetired(data) {
    RETIRABLE_SETS.forEach(([questionsKey, requiredKey, groupsKey, coverageKey]) => {
      const questions = data[questionsKey];
      if (!Array.isArray(questions)) return;
      const retired = new Set(questions.filter(q => q && q.retired).map(q => q.id));
      if (!retired.size) return;
      data[questionsKey] = questions.filter(q => !retired.has(q.id));
      if (Array.isArray(data[requiredKey])) {
        data[requiredKey] = data[requiredKey].filter(id => !retired.has(id));
      }
      if (Array.isArray(data[groupsKey])) {
        data[groupsKey] = data[groupsKey].map(group => (
          Array.isArray(group.ids)
            ? Object.assign({}, group, { ids: group.ids.filter(id => !retired.has(id)) })
            : group
        ));
      }
      // 識別のカバレッジ表に、出題されない指定例が残らないようにする。
      if (coverageKey && Array.isArray(data[coverageKey])) {
        data[coverageKey] = data[coverageKey].map(topic => (
          Array.isArray(topic.items)
            ? Object.assign({}, topic, { items: topic.items.filter(item => !retired.has(item.id)) })
            : topic
        ));
      }
    });
  }
  // curriculum.jsonが壊れている（chapters/lessonsの最低限の形を満たさない）場合は、
  // ここで例外を投げてboot()の既存catchに処理させ、起動時エラー表示で停止する。
  function assertValidCurriculum(curriculum) {
    if (!curriculum || !Array.isArray(curriculum.chapters)) {
      throw new Error("教材構成を読み込めませんでした（chaptersが不正）");
    }
    curriculum.chapters.forEach(chapter => {
      if (!Array.isArray(chapter.lessons)) {
        throw new Error("教材構成を読み込めませんでした（lessonsが不正）");
      }
      chapter.lessons.forEach(lesson => {
        if (!lesson || !lesson.id || typeof lesson.number !== "number" || !Array.isArray(lesson.requiredActivities)) {
          throw new Error("教材構成を読み込めませんでした（lessonの形式が不正: " + (lesson && lesson.id) + "）");
        }
      });
    });
  }
  // procedureのprocIdから表示ラベルを解決する。procedures配列は setId ごとに
  // proceduresKey（"procedures"/"joshiProcedures"/"homographProcedures"/"keigoProcedures"）が異なる。
  function resolveProcedureLabel(setId, procId) {
    const set = practiceSetById(setId);
    const list = (set && set.proceduresKey && DATA[set.proceduresKey]) || [];
    const proc = list.find(p => p.id === procId);
    return (proc && (proc.name || proc.label || proc.title)) || procId;
  }
  // groupIdから表示ラベルを解決する（groups配列の name フィールド）。
  function resolveGroupLabel(setId, groupId) {
    const set = practiceSetById(setId);
    const list = (set && DATA[set.groups]) || [];
    const group = list.find(g => g.id === groupId);
    return (group && (group.name || group.label)) || groupId;
  }
  // curriculum.jsonのactivityにはlabelが無いため、種別ごとに実データから解決する。
  // a) procedure: procedures配列のname　b) group+groupId: groups配列のname
  // c) group+ids（groupId無し）: lessonのtitleをそのまま使う
  function activityLabel(activity, lesson) {
    if (activity.kind === "procedure") return resolveProcedureLabel(activity.setId, activity.procId);
    if (activity.kind === "group" && activity.groupId) return resolveGroupLabel(activity.setId, activity.groupId);
    return lesson.title;
  }
  // data/curriculum.jsonの46講だけを「1講=1ステージ」としてGRAMMAR_PATHへ変換する。
  // 発展学習とcheckpointは別の完了契約を持つため、GRAMMAR_PATHへ混ぜない。
  function buildGrammarPathFromCurriculum(curriculum) {
    return (curriculum.chapters || []).flatMap(chapter => (chapter.lessons || []).map(lesson => ({
      id: lesson.id,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      label: lesson.number + "講　" + lesson.title,
      description: lesson.hook || "",
      curriculumStatus: lesson.status,
      preparation: Array.isArray(lesson.preparation) ? lesson.preparation : [],
      tasks: (lesson.requiredActivities || []).map(activity => ({
        id: activity.id,
        activityId: activity.id,
        lessonId: lesson.id,
        chapterId: chapter.id,
        kind: activity.kind,
        setId: activity.setId,
        groupId: activity.groupId,
        ids: activity.ids,
        procId: activity.procId,
        stepRange: activity.stepRange,
        checkpointKey: activity.checkpointKey,
        sampleSize: activity.sampleSize,
        curriculumActivity: true,
        label: activityLabel(activity, lesson),
      })),
    })));
  }
  function buildGrammarExtensionPath(curriculum) {
    return (curriculum.extensions || [])
      .filter(ext => ext && Array.isArray(ext.activities) && ext.activities.length)
      .map(ext => ({
        id: ext.id,
        label: ext.title,
        description: ext.description || "",
        curriculumStatus: "ready",
        preparation: [],
        tasks: ext.activities.map(activity => ({
          id: activity.id,
          kind: activity.kind,
          setId: activity.setId,
          groupId: activity.groupId,
          ids: activity.ids,
          procId: activity.procId,
          label: activityLabel(activity, { title: ext.title }),
        })),
      }));
  }
  function buildGrammarCheckpoint(curriculum) {
    const checkpoint = curriculum.checkpoint;
    if (!checkpoint || !checkpoint.id) return null;
    const task = {
      id: checkpoint.id,
      kind: "checkpoint",
      source: "grammar",
      sourceSetId: "choice",
      checkpointKey: checkpoint.checkpointKey || "textbookCheckpointV1",
      label: checkpoint.title + (checkpoint.questionCount ? checkpoint.questionCount + "問" : ""),
      sampleSize: checkpoint.questionCount,
      total: checkpoint.questionCount,
      curriculumCheckpoint: true,
    };
    return {
      id: checkpoint.id,
      label: checkpoint.title,
      description: checkpoint.description || "",
      curriculumStatus: "ready",
      preparation: [],
      tasks: [task],
      task,
    };
  }
  // 旧進捗（問題別正解記録kobun-katsuyo-progress-v2）からの、46講版lessonCyclesへの移行。
  // boot()のたびに呼ばれるため冪等にする：completedAtは「空→値がある」の1回きりの遷移のみ行い、
  // 既に入っている講は素通りする。分割された旧taskの通し演習完了（grammarTaskCycle）は根拠にしない。
  // あくまでlessonStatus()＝taskStatus()が見る、新講の必修が指す具体的な問題ID・procedure実践IDの
  // 正解記録（kobun-katsuyo-progress-v2）だけを根拠にする。
  function migrateLessonProgress(curriculum) {
    const state = loadPathState();
    state.curriculumVersion = curriculum.id;
    if (!state.textbookCheckpointV1 || typeof state.textbookCheckpointV1 !== "object") {
      state.textbookCheckpointV1 = {
        passed: false,
        score: 0,
        total: (curriculum.checkpoint && curriculum.checkpoint.questionCount) || 30,
      };
    }
    const cycles = lessonCycles(state);
    const lessons = (curriculum.chapters || []).flatMap(chapter => chapter.lessons || []);
    lessons.forEach(lesson => {
      const existing = cycles[lesson.id];
      if (existing && typeof existing === "object" && existing.completedAt) return;
      if (!lessonStatus(lesson).complete) return;
      cycles[lesson.id] = Object.assign({ lastReviewedAt: "" }, existing || {}, { completedAt: nowIso() });
    });
    savePathState(state);
  }
  let booted = false;
  let bootPromise = null;
  function boot() {
    bootPromise = Promise.all([
      fetch("data/katsuyo.json?v=20260724-2")
        .then(r => { if (!r.ok) throw new Error("katsuyo data load failed: " + r.status); return r.json(); }),
      fetch("data/multiple_choice.json?v=20260818-2")
        .then(r => { if (!r.ok) throw new Error("choice data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu.json?v=20260730-7")
        .then(r => { if (!r.ok) throw new Error("shikibetsu data load failed: " + r.status); return r.json(); }),
      fetch("data/keigo-dokkai.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("keigo-dokkai data load failed: " + r.status); return r.json(); }),
      fetch("data/kobun-joshiki.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("kobun-joshiki data load failed: " + r.status); return r.json(); }),
      fetch("data/kiso.json?v=20260818-2")
        .then(r => { if (!r.ok) throw new Error("kiso data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-joshi.json?v=20260818-2")
        .then(r => { if (!r.ok) throw new Error("joshi data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-homograph.json?v=20260818-2")
        .then(r => { if (!r.ok) throw new Error("homograph data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-keigo.json?v=20260729-1")
        .then(r => { if (!r.ok) throw new Error("keigo-shikibetsu data load failed: " + r.status); return r.json(); }),
      fetch("data/curriculum.json?v=20260818-2")
        .then(r => { if (!r.ok) throw new Error("curriculum data load failed: " + r.status); return r.json(); })
    ])
      .then(async ([d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData,
                    kisoData, joshiData, homographData, keigoShikibetsuData, curriculumData]) => {
        DATA = Object.assign({}, d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData,
          kisoData, joshiData, homographData, keigoShikibetsuData);
        pruneRetired(DATA);
        assertValidCurriculum(curriculumData);

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
          requiredQuestionIdsKey: "choiceRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "文法知識を、4択でテンポよく確認"
        };
        const shikibetsuSet = {
          id: "shikibetsu",
          name: "識別",
          label: "IDENTIFY",
          description: "助動詞の意味の識別手順を、手順確認→実践の順で身につける",
          collection: "shikibetsuQuestions",
          groups: "shikibetsuGroups",
          proceduresKey: "procedures",
          requiredQuestionIdsKey: "requiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "識別手順を、手順→条件→対比→実践の順で確認"
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

        // 文法の土台。原則カード未整備の導入範囲も、学校文法の範囲で選択式に扱う。
        const kisoSet = {
          id: "kiso",
          name: "文法の土台",
          label: "BASICS",
          description: "音と文字・文の骨組み・活用形・接続・助動詞の基本を選択式で確認する",
          collection: "kisoQuestions",
          groups: "kisoGroups",
          requiredQuestionIdsKey: "kisoRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "文法を読むための土台を、選択式で確認"
        };
        // 必修7〜9の識別。いずれも shikibetsuSet と同じ「手順→条件→対比→実践」の構成を持つ。
        const joshiSet = {
          id: "joshi",
          name: "助詞の識別",
          label: "PARTICLES",
          description: "ば・より・格助詞「の」・だに・係り結び・終助詞の訳し分けを手順で身につける",
          collection: "joshiQuestions",
          groups: "joshiGroups",
          proceduresKey: "joshiProcedures",
          requiredQuestionIdsKey: "joshiRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "助詞の訳し分けを、手順→条件→対比→実践で確認"
        };
        const homographSet = {
          id: "homograph",
          name: "同形語の識別",
          label: "HOMOGRAPH",
          description: "ぬ・ね／る・れ／なり／なむ／に を接続と活用形で切り分ける",
          collection: "homographQuestions",
          groups: "homographGroups",
          proceduresKey: "homographProcedures",
          requiredQuestionIdsKey: "homographRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "同形語の識別を、手順→条件→対比→実践で確認"
        };
        const keigoShikibetsuSet = {
          id: "keigo-shikibetsu",
          name: "敬語の識別",
          label: "KEIGO IDENTIFY",
          description: "給ふ・奉る・侍り・補助動詞の訳・敬意の方向を手順で決める",
          collection: "keigoQuestions",
          groups: "keigoGroups",
          proceduresKey: "keigoProcedures",
          requiredQuestionIdsKey: "keigoRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "敬語の識別を、手順→条件→対比→実践で確認"
        };

        DATA.practiceSets = [jodoshiSet, yougoSet, choiceSet, shikibetsuSet, keigoDokkaiSet, kobunJoshikiSet,
          kisoSet, joshiSet, homographSet, keigoShikibetsuSet];
        DATA.practiceSets.forEach(set => {
          (DATA[set.collection] || []).forEach(item => { byId[set.id + ":" + itemId(item)] = item; });
        });

        // 段階1（古典文法）の必修は、curriculum.json（6章46講）を正本にGRAMMAR_PATHへ変換する。
        // procedures/groupsのlabel解決にpracticeSets/byIdを使うため、上のDATA.practiceSets構築後に行う。
        GRAMMAR_PATH = buildGrammarPathFromCurriculum(curriculumData);
        GRAMMAR_EXTENSIONS = buildGrammarExtensionPath(curriculumData);
        CURRICULUM_CHECKPOINT = buildGrammarCheckpoint(curriculumData);
        CURRICULUM = curriculumData;
        // 旧進捗（問題別正解記録）から46講版lessonCyclesへの移行。冪等なので毎起動呼んでよい。
        migrateLessonProgress(curriculumData);

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

  // 学習マップ用：段階1〜3（文法・敬語読解・古文常識）の完了状況と次タスクを返す。
  // DATA 未読込のときは ready:false。ensureData() で読み込める。
  function pathOverview() {
    if (!DATA) return { ready: false };
    const r = readingPathStatus();
    const c = culturePathStatus();
    const grammarStatus = grammarCourseStatus();
    const next = firstIncompleteRequiredTask();
    return {
      ready: true,
      grammarComplete: grammarStatus.complete,
      readingComplete: r.every(s => s.complete),
      cultureComplete: c.every(s => s.complete),
      next: next ? { taskLabel: next.task.label, stageLabel: next.stage.label } : null,
    };
  }
  // 画面を描画せずデータだけ読み込む（学習マップの遅延取得用）。
  function ensureData() {
    if (!booted) { booted = true; return boot(); }
    return bootPromise || Promise.resolve();
  }

  // __test: 講・章単位の進捗集計（lessonStatus/chapterStatus/firstIncompleteLesson）を
  // ブラウザconsoleやNode回帰テスト（scripts/check_curriculum_progress.mjs）から呼べるようにする
  // デバッグ用フック。UIからは呼ばない（Task8/9で正式なUI導線を追加する予定）。
  return {
    mount, handleKey, pathOverview, ensureData,
    __test: {
      lessonStatus,
      chapterStatus,
      firstIncompleteLesson,
      taskCheckedIds,
      taskStatus,
      applyActivityCompletion,
      saveCheckpointResult,
      grammarCourseStatus,
      lessonQueueEntries,
      chapterQueueEntries,
      weakQueueEntries,
    },
  };
})();
