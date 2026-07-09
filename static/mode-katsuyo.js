"use strict";

const KatsuyoApp = (function () {
  const FORM_NAMES = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
  const STORE_KEY = "kobun-katsuyo-progress-v1";

  const homePanel = document.getElementById("homePanel");
  const sessionPanel = document.getElementById("sessionPanel");

  let DATA = null;
  let currentSet = null;
  let byId = {};

  /* ---------- progress (localStorage) ---------- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) {}
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
  function weakIds() {
    const p = loadProgress();
    return getItems().filter(item => (progressRecord(p, itemId(item)) || {}).weak).map(itemId);
  }
  function masteredCount() {
    const p = loadProgress();
    return getItems().filter(item => {
      const r = progressRecord(p, itemId(item));
      return r && r.c > 0 && !r.weak;
    }).length;
  }
  function groupDoneCount(g, p) {
    return g.ids.filter(id => {
      const r = progressRecord(p, id);
      return r && r.c > 0 && !r.weak;
    }).length;
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

    const nav = el("section", "practiceNav");
    DATA.practiceSets.forEach(set => {
      const btn = el("button", "practiceTab", set.name);
      btn.type = "button";
      btn.setAttribute("aria-pressed", set.id === currentSet.id ? "true" : "false");
      btn.appendChild(el("span", null, set.label));
      btn.addEventListener("click", () => {
        currentSet = set;
        renderHome();
      });
      nav.appendChild(btn);
    });
    homePanel.appendChild(nav);

    const hero = el("section", "card hero");
    hero.appendChild(el("span", "label", currentSet.label + " CHECK"));
    const h2 = el("h2", null, currentSet.homeTitle || (currentSet.name + "の活用表を、行ごとに埋めてテスト"));
    h2.style.color = "var(--parchment)";
    hero.appendChild(h2);
    hero.appendChild(el("p", "hint", currentSet.description + "。間違えた行はセッション末尾で再出題されます。"));

    const grid = el("div", "statGrid");
    const cells = [
      [String(mastered), "/ " + total, "MASTERED"],
      [String(weak), "", "WEAK / 苦手"],
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
    hero.appendChild(grid);

    const bar = el("div", "masteryBar");
    const fill = el("div", "masteryFill");
    fill.style.width = (total ? Math.round(mastered / total * 100) : 0) + "%";
    bar.appendChild(fill);
    hero.appendChild(bar);

    const actions = el("div", "actions");
    if (weak > 0) {
      const rev = el("button", "cta reviewCta", "苦手だけ復習（" + weak + "）");
      rev.addEventListener("click", () => startSession(weakIds(), "苦手復習"));
      actions.appendChild(rev);
    } else {
      const inc = firstIncompleteGroup();
      if (inc) {
        const label = "つづきから：" + inc.group.name + "（" + inc.done + " / " + inc.group.ids.length + "）";
        const next = el("button", "cta", label);
        next.addEventListener("click", () => startSession(inc.group.shuffle ? shuffle(inc.group.ids) : inc.group.ids.slice(), inc.group.name));
        actions.appendChild(next);
      } else if (total > 0) {
        const redo = el("button", "cta", "総仕上げ：" + total + currentSet.unit + "をランダム");
        redo.addEventListener("click", () => startSession(shuffle(getItems().map(itemId)), "総仕上げ"));
        actions.appendChild(redo);
      }
    }
    hero.appendChild(actions);
    homePanel.appendChild(hero);

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
      btn.addEventListener("click", () => startSession(g.shuffle ? shuffle(g.ids) : g.ids.slice(), g.name));
      list.appendChild(btn);
    });
    listCard.appendChild(list);
    homePanel.appendChild(listCard);

    const resetRow = el("div", "resetRow");
    const resetBtn = el("button", "ghost smallGhost", "すべての記録を消す");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", () => {
      if (confirm("進捗（習得・苦手）をすべてリセットします。よろしいですか？")) {
        localStorage.removeItem(STORE_KEY);
        renderHome();
      }
    });
    resetRow.appendChild(resetBtn);
    homePanel.appendChild(resetRow);
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
    };
    homePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    renderRow();
  }

  function renderRow() {
    sessionPanel.innerHTML = "";
    if (session.queue.length === 0) { renderDone(); return; }
    if (setMode(currentSet) === "choice") { renderChoiceRow(); return; }
    const id = session.queue[0];
    const j = byId[itemKey(id)];

    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, session.title));
    info.appendChild(el("span", null, "残り " + session.queue.length));
    head.appendChild(info);
    const quit = el("button", "ghost smallGhost", "中断（進捗は保存）");
    quit.addEventListener("click", renderHome);
    head.appendChild(quit);
    sessionPanel.appendChild(head);

    const track = el("div", "progressTrack");
    const pf = el("div", "progressFill");
    pf.style.width = Math.round(session.solved / session.total * 100) + "%";
    track.appendChild(pf);
    sessionPanel.appendChild(track);

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

    const head = el("div", "sessionHead");
    const info = el("div", "roundInfo");
    info.appendChild(el("span", null, session.title));
    info.appendChild(el("span", null, "残り " + session.queue.length));
    head.appendChild(info);
    const quit = el("button", "ghost smallGhost", "中断（進捗は保存）");
    quit.addEventListener("click", renderHome);
    head.appendChild(quit);
    sessionPanel.appendChild(head);

    const track = el("div", "progressTrack");
    const pf = el("div", "progressFill");
    pf.style.width = Math.round(session.solved / session.total * 100) + "%";
    track.appendChild(pf);
    sessionPanel.appendChild(track);

    const box = el("div", "drillBox");
    const top = el("div", "drillTop");
    const wc = el("div");
    wc.appendChild(el("p", "askLabel", "CHAPTER " + q.chapter + " / QUESTION " + q.no));
    wc.appendChild(el("p", "gradeChoiceQuestion", q.question));
    top.appendChild(wc);
    box.appendChild(top);

    let chosen = null;
    const choices = el("div", "gradeChoiceList");
    const buttons = [];
    const submit = el("button", "cta", "採点する");
    submit.disabled = true;
    const choiceOptions = shuffle(q.choices.map((text, originalIndex) => ({ text, originalIndex })));

    choiceOptions.forEach((choice, idx) => {
      const btn = el("button", "gradeChoiceBtn");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.appendChild(el("span", "gradeChoiceMark", String.fromCharCode(65 + idx)));
      btn.appendChild(el("span", "gradeChoiceText", choice.text));
      btn.addEventListener("click", () => {
        chosen = choice.originalIndex;
        buttons.forEach(b => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        submit.disabled = false;
      });
      buttons.push(btn);
      choices.appendChild(btn);
    });
    box.appendChild(choices);

    const submitRow = el("div", "submitRow");
    submit.addEventListener("click", () => gradeChoiceRow(q, chosen, buttons, choiceOptions, box, submit));
    submitRow.appendChild(submit);
    box.appendChild(submitRow);

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
    fb.appendChild(el("h3", null, allOk ? "○ 全項目正解" : "× 誤りあり — 正解を確認"));
    const ansForms = j.forms.map((f, i) => FORM_NAMES[i] + "：" + (f.length ? f.join("・") : "○")).join("　");
    if (currentSet.showSetsuzoku) addAnswer(fb, "接続", j.setsuzoku);
    addAnswer(fb, "活用形", ansForms);
    addAnswer(fb, "活用の型", j.type);
    if (currentSet.showMeanings) addAnswer(fb, "意味", j.meanings.join("・"));
    box.appendChild(fb);

    const nextRow = el("div", "submitRow");
    const next = el("button", "cta", session.queue.length ? "次へ" : "結果を見る");
    next.addEventListener("click", renderRow);
    nextRow.appendChild(next);
    box.appendChild(nextRow);
    next.focus();
  }

  function gradeChoiceRow(q, chosen, buttons, choiceOptions, box, submit) {
    const allOk = chosen === q.answerIndex;

    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      const originalIndex = choiceOptions[idx].originalIndex;
      if (originalIndex === q.answerIndex) btn.classList.add("correct");
      else if (originalIndex === chosen) btn.classList.add("wrong");
    });
    submit.disabled = true;

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
    fb.appendChild(el("h3", null, allOk ? "○ 正解" : "× 誤りあり — 解説を確認"));
    addAnswer(fb, "正解", q.choices[q.answerIndex]);
    addAnswer(fb, "解説", q.explanation);
    box.appendChild(fb);

    const nextRow = el("div", "submitRow");
    const next = el("button", "cta", session.queue.length ? "次へ" : "結果を見る");
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
    const banner = el("div", "doneBanner");
    banner.appendChild(el("div", "big", session.firstTryOk + " / " + session.total));
    banner.appendChild(el("div", "sub", "一発正解 / 出題数"));
    sessionPanel.appendChild(banner);

    if (session.wrongNos.size > 0) {
      const card = el("div", "card");
      card.appendChild(el("span", "label", "つまずいた" + currentSet.unit));
      const list = el("div", "wrongList");
      Array.from(session.wrongNos).forEach(id => {
        const item = byId[itemKey(id)];
        list.appendChild(el("span", null, item.kihon || ("Q" + item.no)));
      });
      card.appendChild(list);
      sessionPanel.appendChild(card);
    }

    const actions = el("div", "actions");
    if (session.wrongNos.size > 0) {
      const nos = Array.from(session.wrongNos);
      const retry = el("button", "cta reviewCta", "苦手だけ復習（" + nos.length + "）");
      retry.addEventListener("click", () => startSession(nos, "苦手復習"));
      actions.appendChild(retry);
      const again = el("button", "ghost", "ホームへ戻る");
      again.addEventListener("click", renderHome);
      actions.appendChild(again);
    } else {
      const again = el("button", "cta", "ホームへ戻る");
      again.addEventListener("click", renderHome);
      actions.appendChild(again);
    }
    sessionPanel.appendChild(actions);
  }

  /* ---------- boot ---------- */
  let booted = false;
  function boot() {
    return Promise.all([
      fetch("data/katsuyo.json?v=20260709-5")
        .then(r => { if (!r.ok) throw new Error("katsuyo data load failed: " + r.status); return r.json(); }),
      fetch("data/multiple_choice.json?v=20260709-3")
        .then(r => { if (!r.ok) throw new Error("choice data load failed: " + r.status); return r.json(); })
    ])
      .then(([d, choiceData]) => {
        DATA = Object.assign({}, d, choiceData);

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
          unit: "問題",
          mode: "choice",
          homeTitle: "文法知識を、4択でテンポよく確認"
        };

        DATA.practiceSets = [jodoshiSet, yougoSet, choiceSet];
        currentSet = DATA.practiceSets[0];
        DATA.practiceSets.forEach(set => {
          (DATA[set.collection] || []).forEach(item => { byId[set.id + ":" + itemId(item)] = item; });
        });
        renderHome();
      })
      .catch(err => {
        homePanel.innerHTML = "";
        const c = el("div", "card");
        c.appendChild(el("h2", null, "データを読み込めませんでした"));
        c.appendChild(el("p", "hint", String(err) + "（ローカルサーバー経由で開いてください）"));
        homePanel.appendChild(c);
      });
  }

  async function mount() {
    if (booted) { renderHome(); return; }
    booted = true;
    await boot();
  }

  return { mount };
})();
