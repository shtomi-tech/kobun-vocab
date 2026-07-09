"use strict";

/* ============================================================
   古文単語 4択演習
   出題方向：古語（かな＋漢字＋品詞）→ 意味
   誤答：他語の意味からダミー生成（正解語の意味は除外）
   進捗：localStorage に語ごとの正答数を保存
   ============================================================ */

const VocabApp = (function () {
  const DATA_URL = "data/vocab.json";
  const STORE_KEY = "kobun_vocab_progress_v1";
  const APP_ID = "kobun-vocab";

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

  /* ============================================================
     cloud sync（生徒別・共有URL ?s=&t=）— harness/cloud.js を利用
     共通スキーマ app_students / app_progress（app="kobun-vocab"）。
     config.json が無ければ no-op で、従来どおり匿名ローカル動作（無回帰）。
     進捗は語ごとの { correct, wrong } マップをそのまま1つのjsonbに保存。
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
  function progressSummary(words = state.words) {
    const total = words.length;
    const mastered = words.filter(w => isMastered(w.id)).length;
    const attempted = words.filter(w => {
      const s = statOf(w.id);
      return s.correct + s.wrong > 0;
    }).length;
    const weak = words.filter(w => {
      const s = statOf(w.id);
      return s.wrong > 0 && !isMastered(w.id);
    }).length;
    return { total, mastered, attempted, weak, remaining: Math.max(0, total - mastered) };
  }
  function firstUnmastered(words) {
    return words.filter(w => !isMastered(w.id));
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

  /* ---------- 選択肢生成 ---------- */
  // 正解語 word に対する4択（意味）を作る。
  function buildChoices(word) {
    const correct = word.meanings[0];
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

    const { total, mastered, attempted, remaining } = progressSummary();
    const weak = weakWords();
    const chapters = chapterGroups();
    const chapterEntries = [{ name: "すべての章", words: state.words, isAll: true }, ...chapters];
    const todayPool = firstUnmastered(state.words);
    const todayCount = Math.min(20, todayPool.length || total);
    const sharedMode = !!(cloud && cloud.isEnabled());

    home.innerHTML = `
      <section class="card hero">
        <p class="label">Kobun Vocabulary</p>
        <h2>今日の20語から、408語を着実に回す</h2>
        <button class="cta primaryCta" id="startToday" type="button">
          <span class="ctaTag">おすすめ・約3分</span>
          <span class="ctaMain">今日の20語を始める</span>
        </button>
        <p class="hint">古語 → 現代語訳の4択。2回正解で習得扱い、間違えた語はその場で最後にもう一度出題されます。</p>
      </section>

      <section class="card">
        <p class="label">Progress</p>
        <div class="statGrid">
          <div class="statCell">
            <div class="statNum">${mastered}<small>/${total}</small></div>
            <div class="statCaption">習得（2回正解）</div>
          </div>
          <div class="statCell">
            <div class="statNum">${attempted}<small>/${total}</small></div>
            <div class="statCaption">着手した語</div>
          </div>
          <div class="statCell">
            <div class="statNum">${weak.length}</div>
            <div class="statCaption">要復習</div>
          </div>
        </div>
        <div class="masteryBar" aria-label="習得率 ${mastered}/${total}">
          <div class="masteryFill" style="width:${total ? Math.round((mastered / total) * 100) : 0}%"></div>
        </div>
        ${weak.length ? `
        <div class="actions">
          <button class="cta reviewCta" id="startWeak" type="button">間違えた${weak.length}語を復習する</button>
        </div>` : ""}
        <p class="hint">残り${remaining}語。</p>
      </section>

      <section class="card">
        <details class="chapterDetails">
          <summary class="label">章から選ぶ（全${chapters.length}章）</summary>
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

      ${sharedMode ? "" : `
      <section class="card">
        <details class="moreDetails">
          <summary class="label">その他</summary>
          <div class="actions">
            <button class="ghost" id="resetBtn" type="button">進捗をすべて削除</button>
          </div>
        </details>
      </section>`}
    `;

    el("startToday").addEventListener("click", () => {
      const pool = todayPool.length ? todayPool : state.words;
      startSession(takeForSession(pool, 20), "つづきから20語");
    });
    if (weak.length) {
      el("startWeak").addEventListener("click", () => startSession(weak, "間違えた語を復習"));
    }
    document.querySelectorAll(".chapterBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const c = chapterEntries[parseInt(btn.dataset.ci, 10)];
        if (c && c.words.length) {
          const pool = firstUnmastered(c.words);
          startSession(pool.length ? pool : c.words, c.name);
        }
      });
    });
    if (!sharedMode) {
      el("resetBtn").addEventListener("click", () => {
        if (confirm("すべての進捗（正答・誤答の記録）を削除しますか？")) {
          state.progress = {};
          saveProgress();
          renderHome();
        }
      });
    }
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
      return s.wrong > 0 && !isMastered(w.id);
    });
  }

  /* ---------- 演習セッション ---------- */
  function startSession(words, title = "") {
    state.session = {
      queue: shuffle(words),
      idx: 0,
      correctCount: 0,
      wrongIds: [],
      answered: false,
      title: title || sessionTitle(words, "演習"),
    };
    el("homePanel").classList.add("hide");
    el("sessionPanel").classList.remove("hide");
    renderQuestion();
  }

  function renderQuestion() {
    const s = state.session;
    const panel = el("sessionPanel");

    if (s.idx >= s.queue.length) {
      renderDone();
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
        <button class="ghost smallGhost" id="quitSession" type="button">中断してホームへ</button>
      </div>
      <div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>

      <section class="quizBox">
        <div class="quizTop">
          <span class="askLabel">意味として最も適切なものは？</span>
          <span class="streak">${esc(word.group || "")}　正${currentStat.correct}／誤${currentStat.wrong}</span>
        </div>
        <p class="askWord">${esc(word.kana)}${kanjiTag}</p>
        <p class="askMeta"><span class="pos">${esc(word.pos)}</span>1〜4のキーでも解答できます</p>

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

    el("quitSession").addEventListener("click", renderHome);
    document.querySelectorAll("#choices .choiceBtn").forEach(btn => {
      btn.addEventListener("click", () => selectAnswer(parseInt(btn.dataset.i, 10)));
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectAnswer(i) {
    const s = state.session;
    if (s.answered) return;
    s.answered = true;

    const { word, answerIndex } = s.current;
    const correct = i === answerIndex;

    const stat = statOf(word.id);
    if (correct) { stat.correct += 1; s.correctCount += 1; }
    else {
      stat.wrong += 1;
      if (!s.wrongIds.includes(word.id)) s.wrongIds.push(word.id);
      s.queue.push(word); // 誤答語はこのセッションの最後にもう一度出題する
    }
    state.progress[word.id] = stat;
    saveProgress();

    // ボタンの色付け＋無効化
    document.querySelectorAll("#choices .choiceBtn").forEach(btn => {
      const bi = parseInt(btn.dataset.i, 10);
      btn.disabled = true;
      if (bi === answerIndex) btn.classList.add("correct");
      else if (bi === i) btn.classList.add("wrong");
    });

    renderFeedback(correct);
  }

  function renderFeedback(correct) {
    const s = state.session;
    const { word } = s.current;
    const last = s.idx === s.queue.length - 1;
    const kanji = word.kanji ? `（${esc(word.kanji)}）` : "";

    el("feedbackArea").innerHTML = `
      <div class="feedback ${correct ? "ok" : "ng"}">
        <h3>${correct ? "正解" : "不正解"}</h3>
        <p class="word">${esc(word.kana)}${kanji} <small>${esc(word.pos)}</small></p>
        <ul>
          ${word.meanings.map(m => `<li>${esc(m)}</li>`).join("")}
        </ul>
        ${correct ? "" : `<p class="hint">この語は最後にもう一度出題されます。</p>`}
      </div>
      <div class="nextRow">
        <button class="cta" id="nextBtn" type="button">${last ? "結果を見る" : "次の問題へ"}</button>
      </div>
    `;
    const nextBtn = el("nextBtn");
    nextBtn.addEventListener("click", nextQuestion);
    nextBtn.focus();
  }

  function nextQuestion() {
    state.session.idx += 1;
    renderQuestion();
  }

  function renderDone() {
    const s = state.session;
    const total = s.queue.length;
    const score = s.correctCount;
    const pct = Math.round((score / total) * 100);
    const wrongWords = state.words.filter(w => s.wrongIds.includes(w.id));
    const masteredNow = s.queue.filter(w => isMastered(w.id)).length;

    el("sessionPanel").innerHTML = `
      <section class="doneBanner">
        <p class="label" style="color:rgba(250,249,246,.72)">Session Complete</p>
        <div class="big">${score} / ${total}</div>
        <div class="sub">正答率 ${pct}%</div>
      </section>
      <section class="card">
        <p class="label">Next</p>
        <p class="resultText">このセッション内の習得語は${masteredNow}語。${wrongWords.length ? `間違えた語はホームの「間違えた語を復習する」に残ります。` : ""}</p>
        <div class="actions">
          ${wrongWords.length ? `<button class="cta reviewCta" id="retryWrong" type="button">間違えた${wrongWords.length}語をもう一度</button>` : ""}
          <button class="${wrongWords.length ? "ghost inlineGhost" : "cta"}" id="nextTwenty" type="button">つづきから20語</button>
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
      const pool = firstUnmastered(state.words);
      startSession(takeForSession(pool.length ? pool : state.words, 20), "つづきから20語");
    });
    el("backHome").addEventListener("click", renderHome);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- キーボード ---------- */
  document.addEventListener("keydown", (e) => {
    if (!VocabApp.isActive()) return;
    const s = state.session;
    if (!s) return;
    if (["1", "2", "3", "4"].includes(e.key)) {
      if (!s.answered && s.current) {
        const i = parseInt(e.key, 10) - 1;
        if (i < s.current.choices.length) selectAnswer(i);
      }
    } else if (e.key === "Enter" && s.answered) {
      const btn = el("nextBtn");
      if (btn) btn.click();
    }
  });

  /* ---------- 起動 ---------- */
  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      const data = await res.json();
      state.meta = data.meta || {};
      state.words = (data.words || []).filter(w => w.meanings && w.meanings.length);
      state.progress = loadProgress();

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

  let active = false;
  async function mount() {
    active = true;
    if (booted) { renderHome(); return; }
    booted = true;
    await boot();
  }
  function unmount() {
    active = false;
  }

  return { mount, unmount, isActive: () => active };
})();
