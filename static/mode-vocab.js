"use strict";

/* ============================================================
   古文単語 4択演習
   出題方向：古語（かな＋漢字＋品詞）→ 意味
   誤答：他語の意味からダミー生成（正解語の意味は除外）
   進捗：localStorage に語ごとの正答数を保存
   ============================================================ */

const VocabApp = (function () {
  const DATA_URL = "data/vocab.json?v=0.5.0";
  const STORE_KEY = "kobun_vocab_progress_v1";
  const RANGE_KEY = "kobun_vocab_range_v1";
  const SESSION_KEY = "kobun_vocab_session_v4"; // コア200語の選定変更で旧セッションを再開しない
  const SET_PROGRESS_KEY = "kobun_vocab_sets_v1";
  const GATE_KEY = "kobun_vocab_gate_v1";
  const PROGRESS_META_KEY = "__kobunStage1";
  const APP_ID = "kobun-vocab";
  const SESSION_SIZE = 20;
  const GATE_SIZE = 30;
  const GATE_PASS_RATE = 0.8;
  const CYCLE_SESSION_SIZE = 15;
  const CORE_MASTERY_REQUIRED = 1;
  const NEXT_KEY_COOLDOWN_MS = 500; // 解答直後の数字キー連打を「次へ」と誤認しない猶予

  const state = {
    meta: {},
    words: [],          // [{id, kana, kanji, pos, meanings[], group}]
    progress: {},       // id -> { correct, wrong }
    session: null,      // 現在の演習セッション
  };

  let cloud = null;     // harness createCloud のインスタンス（config無しなら no-op）
  let booted = false;

  /* ---------- localStorage ---------- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.progress)); }
    catch (e) { /* ignore */ }
    if (cloud) cloud.queueSave();
  }
  function loadRange() {
    try {
      const raw = localStorage.getItem(RANGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveRange(start, end) {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify({ start, end })); }
    catch (e) { /* ignore */ }
  }
  // 中断・リロードからの再開用に、現在のセッションの位置だけを保存する（語ごとの正誤とは別枠）
  function saveSession() {
    const s = state.session;
    if (!s) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        wordIds: s.queue.map(w => w.id),
        idx: s.idx,
        correctCount: s.correctCount,
        wrongIds: s.wrongIds,
        wrongLog: s.wrongLog.map(entry => ({ wordId: entry.word.id, picked: entry.picked })),
        title: s.title,
        kind: s.kind,
        setIndex: s.setIndex,
        cycleRound: s.cycleRound,
      }));
    } catch (e) { /* ignore */ }
  }
  function clearSavedSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  // 保存されたセッションを読み込む。単語データと整合しない場合は再開不可としてnullを返す
  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.kind === "cycleRandom") {
        clearSavedSession();
        return null;
      }
      const queue = data.wordIds.map(id => state.words.find(w => w.id === id));
      const finished = data.idx >= queue.length && !data.wrongLog.length; // 全問終了後の一瞬だけ残りうる状態
      if (!queue.length || queue.includes(undefined) || finished) return null;
      const wrongLog = data.wrongLog
        .map(entry => {
          const word = state.words.find(w => w.id === entry.wordId);
          return word ? { word, picked: entry.picked } : null;
        })
        .filter(Boolean);
      return {
        queue,
        idx: data.idx,
        correctCount: data.correctCount,
        wrongIds: data.wrongIds,
        wrongLog,
        title: data.title,
        kind: data.kind,
        setIndex: Number.isInteger(data.setIndex) ? data.setIndex : null,
        cycleRound: Number.isInteger(data.cycleRound) ? data.cycleRound : null,
      };
    } catch (e) { return null; }
  }

  function resetCoreSelectionStateIfNeeded() {
    const selectionVersion = coreSelectionVersion();
    const sharedMeta = state.progress[PROGRESS_META_KEY];
    if (!sharedMeta || sharedMeta.coreSelectionVersion === selectionVersion) return;
    const nextMeta = { ...sharedMeta, coreSelectionVersion: selectionVersion };
    delete nextMeta.setsCompleted;
    delete nextMeta.gateCleared;
    delete nextMeta.gateAttempts;
    delete nextMeta.gateLastScore;
    delete nextMeta.gateLastTotal;
    delete nextMeta.cycle;
    state.progress[PROGRESS_META_KEY] = nextMeta;
  }

  function loadSetProgress() {
    resetCoreSelectionStateIfNeeded();
    const total = buildCoreSets().length;
    const sharedMeta = state.progress[PROGRESS_META_KEY];
    const selectionVersion = coreSelectionVersion();
    if (sharedMeta
      && sharedMeta.coreSelectionVersion === selectionVersion
      && Number.isInteger(sharedMeta.setsCompleted)) {
      return { completed: Math.min(total, Math.max(0, sharedMeta.setsCompleted)) };
    }
    try {
      if (!(cloud && cloud.isEnabled())) {
        const raw = localStorage.getItem(SET_PROGRESS_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.selectionVersion === selectionVersion && Number.isInteger(data.completed)) {
            return { completed: Math.min(total, Math.max(0, data.completed)) };
          }
        }
      }
    } catch (e) { /* ignore */ }

    // 旧版の語ごとの正答記録から、連続して完了済みのセットだけを引き継ぐ。
    const sets = buildCoreSets();
    let completed = 0;
    for (const words of sets) {
      if (!words.length || words.some(w => !isCoreMastered(w.id))) break;
      completed += 1;
    }
    saveSetProgress(completed);
    return { completed };
  }
  function saveSetProgress(completed) {
    const selectionVersion = coreSelectionVersion();
    try { localStorage.setItem(SET_PROGRESS_KEY, JSON.stringify({ completed, selectionVersion })); }
    catch (e) { /* ignore */ }
    state.progress[PROGRESS_META_KEY] = {
      ...(state.progress[PROGRESS_META_KEY] || {}),
      setsCompleted: completed,
      coreSelectionVersion: selectionVersion,
    };
    saveProgress();
  }
  function loadGateStatus() {
    resetCoreSelectionStateIfNeeded();
    const sharedMeta = state.progress[PROGRESS_META_KEY];
    const selectionVersion = coreSelectionVersion();
    if (sharedMeta
      && sharedMeta.coreSelectionVersion === selectionVersion
      && typeof sharedMeta.gateCleared === "boolean") {
      return {
        cleared: sharedMeta.gateCleared,
        attempts: Number.isInteger(sharedMeta.gateAttempts) ? sharedMeta.gateAttempts : 0,
        lastScore: Number.isInteger(sharedMeta.gateLastScore) ? sharedMeta.gateLastScore : null,
        lastTotal: Number.isInteger(sharedMeta.gateLastTotal) ? sharedMeta.gateLastTotal : null,
      };
    }
    try {
      if (!(cloud && cloud.isEnabled())) {
        const raw = localStorage.getItem(GATE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.selectionVersion === selectionVersion) {
            return {
              cleared: data.cleared === true,
              attempts: Number.isInteger(data.attempts) ? data.attempts : 0,
              lastScore: Number.isInteger(data.lastScore) ? data.lastScore : null,
              lastTotal: Number.isInteger(data.lastTotal) ? data.lastTotal : null,
            };
          }
        }
      }
    } catch (e) { /* ignore */ }
    return { cleared: false, attempts: 0, lastScore: null, lastTotal: null };
  }
  function saveGateStatus(status) {
    const selectionVersion = coreSelectionVersion();
    try { localStorage.setItem(GATE_KEY, JSON.stringify({ ...status, selectionVersion })); }
    catch (e) { /* ignore */ }
    state.progress[PROGRESS_META_KEY] = {
      ...(state.progress[PROGRESS_META_KEY] || {}),
      gateCleared: status.cleared,
      gateAttempts: status.attempts,
      gateLastScore: status.lastScore,
      gateLastTotal: status.lastTotal,
      coreSelectionVersion: selectionVersion,
    };
    saveProgress();
  }

  /* ---------- 累積出題サイクル ---------- */
  function defaultCycleState() {
    return {
      version: 1,
      pendingCumulativeSet: null,
      practiceHistory: [],
    };
  }

  function loadCycleState() {
    resetCoreSelectionStateIfNeeded();
    const sharedMeta = state.progress[PROGRESS_META_KEY];
    const saved = sharedMeta && sharedMeta.cycle;
    if (saved
      && saved.version === 1
      && sharedMeta.coreSelectionVersion === coreSelectionVersion()) {
      return {
        ...defaultCycleState(),
        ...saved,
        pendingCumulativeSet: Number.isInteger(saved.pendingCumulativeSet) ? saved.pendingCumulativeSet : null,
        practiceHistory: Array.isArray(saved.practiceHistory) ? saved.practiceHistory : [],
      };
    }

    // 既存利用者は、過去に完了したセットを再要求せず、新しいサイクルから続けられるようにする。
    const completed = loadSetProgress().completed;
    const migrated = { ...defaultCycleState() };
    saveCycleState(migrated);
    return migrated;
  }

  function saveCycleState(cycle) {
    state.progress[PROGRESS_META_KEY] = {
      ...(state.progress[PROGRESS_META_KEY] || {}),
      cycle: cycle || defaultCycleState(),
      coreSelectionVersion: coreSelectionVersion(),
    };
    saveProgress();
  }

  function cycleFocusPlan(setInfo) {
    const cycle = loadCycleState();
    if (Number.isInteger(cycle.pendingCumulativeSet)) {
      const end = Math.min(setInfo.completed, cycle.pendingCumulativeSet + 1);
      const words = buildCoreSets().slice(0, end).flat();
      if (words.length) {
        return {
          kind: "cycleCumulative",
          words,
          title: `累積練習・セット${cycle.pendingCumulativeSet + 1}まで`,
          cta: `${Math.min(CYCLE_SESSION_SIZE, words.length)}問の累積練習をする`,
          setIndex: cycle.pendingCumulativeSet,
        };
      }
    }

    return null;
  }

  /* ============================================================
     cloud sync（生徒別・共有URL ?s=&t=）— harness/cloud.js を利用
     共通スキーマ app_students / app_progress（app="kobun-vocab"）。
     config.json が無ければ no-op で、従来どおり匿名ローカル動作（無回帰）。
     進捗は語ごとの { correct, wrong } マップを保存し、セット／確認テスト状態は
     予約キー __kobunStage1 に同居させる（共有URLでも生徒別に同期するため）。
     ============================================================ */
  function setShareStatus(message, tone = "") {
    const slot = el("shareStatus");
    if (!slot) return;
    slot.textContent = message || "";
    slot.className = "shareStatus" + (tone ? " " + tone : "");
  }
  // クラウドから来た進捗を localStorage へ静かに反映（cloudエコー保存を避ける）
  function applyCloudProgress(p) {
    if (!p || typeof p !== "object") return;
    state.progress = p;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.progress)); }
    catch (e) { /* ignore */ }
  }
  function applySharedUi() {
    const enabled = !!(cloud && cloud.isEnabled());
    document.body.classList.toggle("sharedMode", enabled);
    const resetBtn = el("resetBtn");
    if (resetBtn) resetBtn.classList.toggle("hide", enabled);
  }
  function statOf(id) {
    return state.progress[id] || { correct: 0, wrong: 0 };
  }
  function isMastered(id) {
    return statOf(id).correct >= 2; // 2回連続でなく累計2回正解で習得扱い
  }

  function isCoreMastered(id) {
    return statOf(id).correct >= CORE_MASTERY_REQUIRED;
  }

  /* ---------- utils ---------- */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function el(id) { return document.getElementById(id); }
  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function progressSummary(words = state.words, masteryCheck = masteryForId) {
    const total = words.length;
    const mastered = words.filter(w => masteryCheck(w.id)).length;
    const attempted = words.filter(w => {
      const s = statOf(w.id);
      return s.correct + s.wrong > 0;
    }).length;
    const weak = words.filter(w => {
      const s = statOf(w.id);
      return s.wrong > 0 && !masteryCheck(w.id);
    }).length;
    return { total, mastered, attempted, weak, remaining: Math.max(0, total - mastered) };
  }
  function coreSelectionVersion() {
    const version = Number(state.meta.core && state.meta.core.selectionVersion);
    return Number.isInteger(version) && version > 0 ? version : 1;
  }
  function coreWords() {
    const spec = state.meta.core || {};
    if (Array.isArray(spec.ids)) {
      const ids = new Set(spec.ids);
      return state.words.filter(w => ids.has(w.id));
    }
    const start = Number.isInteger(spec.idStart) ? spec.idStart : 1;
    const end = Number.isInteger(spec.idEnd) ? spec.idEnd : 200;
    return state.words.filter(w => w.id >= start && w.id <= end);
  }
  function isCoreId(id) {
    const spec = state.meta.core || {};
    if (Array.isArray(spec.ids)) return spec.ids.includes(id);
    const start = Number.isInteger(spec.idStart) ? spec.idStart : 1;
    const end = Number.isInteger(spec.idEnd) ? spec.idEnd : 200;
    return id >= start && id <= end;
  }
  function masteryForId(id) {
    return isCoreId(id) ? isCoreMastered(id) : isMastered(id);
  }
  function coreLabel() {
    const spec = state.meta.core || {};
    return spec.label || `コア${coreWords().length}語`;
  }
  function coreSetSize() {
    const spec = state.meta.core || {};
    return Number.isInteger(spec.setSize) && spec.setSize > 0 ? spec.setSize : SESSION_SIZE;
  }
  function gateQuestionCount() {
    const spec = state.meta.core || {};
    return Number.isInteger(spec.gateQuestions) && spec.gateQuestions > 0 ? spec.gateQuestions : GATE_SIZE;
  }
  function gatePassRate() {
    const spec = state.meta.core || {};
    return typeof spec.gatePassRate === "number" ? spec.gatePassRate : GATE_PASS_RATE;
  }
  function gatePassCount() {
    return Math.ceil(gateQuestionCount() * gatePassRate());
  }
  function buildCoreSets() {
    const core = coreWords();
    const size = coreSetSize();
    const sets = [];
    for (let i = 0; i < core.length; i += size) sets.push(core.slice(i, i + size));
    return sets;
  }
  function coreSetInfo() {
    const sets = buildCoreSets();
    const setProgress = loadSetProgress();
    const currentIndex = Math.min(setProgress.completed, Math.max(0, sets.length - 1));
    return {
      sets,
      index: currentIndex,
      words: sets[currentIndex] || [],
      completed: setProgress.completed,
      complete: setProgress.completed >= sets.length,
    };
  }
  function supplementalWords() {
    const coreIds = new Set(coreWords().map(w => w.id));
    return state.words.filter(w => !coreIds.has(w.id));
  }
  function focusPlan() {
    const set = coreSetInfo();
    const cycle = cycleFocusPlan(set);
    if (cycle) return cycle;
    if (!set.complete) {
      const setNumber = set.index + 1;
      return {
        words: set.words,
        title: `${coreLabel()}・セット${setNumber}/${set.sets.length}`,
        cta: `セット${setNumber}/${set.sets.length}を続ける`,
        complete: false,
        kind: "coreSet",
        setNumber,
        setTotal: set.sets.length,
        setIndex: set.index,
      };
    }
    const gate = loadGateStatus();
    if (!gate.cleared) {
      return {
        words: [],
        title: "段階1確認テスト",
        cta: `${gateQuestionCount()}問の確認テストを始める`,
        complete: false,
        kind: "gate",
        setTotal: set.sets.length,
        gateQuestions: gateQuestionCount(),
        gatePassCount: gatePassCount(),
      };
    }
    return {
      words: [],
      title: "古典文法",
      cta: "古典文法へ進む",
      complete: true,
      kind: "grammar",
      setTotal: set.sets.length,
    };
  }
  function stage1Status() {
    const progress = progressSummary(coreWords(), isCoreMastered);
    const sets = coreSetInfo();
    const gate = loadGateStatus();
    return {
      total: progress.total,
      mastered: progress.mastered,
      remaining: progress.remaining,
      setsCompleted: sets.completed,
      setsTotal: sets.sets.length,
      gate,
      complete: gate.cleared,
    };
  }
  function notifyStageStatusChanged() {
    if (typeof renderAppNav === "function") renderAppNav();
  }
  function showStageGate() {
    const status = stage1Status();
    const gateHint = status.setsCompleted < status.setsTotal
      ? `まず${status.setsTotal}セット（1セット${SESSION_SIZE}問）を終えてください。`
      : `${coreLabel()}から${gateQuestionCount()}問の確認テストで${gatePassCount()}問以上正解すると、古典文法へ進めます。`;
    state.session = null;
    el("sessionPanel").classList.add("hide");
    el("sessionPanel").innerHTML = "";
    const home = el("homePanel");
    home.classList.remove("hide");
    home.innerHTML = `
      <section class="card hero">
        <p class="label">STAGE 2 / GRAMMAR</p>
        <h2>文法は、単語のあとに進みます</h2>
        <p class="hint">${gateHint}</p>
      </section>
      <section class="card">
        <p class="label">段階1の終了条件</p>
        <p class="resultText">セット ${status.setsCompleted} / ${status.setsTotal}。${status.gate.cleared ? `確認テスト ${status.gate.lastScore}/${status.gate.lastTotal} で合格済みです。` : `習得の参考値 ${status.mastered} / ${status.total}。`}</p>
        <div class="actions">
          <button class="cta" id="returnToStage1" type="button">段階1の単語へ戻る</button>
        </div>
      </section>
    `;
    el("returnToStage1").addEventListener("click", renderHome);
  }
  function firstUnmastered(words) {
    return words.filter(w => !masteryForId(w.id));
  }
  function takeForSession(words, limit) {
    return shuffle(words).slice(0, Math.min(limit, words.length));
  }
  function sessionTitle(words, fallback) {
    if (!words.length) return fallback;
    const chapters = new Set(words.map(w => w.chapter || "その他"));
    if (chapters.size === 1) return [...chapters][0];
    return fallback;
  }
  function startGateSession() {
    startSession(
      takeForSession(coreWords(), gateQuestionCount()),
      "段階1確認テスト",
      { kind: "gate" },
    );
  }
  function startFocusSession(focus) {
    if (focus.kind === "grammar") {
      if (typeof switchApp === "function") switchApp("grammar");
      return;
    }
    if (focus.kind === "gate") {
      startGateSession();
      return;
    }
    if (focus.kind === "cycleCumulative") {
      startSession(
        takeForSession(focus.words, CYCLE_SESSION_SIZE),
        focus.title,
        {
          kind: focus.kind,
          setIndex: Number.isInteger(focus.setIndex) ? focus.setIndex : null,
          cycleRound: Number.isInteger(focus.cycleRound) ? focus.cycleRound : null,
        },
      );
      return;
    }
    const pool = focus.words.length ? focus.words : coreWords();
    const limit = focus.kind === "coreSet" ? coreSetSize() : SESSION_SIZE;
    startSession(
      takeForSession(pool, limit),
      focus.title,
      { kind: focus.kind, setIndex: focus.setIndex },
    );
  }

  /* ---------- 選択肢生成 ---------- */
  function representativeMeaning(word) {
    const key = Number.isInteger(word.keyMeaning) && word.keyMeaning >= 0 && word.keyMeaning < word.meanings.length
      ? word.keyMeaning
      : 0;
    return word.meanings[key] || word.meanings[0] || "";
  }

  // 正解語 word に対する4択（意味）を作る。
  function buildChoices(word) {
    // keyMeaning が指定された語は、入試で問われる語義を正解にする（未指定なら先頭）。
    const correct = representativeMeaning(word);
    // 正解語のいずれかの意味と重複しないダミーを他語から集める
    const ownSet = new Set(word.meanings);
    const pool = [];
    for (const w of state.words) {
      if (w.id === word.id) continue;
      for (const m of w.meanings) {
        if (!ownSet.has(m)) pool.push(m);
      }
    }
    const distractors = [];
    const used = new Set([correct]);
    for (const m of shuffle(pool)) {
      if (used.has(m)) continue;
      used.add(m);
      distractors.push(m);
      if (distractors.length >= 3) break;
    }
    const choices = shuffle([correct, ...distractors]);
    return { choices, answerIndex: choices.indexOf(correct) };
  }

  /* ---------- ホーム画面 ---------- */
  function renderHome() {
    state.session = null;
    el("sessionPanel").classList.add("hide");
    const home = el("homePanel");
    home.classList.remove("hide");

    const core = coreWords();
    const coreProgress = progressSummary(core, isCoreMastered);
    const extraProgress = progressSummary(supplementalWords());
    const weak = core.filter(w => {
      const s = statOf(w.id);
      return s.wrong > 0 && !isCoreMastered(w.id);
    });
    const chapters = chapterGroups();
    const chapterEntries = [{ name: "すべての章", words: state.words, isAll: true }, ...chapters];
    const { min: idMin, max: idMax } = idBounds();
    const savedRange = loadRange();
    const rangeStart = clampInt(savedRange && savedRange.start, idMin, idMax, idMin);
    const rangeEnd = clampInt(savedRange && savedRange.end, idMin, idMax, idMax);
    const focus = focusPlan();
    const setInfo = coreSetInfo();
    const gateStatus = loadGateStatus();
    const sharedMode = !!(cloud && cloud.isEnabled());
    const savedSession = loadSavedSession();
    const heroTitle = focus.kind === "coreSet"
      ? `${coreLabel()}を10セットで進める`
      : focus.kind === "cycleCumulative"
        ? focus.title
        : focus.kind === "gate"
          ? `最後に${gateQuestionCount()}問の確認テスト`
          : `${coreLabel()}を完了しました`;
    const heroTag = focus.kind === "coreSet"
      ? `おすすめ・${SESSION_SIZE}問`
      : focus.kind === "cycleCumulative"
        ? "途中は練習"
        : focus.kind === "gate"
          ? `仕上げ・${gateQuestionCount()}問`
          : "段階1の次";
    const heroHint = focus.kind === "coreSet"
      ? `古語 → 現代語訳の4択。必須${coreProgress.total}語を${focus.setTotal}セットに分け、1セット${SESSION_SIZE}問で進めます。誤答があってもセットは${SESSION_SIZE}問で終了し、次のセットへ進みます。`
      : focus.kind === "cycleCumulative"
        ? `セット${focus.setIndex + 1}までの既習範囲から出題します。点数は練習記録で、確認テストの合否には影響しません。`
        : focus.kind === "gate"
          ? `${setInfo.sets.length}セット完了後、${coreLabel()}から${gateQuestionCount()}問をランダム出題します。${gatePassCount()}問以上（${Math.round(gatePassRate() * 100)}%以上）で古典文法へ進めます。`
          : `確認テストに合格済みです。古典文法へ進めます。追加${extraProgress.total}語は補助練習として残っています。`;
    const progressHint = setInfo.completed < setInfo.sets.length
      ? `必須語の現在地：セット${setInfo.completed + 1}/${setInfo.sets.length}`
      : gateStatus.cleared
        ? `必須語の現在地：確認テスト合格済み（${gateStatus.lastScore}/${gateStatus.lastTotal}）`
        : "必須語の現在地：10セット完了・確認テスト待ち";

    home.innerHTML = `
      ${savedSession ? `
      <section class="card">
        <p class="label">Resume</p>
        <h2>前回の続きがあります</h2>
        <p class="hint">${esc(savedSession.title)}・${Math.min(savedSession.idx, savedSession.queue.length)}/${savedSession.queue.length}問まで完了${savedSession.idx < savedSession.queue.length ? `・次は「${esc(savedSession.queue[savedSession.idx].kana)}」` : ""}</p>
        <div class="actions">
          <button class="cta" id="resumeSessionBtn" type="button">続きから再開する</button>
          <button class="ghost smallGhost" id="discardSessionBtn" type="button">破棄して新しく始める</button>
        </div>
      </section>` : ""}

      <section class="card hero">
        <p class="label">Kobun Vocabulary ・ 段階1</p>
        <h2>${heroTitle}</h2>
        <button class="cta primaryCta" id="startToday" type="button">
          <span class="ctaTag">${heroTag}</span>
          <span class="ctaMain">${esc(focus.cta)}</span>
        </button>
        <p class="hint">${heroHint}</p>
      </section>

      <section class="card">
        <p class="label">段階1の進捗</p>
        <div class="statGrid">
          <div class="statCell">
            <div class="statNum">${coreProgress.mastered}<small>/${coreProgress.total}</small></div>
            <div class="statCaption">MASTERED・習得</div>
          </div>
          <div class="statCell">
            <div class="statNum">${coreProgress.attempted}<small>/${coreProgress.total}</small></div>
            <div class="statCaption">STARTED・着手</div>
          </div>
          <div class="statCell">
            <div class="statNum">${weak.length}</div>
            <div class="statCaption">WEAK・要復習</div>
          </div>
        </div>
        <div class="masteryBar" aria-label="${coreLabel()}の習得率 ${coreProgress.mastered}/${coreProgress.total}">
          <div class="masteryFill" style="width:${coreProgress.total ? Math.round((coreProgress.mastered / coreProgress.total) * 100) : 0}%"></div>
        </div>
        ${weak.length ? `
        <div class="actions">
          <button class="cta reviewCta" id="startWeak" type="button">間違えた${weak.length}語を復習する</button>
        </div>` : ""}
        <p class="hint">${progressHint}。習得の参考値 ${coreProgress.mastered}/${coreProgress.total}。追加語は${extraProgress.mastered}/${extraProgress.total}語を習得。</p>
      </section>

      <section class="card">
        <details class="chapterDetails">
          <summary class="label">補助：章から選ぶ（全${chapters.length}章）</summary>
          <div class="chapterList">
            ${chapterEntries.map((c, i) => {
              const cp = progressSummary(c.words);
              const pct = cp.total ? Math.round((cp.mastered / cp.total) * 100) : 0;
              return `<button class="chapterBtn${c.isAll ? " chapterBtnAll" : ""}" data-ci="${i}" type="button">
                <span class="chapterMain">
                  <span class="chapterName">${esc(c.name)}</span>
                  <span class="chapterMiniBar"><span style="width:${pct}%"></span></span>
                </span>
                <span class="chapterStat">${cp.mastered}/${cp.total} 習得</span>
              </button>`;
            }).join("")}
          </div>
        </details>
      </section>

      <section class="card">
        <details class="chapterDetails">
          <summary class="label">補助：単語番号で選ぶ（${idMin}〜${idMax}）</summary>
          <div class="rangePicker">
            <div class="rangeRow">
              <label class="rangeField">
                <span class="rangeFieldLabel">開始</span>
                <input type="number" id="rangeStartInput" min="${idMin}" max="${idMax}" value="${rangeStart}">
              </label>
              <span class="rangeSep">〜</span>
              <label class="rangeField">
                <span class="rangeFieldLabel">終了</span>
                <input type="number" id="rangeEndInput" min="${idMin}" max="${idMax}" value="${rangeEnd}">
              </label>
            </div>
            <p class="hint" id="rangeSummary"></p>
            <div class="actions">
              <button class="cta" id="startRange" type="button">この範囲を演習する</button>
            </div>
          </div>
        </details>
      </section>

      ${sharedMode ? "" : `
      <section class="card">
        <details class="moreDetails">
          <summary class="label">データ管理</summary>
          <div class="actions">
            <button class="ghost destructive" id="resetBtn" type="button">単語の進捗をすべて削除</button>
          </div>
        </details>
      </section>`}
    `;

    if (savedSession) {
      el("resumeSessionBtn").addEventListener("click", () => resumeSession(savedSession));
      el("discardSessionBtn").addEventListener("click", () => {
        clearSavedSession();
        renderHome();
      });
    }
    el("startToday").addEventListener("click", () => {
      startFocusSession(focus);
    });
    if (weak.length) {
      el("startWeak").addEventListener("click", () => startSession(takeForSession(weak, SESSION_SIZE), "間違えた語を復習"));
    }
    document.querySelectorAll(".chapterBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const c = chapterEntries[parseInt(btn.dataset.ci, 10)];
        if (c && c.words.length) {
          const pool = firstUnmastered(c.words);
          startSession(takeForSession(pool.length ? pool : c.words, SESSION_SIZE), c.name);
        }
      });
    });
    const startInput = el("rangeStartInput");
    const endInput = el("rangeEndInput");
    const rangeBtn = el("startRange");
    const rangeSummary = el("rangeSummary");
    function refreshRangeSummary() {
      const s = clampInt(startInput.value, idMin, idMax, idMin);
      const e = clampInt(endInput.value, idMin, idMax, idMax);
      const lo = Math.min(s, e);
      const hi = Math.max(s, e);
      const words = wordsInRange(lo, hi);
      const sp = progressSummary(words);
      rangeSummary.textContent = words.length
        ? `${lo}〜${hi} ・ ${sp.total}語中 ${sp.mastered}語習得`
        : `${lo}〜${hi} には単語がありません`;
      rangeBtn.disabled = !words.length;
    }
    startInput.addEventListener("input", refreshRangeSummary);
    endInput.addEventListener("input", refreshRangeSummary);
    refreshRangeSummary();
    rangeBtn.addEventListener("click", () => {
      const s = clampInt(startInput.value, idMin, idMax, idMin);
      const e = clampInt(endInput.value, idMin, idMax, idMax);
      const lo = Math.min(s, e);
      const hi = Math.max(s, e);
      const words = wordsInRange(lo, hi);
      if (!words.length) return;
      saveRange(lo, hi);
      const pool = firstUnmastered(words);
      startSession(takeForSession(pool.length ? pool : words, SESSION_SIZE), `単語${lo}〜${hi}`);
    });
    if (!sharedMode) {
      el("resetBtn").addEventListener("click", () => {
        if (confirm("すべての進捗（正答・誤答の記録）を削除しますか？")) {
          state.progress = {};
          saveProgress();
          clearSavedSession();
          try { localStorage.removeItem(SET_PROGRESS_KEY); } catch (e) { /* ignore */ }
          try { localStorage.removeItem(GATE_KEY); } catch (e) { /* ignore */ }
          renderHome();
        }
      });
    }
    notifyStageStatusChanged();
  }

  // id の最小・最大（単語番号の範囲指定に使う）
  function idBounds() {
    let min = Infinity, max = -Infinity;
    for (const w of state.words) {
      if (w.id < min) min = w.id;
      if (w.id > max) max = w.id;
    }
    if (!state.words.length) { min = 1; max = 1; }
    return { min, max };
  }
  function wordsInRange(start, end) {
    return state.words.filter(w => w.id >= start && w.id <= end);
  }

  // 章ごとに単語をまとめる（出現順を保持）
  function chapterGroups() {
    const order = [];
    const map = new Map();
    for (const w of state.words) {
      const name = w.chapter || "その他";
      if (!map.has(name)) { map.set(name, []); order.push(name); }
      map.get(name).push(w);
    }
    return order.map(name => ({ name, words: map.get(name) }));
  }

  // 苦手 = 誤答が正答を上回る、または未習得で誤答経験あり
  function weakWords() {
    return state.words.filter(w => {
      const s = statOf(w.id);
      return s.wrong > 0 && !masteryForId(w.id);
    });
  }

  /* ---------- 演習セッション ---------- */
  function startSession(words, title = "", options = {}) {
    state.session = {
      queue: shuffle(words),
      idx: 0,
      correctCount: 0,
      wrongIds: [],
      wrongLog: [],
      reviewed: false,
      answered: false,
      title: title || sessionTitle(words, "演習"),
      kind: options.kind || "practice",
      setIndex: Number.isInteger(options.setIndex) ? options.setIndex : null,
      cycleRound: Number.isInteger(options.cycleRound) ? options.cycleRound : null,
    };
    el("homePanel").classList.add("hide");
    el("sessionPanel").classList.remove("hide");
    saveSession();
    renderQuestion();
  }

  // 保存済みセッション（loadSavedSessionの戻り値）から演習画面を復元する
  function resumeSession(saved) {
    state.session = {
      queue: saved.queue,
      idx: saved.idx,
      correctCount: saved.correctCount,
      wrongIds: saved.wrongIds,
      wrongLog: saved.wrongLog,
      reviewed: false,
      answered: false,
      title: saved.title,
      kind: saved.kind || "practice",
      setIndex: Number.isInteger(saved.setIndex) ? saved.setIndex : null,
      cycleRound: Number.isInteger(saved.cycleRound) ? saved.cycleRound : null,
    };
    el("homePanel").classList.add("hide");
    el("sessionPanel").classList.remove("hide");
    renderQuestion();
  }

  function renderQuestion() {
    const s = state.session;
    const panel = el("sessionPanel");

    if (s.idx >= s.queue.length) {
      const reviewRequired = s.kind !== "coreSet" && s.kind !== "gate";
      if (s.wrongLog.length && !s.reviewed && reviewRequired) {
        renderReview();
      } else {
        renderDone();
      }
      return;
    }

    const word = s.queue[s.idx];
    const { choices, answerIndex } = buildChoices(word);
    s.current = { word, choices, answerIndex };
    s.answered = false;

    const num = s.idx + 1;
    const totalQ = s.queue.length;
    const pct = Math.round((s.idx / totalQ) * 100);
    const currentStat = statOf(word.id);

    const kanjiTag = word.kanji ? `<small>（${esc(word.kanji)}）</small>` : "";

    panel.innerHTML = `
      <div class="sessionHead">
        <div class="roundInfo">
          <span>${esc(s.title)}</span>
          <span>Q ${num} / ${totalQ}</span>
          <span class="streak">正解 ${s.correctCount}</span>
        </div>
        <button class="ghost smallGhost" id="quitSession" type="button">演習を中断</button>
        <span class="sessionSaveHint">進捗は保存されます</span>
      </div>
      <div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>

      <section class="quizBox">
        <div class="quizTop">
          <span class="askLabel">意味として最も適切なものは？</span>
          <span class="streak">正${currentStat.correct}／誤${currentStat.wrong}</span>
        </div>
        <p class="askWord">${esc(word.kana)}${kanjiTag}</p>
        <p class="askMeta"><span class="pos">${esc(word.pos)}</span>1〜4のキーで解答／解答後は1〜4またはEnterで次へ</p>

        <div class="choices" id="choices">
          ${choices.map((c, i) => `
            <button class="choiceBtn" data-i="${i}" type="button">
              <span class="key">${i + 1}</span><span class="txt">${esc(c)}</span>
            </button>
          `).join("")}
        </div>

        <div id="feedbackArea"></div>
      </section>
    `;

    el("quitSession").addEventListener("click", () => {
      clearSavedSession();
      renderHome();
    });
    document.querySelectorAll("#choices .choiceBtn").forEach(btn => {
      btn.addEventListener("click", () => selectAnswer(parseInt(btn.dataset.i, 10)));
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectAnswer(i) {
    const s = state.session;
    if (s.answered) return;
    s.answered = true;
    s.answeredAt = Date.now(); // 直後のキー連打で次の問題を誤答しないためのクールダウン基準

    const { word, choices, answerIndex } = s.current;
    const correct = i === answerIndex;

    const stat = statOf(word.id);
    if (correct) { stat.correct += 1; s.correctCount += 1; }
    else {
      stat.wrong += 1;
      if (!s.wrongIds.includes(word.id)) s.wrongIds.push(word.id);
      s.wrongLog.push({ word, picked: choices[i] }); // 復習ステージでまとめて解説する
    }
    state.progress[word.id] = stat;
    saveProgress();
    saveSession();

    // ボタンの色付け＋無効化
    document.querySelectorAll("#choices .choiceBtn").forEach(btn => {
      const bi = parseInt(btn.dataset.i, 10);
      btn.disabled = true;
      if (bi === answerIndex) btn.classList.add("correct");
      else if (bi === i) btn.classList.add("wrong");
    });

    renderFeedback(correct, choices[i]);
  }

  function renderFeedback(correct, picked) {
    const s = state.session;
    const { word } = s.current;
    const last = s.idx === s.queue.length - 1;
    const kanji = word.kanji ? `（${esc(word.kanji)}）` : "";
    const correctMeaning = representativeMeaning(word);
    const owner = !correct && picked ? findOwnerOf(picked, word.id) : null;
    const feedbackArea = el("feedbackArea");

    feedbackArea.innerHTML = `
      <div class="feedback ${correct ? "ok" : "ng"}">
        <h3>${correct ? "正解" : "不正解"}</h3>
        <p class="word">${esc(word.kana)}${kanji} <small>${esc(word.pos)}</small></p>
        ${!correct ? `<p class="answerLine ng"><span class="k">あなたの解答</span>${esc(picked || "")}${owner ? `　→　これは「${esc(owner.kana)}」の意味です` : ""}</p>` : ""}
        <p class="answerLine"><span class="k">正しい代表語義</span>${esc(correctMeaning)}</p>
        <ul>
          ${word.meanings.map(m => `<li>${esc(m)}</li>`).join("")}
        </ul>
        ${word.note ? `<p class="reviewNote"><span class="k">POINT</span>${esc(word.note)}</p>` : ""}
        ${word.example ? `<p class="reviewExample"><span class="k">例文</span><span class="exJp">${esc(word.example.jp)}</span><span class="exYaku">${esc(word.example.yaku)}</span></p>` : ""}
        ${correct ? "" : `<p class="hint">この解説は後の復習画面でも確認できます。</p>`}
      </div>
      <div class="nextRow">
        <button class="cta" id="nextBtn" type="button">${last ? "結果を見る" : "次の問題へ"}</button>
      </div>
    `;
    const nextBtn = el("nextBtn");
    nextBtn.addEventListener("click", nextQuestion);
    nextBtn.focus({ preventScroll: true });
    if (typeof feedbackArea.scrollIntoView === "function") {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      requestAnimationFrame(() => feedbackArea.scrollIntoView({ behavior, block: "start" }));
    }
  }

  function nextQuestion() {
    state.session.idx += 1;
    saveSession();
    renderQuestion();
  }

  // 選んだ意味が本当はどの語の意味だったかを逆引き（混同ペアの可視化）
  function findOwnerOf(meaning, excludeId) {
    return state.words.find(w => w.id !== excludeId && w.meanings.includes(meaning));
  }

  function renderReview() {
    const s = state.session;
    const panel = el("sessionPanel");
    const checked = new Set();

    panel.innerHTML = `
      <div class="sessionHead">
        <div class="roundInfo">
          <span>${esc(s.title)}</span>
          <span>間違えた${s.wrongLog.length}語の復習</span>
        </div>
      </div>
      <section class="quizBox">
        <p class="askLabel">それぞれの語の意味を確認してください。読み終えたら「確認した」を押してください。</p>
        <div class="reviewList">
          ${s.wrongLog.map((entry, i) => {
            const { word, picked } = entry;
            const owner = findOwnerOf(picked, word.id);
            const kanji = word.kanji ? `<small>（${esc(word.kanji)}）</small>` : "";
            return `
            <article class="reviewCard" id="reviewCard${i}">
              <div class="reviewCardHead">
                <p class="word">${esc(word.kana)}${kanji} <small>${esc(word.pos)}</small></p>
                <button class="ghost smallGhost reviewCheckBtn" data-i="${i}" type="button">確認した</button>
              </div>
              <ul>
                ${word.meanings.map(m => `<li>${esc(m)}</li>`).join("")}
              </ul>
              <p class="answerLine"><span class="k">正しい代表語義</span>${esc(representativeMeaning(word))}</p>
              ${word.note ? `<p class="reviewNote"><span class="k">POINT</span>${esc(word.note)}</p>` : ""}
              ${word.example ? `<p class="reviewExample"><span class="k">例文</span><span class="exJp">${esc(word.example.jp)}</span><span class="exYaku">${esc(word.example.yaku)}</span></p>` : ""}
              <p class="answerLine ng"><span class="k">選んだ意味</span>${esc(picked)}${owner ? `　→　これは「${esc(owner.kana)}」の意味です` : ""}</p>
            </article>`;
          }).join("")}
        </div>
        <div class="nextRow">
          <p class="hint" id="reviewCountHint">残り${s.wrongLog.length}語</p>
          <button class="cta" id="reviewDoneBtn" type="button" disabled>結果を見る</button>
        </div>
      </section>
    `;

    const doneBtn = el("reviewDoneBtn");
    const hint = el("reviewCountHint");
    document.querySelectorAll(".reviewCheckBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.i, 10);
        if (checked.has(i)) return;
        checked.add(i);
        btn.disabled = true;
        btn.textContent = "確認済み";
        el("reviewCard" + i).classList.add("reviewCardDone");
        const remaining = s.wrongLog.length - checked.size;
        hint.textContent = remaining > 0 ? `残り${remaining}語` : "すべて確認しました";
        if (checked.size === s.wrongLog.length) doneBtn.disabled = false;
      });
    });
    doneBtn.addEventListener("click", () => {
      s.reviewed = true;
      renderDone();
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function completeCoreSet(setIndex) {
    if (!Number.isInteger(setIndex)) return;
    const total = buildCoreSets().length;
    const current = loadSetProgress().completed;
    const completed = Math.min(total, Math.max(current, setIndex + 1));
    saveSetProgress(completed);
    const cycle = loadCycleState();
    cycle.pendingCumulativeSet = setIndex;
    saveCycleState(cycle);
    notifyStageStatusChanged();
  }

  function recordCyclePractice(session) {
    if (!session || session.kind !== "cycleCumulative") return;
    const cycle = loadCycleState();
    const entry = {
      kind: session.kind,
      setIndex: Number.isInteger(session.setIndex) ? session.setIndex : null,
      round: Number.isInteger(session.cycleRound) ? session.cycleRound : null,
      score: session.correctCount,
      total: session.queue.length,
      completedAt: new Date().toISOString(),
    };
    cycle.practiceHistory = [...cycle.practiceHistory, entry].slice(-30);
    if (session.kind === "cycleCumulative") {
      cycle.pendingCumulativeSet = null;
    }
    saveCycleState(cycle);
  }

  function recordGateResult(session) {
    const previous = loadGateStatus();
    const required = Math.ceil(session.queue.length * gatePassRate());
    const passed = session.correctCount >= required;
    const status = {
      cleared: previous.cleared || passed,
      attempts: previous.attempts + 1,
      lastScore: session.correctCount,
      lastTotal: session.queue.length,
    };
    saveGateStatus(status);
    notifyStageStatusChanged();
    return { passed, required, status };
  }

  function renderGateDone() {
    const s = state.session;
    const result = recordGateResult(s);
    const pct = Math.round((s.correctCount / s.queue.length) * 100);
    const retryText = result.passed
      ? `${coreLabel()}から${s.queue.length}問の確認テストに${s.correctCount}問正解し、${pct}%で合格しました。`
      : `${s.queue.length}問中${s.correctCount}問正解（${pct}%）でした。${result.required}問以上が必要です。`;

    el("sessionPanel").innerHTML = `
      <section class="doneBanner">
        <p class="label" style="color:rgba(255,255,255,.72)">STAGE 1 CHECK</p>
        <div class="big">${s.correctCount} / ${s.queue.length}</div>
        <div class="sub">正答率 ${pct}% ・ ${result.passed ? "合格" : "再挑戦"}</div>
      </section>
      <section class="card">
        <p class="label">${result.passed ? "古典文法へ" : "確認テスト"}</p>
        <p class="resultText">${retryText}</p>
        <div class="actions">
          ${result.passed
            ? `<button class="cta" id="goGrammar" type="button">古典文法へ進む</button>`
            : `<button class="cta" id="retryGate" type="button">${gateQuestionCount()}問をもう一度受ける</button>`}
          <button class="ghost smallGhost" id="backHome" type="button">ホームに戻る</button>
        </div>
      </section>
    `;

    if (result.passed) {
      el("goGrammar").addEventListener("click", () => {
        if (typeof switchApp === "function") switchApp("grammar");
      });
    } else {
      el("retryGate").addEventListener("click", startGateSession);
    }
    el("backHome").addEventListener("click", renderHome);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderDone() {
    clearSavedSession();
    const s = state.session;
    if (s.kind === "gate") {
      renderGateDone();
      return;
    }
    if (s.kind === "coreSet") completeCoreSet(s.setIndex);
    if (s.kind === "cycleCumulative" && !s.cycleRecorded) {
      recordCyclePractice(s);
      s.cycleRecorded = true;
    }
    const total = s.idx;
    const score = s.correctCount;
    const pct = Math.round((score / total) * 100);
    const wrongWords = state.words.filter(w => s.wrongIds.includes(w.id));
    const masteredNow = s.queue.filter(w => masteryForId(w.id)).length;
    const focus = focusPlan();
    const set = coreSetInfo();
    const gate = loadGateStatus();
    const stageMessage = set.completed < set.sets.length
      ? `次はセット${set.completed + 1}/${set.sets.length}です。`
      : gate.cleared
        ? `${coreLabel()}の確認テストに合格しています。`
        : `${set.sets.length}セット完了。次は${gateQuestionCount()}問の確認テストです。`;
    const cycleMessage = s.kind === "cycleCumulative"
      ? "今回の累積練習は記録しました。"
      : "";

    el("sessionPanel").innerHTML = `
      <section class="doneBanner">
        <p class="label" style="color:rgba(255,255,255,.72)">Session Complete</p>
        <div class="big">${score} / ${total}</div>
        <div class="sub">正答率 ${pct}%</div>
      </section>
      <section class="card">
        <p class="label">Next</p>
        <p class="resultText">このセッション内の習得語は${masteredNow}語。${cycleMessage}${stageMessage}${wrongWords.length ? `間違えた語はホームの「間違えた語を復習する」に残ります。` : ""}</p>
        <div class="actions">
          ${wrongWords.length ? `<button class="cta reviewCta" id="retryWrong" type="button">間違えた${wrongWords.length}語をもう一度</button>` : ""}
          <button class="${wrongWords.length ? "ghost inlineGhost" : "cta"}" id="nextTwenty" type="button">${esc(focus.cta)}</button>
          <button class="ghost smallGhost" id="backHome" type="button">ホームに戻る</button>
        </div>
        ${wrongWords.length ? `<div class="wrongList">
          ${wrongWords.map(w => `<span>${esc(w.kana)}</span>`).join("")}
        </div>` : ""}
      </section>
    `;

    if (wrongWords.length) {
      el("retryWrong").addEventListener("click", () => startSession(wrongWords, "間違えた語を復習"));
    }
    el("nextTwenty").addEventListener("click", () => {
      startFocusSession(focus);
    });
    el("backHome").addEventListener("click", renderHome);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- キーボード（1〜4で選択、Enterで次へ。シェルから active 時のみ呼ばれる） ---------- */
  function handleKey(e) {
    const s = state.session;
    if (!s) return;
    if (["1", "2", "3", "4"].includes(e.key)) {
      if (!s.answered && s.current) {
        const i = parseInt(e.key, 10) - 1;
        if (i < s.current.choices.length) selectAnswer(i);
      } else if (s.answered && Date.now() - s.answeredAt >= NEXT_KEY_COOLDOWN_MS) {
        // 解答済みなら数字キーでも次へ（直後の連打は無効化して誤答を防ぐ）
        const btn = el("nextBtn");
        if (btn) btn.click();
      }
    } else if (e.key === "Enter" && s.answered) {
      const btn = el("nextBtn");
      if (btn) btn.click();
    }
  }

  /* ---------- 起動 ---------- */
  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      const data = await res.json();
      state.meta = data.meta || {};
      state.words = (data.words || []).filter(w => w.meanings && w.meanings.length);
      const loadedProgress = loadProgress();
      state.progress = loadedProgress && typeof loadedProgress === "object" && !Array.isArray(loadedProgress)
        ? loadedProgress
        : {};

      // 生徒別クラウド同期（共有URL ?s=&t= があり config.json が揃うときのみ有効）
      cloud = createCloud({
        appId: APP_ID,
        getPayload: () => state.progress,
        applyLoaded: applyCloudProgress,
        onStatus: setShareStatus,
      });
      await cloud.init();
      applySharedUi();

      renderHome();
    } catch (e) {
      el("homePanel").innerHTML = `<section class="card"><p>データの読み込みに失敗しました。</p><p class="hint">${esc(String(e))}</p></section>`;
    }
  }

  async function mount() {
    if (booted) { renderHome(); return; }
    booted = true;
    await boot();
  }

  return { mount, handleKey, isStage1Complete: () => stage1Status().complete, showStageGate };
})();
