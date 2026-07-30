"use strict";

const KatsuyoApp = (function () {
  const FORM_NAMES = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
  const STORE_KEY = "kobun-katsuyo-progress-v1";
  const APP_ID = "kobun-katsuyo";
  const MASTERY_THRESHOLD = 2; // 単語モードと同じ「累計2回正解」で習得扱いに揃える
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
  const PATH_STORE_KEY = "kobun-katsuyo-path-v1";
  // 段階2の必修。docs/kobun-principles の active な原則カードに対応させて8段構成にしてある。
  // 並びは「読むための土台 → 用言 → 助動詞の形 → 助動詞の意味 → 助詞 → 同形語 → 敬語 → 混合確認」。
  // 同形語の識別を助詞のあとに置いているのは、「に」「なむ」の識別が助詞の知識を前提にするため。
  const GRAMMAR_PATH = [
    {
      id: "kiso",
      label: "1. 文法の入口",
      description: "読み方・品詞・活用形・接続という、文法を読むための土台を作る",
      tasks: [
        { id: "kiso-yomi", kind: "group", setId: "kiso", groupId: "kiso-yomi", label: "歴史的仮名遣いと読み 7問" },
        // 2026-07-28の統廃合で問題が増えた3タスクは、タスクIDを付け替えて
        // grammarTaskCycles の passCompleted を引き継がせない。IDを据え置くと、
        // 旧版を完了済みの生徒が新しく入った8問を未回答のまま完了扱いになる。
        { id: "kiso-hinshi", kind: "group", setId: "kiso", groupId: "kiso-bunsetsu", label: "文節と品詞 8問" },
        { id: "kiso-katsuyo-kakari", kind: "group", setId: "kiso", groupId: "kiso-katsuyokei", label: "活用形と係り結び 10問" },
        { id: "kiso-setsuzoku-kihon", kind: "group", setId: "kiso", groupId: "kiso-setsuzoku", label: "接続という考え方 9問" },
        { id: "kiso-shikibetsu", kind: "group", setId: "kiso", groupId: "kiso-shikibetsu", label: "接続で識別する 5問" },
        { id: "kiso-jodoshi", kind: "group", setId: "kiso", groupId: "kiso-jodoshi", label: "助動詞の意味 7問" },
      ],
    },
    {
      id: "yougo",
      label: "2. 用言の活用",
      description: "用言の活用表と、用言の攻略で活用の運用力を固める",
      tasks: [
        { id: "choice-ch2", kind: "group", setId: "choice", groupId: "qa-chapter-2", label: "用言の攻略 24問" },
        { id: "yougo-table", kind: "group", setId: "yougo", groupId: "yougo-all", label: "用言13語の活用表" },
      ],
    },
    {
      id: "jodoshi",
      label: "3. 助動詞の活用・接続",
      description: "助動詞の活用表を埋める",
      tasks: [
        { id: "jodoshi-table", kind: "group", setId: "jodoshi", groupId: "all", label: "助動詞28語の活用表" },
      ],
    },
    {
      id: "shikibetsu",
      label: "4. 助動詞の意味を決める",
      description: "内容理解→実践の順で、助動詞12種の意味を手順で決める",
      tasks: [
        { id: "proc-rareru", kind: "procedure", setId: "shikibetsu", procId: "rareru", label: "る・らるの識別" },
        { id: "proc-sasu", kind: "procedure", setId: "shikibetsu", procId: "sasu", label: "す・さす・しむの識別" },
        { id: "proc-mu", kind: "procedure", setId: "shikibetsu", procId: "mu", label: "む・むず・じの識別" },
        { id: "proc-mashi", kind: "procedure", setId: "shikibetsu", procId: "mashi", label: "ましの識別" },
        { id: "proc-keri", kind: "procedure", setId: "shikibetsu", procId: "keri", label: "き・けりの識別" },
        { id: "proc-tsunu", kind: "procedure", setId: "shikibetsu", procId: "tsunu", label: "つ・ぬの識別" },
        { id: "proc-tariri", kind: "procedure", setId: "shikibetsu", procId: "tariri", label: "たり・りの識別" },
        { id: "proc-ramu", kind: "procedure", setId: "shikibetsu", procId: "ramu", label: "らむの識別" },
        { id: "proc-kemu", kind: "procedure", setId: "shikibetsu", procId: "kemu", label: "けむの識別" },
        { id: "proc-beshi", kind: "procedure", setId: "shikibetsu", procId: "beshi", label: "べし・まじの識別" },
        { id: "proc-nari", kind: "procedure", setId: "shikibetsu", procId: "nari", label: "なりの訳し分け（断定・存在）" },
        { id: "proc-other", kind: "procedure", setId: "shikibetsu", procId: "other", label: "その他の助動詞の意味" },
      ],
    },
    {
      id: "joshi",
      label: "5. 助詞",
      description: "助詞の知識を確認し、ば・より・格助詞「の」・だに・係り結び・終助詞を手順で訳し分ける",
      tasks: [
        { id: "choice-ch7", kind: "group", setId: "choice", groupId: "qa-chapter-7", label: "助詞の攻略 10問" },
        { id: "proc-ba", kind: "procedure", setId: "joshi", procId: "ba", label: "ばの識別" },
        { id: "proc-yori", kind: "procedure", setId: "joshi", procId: "yori", label: "よりの識別" },
        { id: "proc-no", kind: "procedure", setId: "joshi", procId: "no", label: "格助詞「の」の識別" },
        { id: "proc-dani", kind: "procedure", setId: "joshi", procId: "dani", label: "だにの識別" },
        { id: "proc-kakari", kind: "procedure", setId: "joshi", procId: "kakari", label: "係り結びの特殊構文" },
        { id: "proc-shuujoshi", kind: "procedure", setId: "joshi", procId: "shuujoshi", label: "終助詞の識別" },
      ],
    },
    {
      id: "homograph",
      label: "6. 同形語の識別",
      description: "ぬ・ね／る・れ／なり／なむ／に を、接続と活用形から切り分ける",
      tasks: [
        { id: "proc-h-nune", kind: "procedure", setId: "homograph", procId: "h-nune", label: "ぬ・ねの識別" },
        { id: "proc-h-rure", kind: "procedure", setId: "homograph", procId: "h-rure", label: "る・れの識別" },
        { id: "proc-h-nari", kind: "procedure", setId: "homograph", procId: "h-nari", label: "なりの識別（伝聞推定・断定）" },
        { id: "proc-h-namu", kind: "procedure", setId: "homograph", procId: "h-namu", label: "なむの識別" },
        { id: "proc-h-ni", kind: "procedure", setId: "homograph", procId: "h-ni", label: "にの識別" },
      ],
    },
    {
      id: "keigo",
      label: "7. 敬語",
      description: "敬語の知識を確認し、給ふ・奉る・侍り・補助動詞・敬意の方向を手順で決める",
      tasks: [
        { id: "choice-ch9", kind: "group", setId: "choice", groupId: "qa-chapter-9", label: "敬語の攻略 8問" },
        { id: "proc-k-tamau", kind: "procedure", setId: "keigo-shikibetsu", procId: "k-tamau", label: "給ふの識別" },
        { id: "proc-k-tatematsuru", kind: "procedure", setId: "keigo-shikibetsu", procId: "k-tatematsuru", label: "奉る・参るの識別" },
        { id: "proc-k-haberi", kind: "procedure", setId: "keigo-shikibetsu", procId: "k-haberi", label: "侍り・候ふの識別" },
        { id: "proc-k-hojo", kind: "procedure", setId: "keigo-shikibetsu", procId: "k-hojo", label: "補助動詞の訳し方" },
        { id: "proc-k-keii", kind: "procedure", setId: "keigo-shikibetsu", procId: "k-keii", label: "敬意の方向" },
      ],
    },
    {
      id: "grammar-checkpoint",
      label: "文法混合確認",
      description: "必修1〜7の全範囲からランダムに出題し、文法全体を確認する",
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
  function shikibetsuPracticeIds(procId) {
    const g = shikibetsuGroupForProc(procId);
    if (!g) return [];
    const required = shikibetsuRequiredIdSet();
    return g.ids.filter(id => required.has(id) && (byId[itemKey(id)] || {}).questionType === "integration");
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
    const practiceIds = shikibetsuPracticeIds(procId);
    const practiceDone = practiceIds.filter(id => shikibetsuIdCleared(id, p)).length;
    return {
      practiceIds, practiceDone,
      complete: practiceIds.length > 0 && practiceDone === practiceIds.length,
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
    const set = practiceSetById(task.setId);
    return group ? groupIdsForSet(group, set) : [];
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
      const status = shikibetsuProcStatus(task.procId);
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
    if (!isGrammarOnePassTask(task)) {
      const done = ids.filter(id => isMastered(progressRecord(p, id))).length;
      currentSet = prev;
      return { done, total: ids.length, complete: ids.length > 0 && done === ids.length };
    }
    const cycle = grammarTaskCycle(task.id);
    const done = ids.filter(id => {
      const rec = progressRecord(p, id);
      return !!rec && rec.c >= 1;
    }).length;
    const legacyComplete = ids.length > 0 && done === ids.length;
    const complete = !!cycle.passCompleted || legacyComplete;
    currentSet = prev;
    return {
      done,
      total: ids.length,
      complete: ids.length > 0 && complete,
      phase: complete ? "完了" : "通し"
    };
  }
  // 新しい必修問題を追加しても、すでに着手した後続段階を再ロックしない。
  // 未着手の段階は従来どおり前段階の完了を必要とする。
  function stageHasProgress(tasks) {
    return tasks.some(task => task.status.complete || task.status.done > 0);
  }
  function grammarPathStatus() {
    let previousComplete = true;
    return GRAMMAR_PATH.map(stage => {
      const tasks = stage.tasks.map(task => Object.assign({}, task, { status: taskStatus(task) }));
      const complete = tasks.every(task => task.status.complete);
      const available = previousComplete || stageHasProgress(tasks);
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
      const available = previousComplete || stageHasProgress(tasks);
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
      const available = previousComplete || stageHasProgress(tasks);
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
  function startRequiredTask(task, review = false) {
    activeGrammarMode = "roadmap";
    activeGrammarPathTask = task.id;
    activeGrammarPathReview = review;
    if (task.kind === "procedure") {
      currentSet = practiceSetById(task.setId || "shikibetsu");
      startShikibetsuFlow(task.procId, { pathTask: task.id, pathReview: review });
      return;
    }
    if (task.kind === "checkpoint") {
      const entries = shuffle(sourceEntriesForCheckpoint(task)).slice(0, task.sampleSize || 30);
      currentSet = practiceSetById(entries.length ? entries[0].setId : (task.sourceSetId || "choice"));
      startSession(entries.map(e => e.id), task.label, {
        pathTask: task.id,
        pathReview: review,
        setMap: entriesToSetMap(entries),
      });
      return;
    }
    const set = practiceSetById(task.setId);
    const ids = taskIds(task);
    currentSet = set;
    if (!isGrammarOnePassTask(task)) {
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
      requeueWrong: false,
    });
  }
  function appendPathSection(title, stages, stats, hintText, lockText, collapsed) {
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
        if (stage.available) {
          const actionLabel = task.status.complete
            ? "復習する"
            : task.status.done > 0
              ? (task.kind === "checkpoint" ? "再挑戦する" : task.kind === "procedure" ? "学び直す" : "つづきから")
              : "演習する";
          const action = el("button", "ghost smallGhost pathTaskAction", actionLabel);
          action.type = "button";
          action.setAttribute("aria-label", task.label + "を" + actionLabel);
          action.addEventListener("click", () => startRequiredTask(task, task.status.complete));
          row.appendChild(action);
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
      ? (next ? "次は" + next.task.label + "を進める" : "第2段階の文法を完了しました")
      : !readingComplete
        ? (next ? "次は" + next.task.label + "を進める" : "第3段階の敬語読解を完了しました")
        : (next ? "次は" + next.task.label + "を進める" : "第4段階の古文常識を完了しました")));
    hero.appendChild(el("p", "hint", !grammarComplete
      ? "文法の入口 → 用言 → 助動詞の活用 → 助動詞の意味 → 助詞 → 同形語 → 敬語の順で進みます。後の項目は、前の必修を終えるまで解放されません。"
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

    if (typeof LearningMap !== "undefined") {
      const mapSlot = el("section");
      mapSlot.id = "learningMapSlot";
      homePanel.appendChild(mapSlot);
      LearningMap.render(mapSlot, { activeApp: "grammar" });
    }

    // 進行中の段階だけタスク一覧を展開する。完了済み・未解放の段階は要約＋<details>に折りたたむ
    // （ヒックの法則：GHOME一画面に常時並ぶ選択肢を、今取り組む段階だけに絞る）。
    const grammarCurrent = !grammarComplete;
    const readingCurrent = grammarComplete && !readingComplete;
    const cultureCurrent = grammarComplete && readingComplete && !cultureComplete;

    const grammarCompleted = grammarStages.filter(stage => stage.complete).length;
    appendPathSection("第2段階", grammarStages,
      [[String(grammarCompleted), "/ " + grammarStages.length, "COMPLETE・完了"], [String(grammarStages.length - grammarCompleted), "", "REMAINING・残り"], [String(requiredChoiceIds().length), "", "確認対象の4択"]],
      "通常問題は通し演習で各問題を1回以上正解すると完了、識別フローは実践を全問1回正解で完了扱いです。最後に文法混合確認30問を行います。",
      "前の文法必修を完了すると解放されます。",
      !grammarCurrent);

    const readingCompleted = readingStages.filter(stage => stage.complete).length;
    appendPathSection("第3段階", readingStages,
      [[String(readingCompleted), "/ " + readingStages.length, "COMPLETE・完了"], [String(readingStages.length - readingCompleted), "", "REMAINING・残り"], [String(requiredReadingIds().length), "", "敬語読解の確認"]],
      "敬語読解は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第2段階の文法を完了すると解放されます。",
      !readingCurrent);
    const cultureCompleted = cultureStages.filter(stage => stage.complete).length;
    appendPathSection("第4段階", cultureStages,
      [[String(cultureCompleted), "/ " + cultureStages.length, "COMPLETE・完了"], [String(cultureStages.length - cultureCompleted), "", "REMAINING・残り"], [String(requiredCultureIds().length), "", "古文常識の確認"]],
      "古文常識は各短文を2回正解し、最後に12問中10問以上のチェックポイントに合格すると完了です。",
      "第3段階の敬語読解を完了すると解放されます。",
      !cultureCurrent);
    renderSupplementalPracticeCard();
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
          renderHome();
        }
      });
      actionsRow.appendChild(resetBtn);
      details.appendChild(actionsRow);
      moreCard.appendChild(details);
      homePanel.appendChild(moreCard);
    }
  }

  // 識別セクション専用：手順ごとに「学習する」ボタン（理解→実践のフロー開始）と
  // 実践の習得状況、手順本文（手順I〜IV）の折りたたみ確認を並べたカード。
  function renderProcedureStepsCard() {
    const procedures = shikibetsuProcedures();
    if (!procedures.length) return;
    const card = el("section", "card");
    card.appendChild(el("span", "label", "手順を学習する"));
    card.appendChild(el("p", "hint", "手順の内容理解→実践問題（傍線部の意味）の順に進みます。"));
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
      requeueWrong: !(opts && opts.requeueWrong === false),
      flow: (opts && opts.flow) || null, // 識別の学習フロー内で開始されたセッションかどうか
      pathTask: (opts && opts.pathTask) || activeGrammarPathTask,
      pathReview: opts && Object.prototype.hasOwnProperty.call(opts, "pathReview")
        ? !!opts.pathReview
        : activeGrammarPathReview,
      pathPhase: (opts && opts.pathPhase) || null,
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

  // 識別セクションの学習フロー：手順本文の理解 → 実践問題（傍線部の意味）の順に進む。
  function startShikibetsuFlow(procId, pathContext = {}) {
    const proc = shikibetsuProcedures().find(pr => pr.id === procId);
    if (!proc) { goHome(); return; }
    flow = {
      procId,
      flashIdx: 0,
      pathTask: pathContext.pathTask || activeGrammarPathTask,
      pathReview: !!pathContext.pathReview,
    };
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    renderUnderstand();
  }

  function startShikibetsuPractice() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
    flow.stage = "practice";
    startSession(shikibetsuPracticeIds(flow.procId), proc.name + "・実践問題", {
      flow: Object.assign({}, flow),
      pathTask: flow.pathTask,
      pathReview: flow.pathReview,
    });
  }

  // 理解→実践の2ステージを表す帯（eiken2-q1のstageBarに相当する構成）。
  function flowStageBar(stage) {
    const order = ["understand", "practice"];
    const labels = { understand: "1 理解", practice: "2 実践" };
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
     const exitGroup = el("div", "sessionExitGroup");
     const quit = el("button", "ghost smallGhost", "演習を中断");
     quit.type = "button";
     quit.addEventListener("click", goHome);
     exitGroup.appendChild(quit);
     exitGroup.appendChild(el("span", "sessionSaveHint", "進捗は保存されます"));
     head.appendChild(exitGroup);
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
    const next = el("button", "cta", isLast ? "実践問題へ進む →" : "次の手順 →");
    next.type = "button";
    next.id = "understandNextBtn";
    next.addEventListener("click", () => {
      if (isLast) startShikibetsuPractice();
      else { flow.flashIdx += 1; renderUnderstand(); }
    });
    nav.appendChild(next);
    box.appendChild(nav);
    box.appendChild(el("p", "cardCounter", "手順 " + (idx + 1) + " / " + steps.length));

    sessionPanel.appendChild(box);
  }

  // フロー内の実践セッションが完了したときの分岐。
  function renderFlowDone() {
    const proc = shikibetsuProcedures().find(pr => pr.id === flow.procId);
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

  // 実践中に識別手順を参照するためのカード。理解ステージ（renderUnderstand）と同じ
  // 「1手順ずつ＋前後移動」の形式を流用する。参照位置は session.flow.refIdx に保持し、
  // 採点・次の問題への遷移をまたいでも参照中の手順が保たれるようにする。
  function renderProcedureReferenceBox(proc) {
    const box = el("div", "drillBox procedureRefBox");
    function paint() {
      box.innerHTML = "";
      const steps = proc.steps;
      const idx = Math.min(Math.max(session.flow.refIdx || 0, 0), steps.length - 1);
      session.flow.refIdx = idx;
      const step = steps[idx];

      box.appendChild(el("p", "askLabel", "識別方法を確認する・" + proc.name));
      const stepBox = el("div", "understandStep");
      stepBox.appendChild(el("span", "procedureStepNo", step.no));
      stepBox.appendChild(el("p", "understandStepText", step.text));
      box.appendChild(stepBox);

      const nav = el("div", "actions");
      const prevBtn = el("button", "ghost smallGhost", "← 前の手順");
      prevBtn.type = "button";
      if (idx === 0) prevBtn.disabled = true;
      prevBtn.addEventListener("click", () => { session.flow.refIdx = idx - 1; paint(); });
      nav.appendChild(prevBtn);
      const nextBtn = el("button", "ghost smallGhost", "次の手順 →");
      nextBtn.type = "button";
      if (idx === steps.length - 1) nextBtn.disabled = true;
      nextBtn.addEventListener("click", () => { session.flow.refIdx = idx + 1; paint(); });
      nav.appendChild(nextBtn);
      box.appendChild(nav);
      box.appendChild(el("p", "cardCounter", "手順 " + (idx + 1) + " / " + steps.length));
    }
    paint();
    return box;
  }

  function renderChoiceRow() {
    const id = session.queue[0];
    const q = byId[itemKey(id)];

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
    if (!session.pathReview) saveGrammarTaskCycle(taskDef.id, { passCompleted: true });
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
      fetch("data/katsuyo.json?v=20260724-2")
        .then(r => { if (!r.ok) throw new Error("katsuyo data load failed: " + r.status); return r.json(); }),
      fetch("data/multiple_choice.json?v=20260730-2")
        .then(r => { if (!r.ok) throw new Error("choice data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu.json?v=20260730-7")
        .then(r => { if (!r.ok) throw new Error("shikibetsu data load failed: " + r.status); return r.json(); }),
      fetch("data/keigo-dokkai.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("keigo-dokkai data load failed: " + r.status); return r.json(); }),
      fetch("data/kobun-joshiki.json?v=20260721-1")
        .then(r => { if (!r.ok) throw new Error("kobun-joshiki data load failed: " + r.status); return r.json(); }),
      fetch("data/kiso.json?v=20260728-4")
        .then(r => { if (!r.ok) throw new Error("kiso data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-joshi.json?v=20260729-1")
        .then(r => { if (!r.ok) throw new Error("joshi data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-homograph.json?v=20260729-1")
        .then(r => { if (!r.ok) throw new Error("homograph data load failed: " + r.status); return r.json(); }),
      fetch("data/shikibetsu-keigo.json?v=20260729-1")
        .then(r => { if (!r.ok) throw new Error("keigo-shikibetsu data load failed: " + r.status); return r.json(); })
    ])
      .then(async ([d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData,
                    kisoData, joshiData, homographData, keigoShikibetsuData]) => {
        DATA = Object.assign({}, d, choiceData, shikibetsuData, keigoDokkaiData, kobunJoshikiData,
          kisoData, joshiData, homographData, keigoShikibetsuData);

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

        // 必修1「文法の入口」。原則カード未整備の導入範囲を4択で扱う。
        const kisoSet = {
          id: "kiso",
          name: "文法の入口",
          label: "BASICS",
          description: "読み方・品詞・活用形・接続・助動詞の基礎を4択で確認する",
          collection: "kisoQuestions",
          groups: "kisoGroups",
          requiredQuestionIdsKey: "kisoRequiredQuestionIds",
          askLabel: "正しい選択肢を選べ",
          unit: "問",
          mode: "choice",
          homeTitle: "文法を読むための土台を、4択で確認"
        };
        // 必修5〜7の識別。いずれも shikibetsuSet と同じ「手順→条件→対比→実践」の構成を持つ。
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

  // 学習マップ用：段階2〜4（文法・敬語読解・古文常識）の完了状況と次タスクを返す。
  // DATA 未読込のときは ready:false。ensureData() で読み込める。
  function pathOverview() {
    if (!DATA) return { ready: false };
    const g = grammarPathStatus();
    const r = readingPathStatus();
    const c = culturePathStatus();
    const next = firstIncompleteRequiredTask();
    return {
      ready: true,
      grammarComplete: g.every(s => s.complete),
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

  return { mount, handleKey, pathOverview, ensureData };
})();
