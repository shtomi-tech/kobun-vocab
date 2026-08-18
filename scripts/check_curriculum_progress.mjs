#!/usr/bin/env node
// static/mode-katsuyo.js の講・章単位の進捗集計（lessonStatus/chapterStatus/firstIncompleteLesson）と、
// 旧進捗（kobun-katsuyo-progress-v2）から46講版lessonCycles（kobun-katsuyo-path-v2）への移行
// （migrateLessonProgress、boot()内で毎回呼ばれる）を、scripts/fixtures/curriculum-progress/ の
// 固定fixtureに対して検証する回帰テスト。
//
// mode-katsuyo.js はブラウザ向けIIFE（グローバルKatsuyoAppを1つだけ公開）なので、
// document/localStorage/fetch/window を最小限にスタブしたNodeのvmコンテキストへ
// 実ファイルをそのまま読み込んで実行する（ロジックの複製・再実装はしない）。
// KatsuyoApp.__test（lessonStatus/chapterStatus/firstIncompleteLesson/taskCheckedIds）は
// このテストとブラウザconsoleからのデバッグ用に mode-katsuyo.js 側で公開している。
//
// 実行: node scripts/check_curriculum_progress.mjs
// python scripts/check_curriculum_progress.py から subprocess 経由で呼ばれる想定。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "scripts", "fixtures", "curriculum-progress");
const STORE_KEY = "kobun-katsuyo-progress-v2";
const PATH_STORE_KEY = "kobun-katsuyo-path-v2";
const CURRICULUM_VERSION = "textbook-46-v1";

let passCount = 0;
let failCount = 0;
const failures = [];

function check(label, cond) {
  if (cond) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(label);
    console.log("FAIL: " + label);
  }
}

/* ---------- Node vmコンテキストでmode-katsuyo.jsをそのまま動かす最小ハーネス ---------- */
function fetchStub(url) {
  const clean = String(url).split("?")[0];
  const filePath = path.join(ROOT, clean);
  return Promise.resolve().then(() => {
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
    const text = fs.readFileSync(filePath, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  });
}

function fakeElement() {
  return {
    classList: { add() {}, remove() {}, contains: () => false },
    innerHTML: "",
    style: {},
    appendChild() {},
    removeChild() {},
    querySelectorAll: () => [],
    addEventListener() {},
  };
}

function makeLocalStorage(seed) {
  const store = Object.assign({}, seed);
  return {
    store,
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
}

// seed: { [localStorageKey]: rawStringValue }
function createHarness(seed) {
  const localStorage = makeLocalStorage(seed);
  const sandbox = {
    console,
    localStorage,
    fetch: fetchStub,
    document: {
      getElementById: () => fakeElement(),
      createElement: () => fakeElement(),
      createTextNode: () => ({}),
    },
    window: { location: { search: "" } },
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  const cloudSrc = fs.readFileSync(path.join(ROOT, "static/vendor/harness/cloud.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "static/mode-katsuyo.js"), "utf8");
  vm.runInContext(cloudSrc, context, { filename: "static/vendor/harness/cloud.js" });
  vm.runInContext(appSrc, context, { filename: "static/mode-katsuyo.js" });
  vm.runInContext("this.__KatsuyoApp = KatsuyoApp;", context, { filename: "capture.js" });
  return { context, localStorage, app: context.__KatsuyoApp };
}

/* ---------- fixture読み込み（生テキストのまま。壊れたJSONもそのまま渡す） ---------- */
function readFixtureText(name) {
  const filePath = path.join(FIXTURES_DIR, name);
  return fs.readFileSync(filePath, "utf8");
}

function loadFixtureSeed(prefix, { withExtraKeys = false } = {}) {
  const seed = {
    [STORE_KEY]: readFixtureText(prefix + ".progress.json"),
    [PATH_STORE_KEY]: readFixtureText(prefix + ".path.json"),
  };
  if (withExtraKeys) {
    const extraPath = path.join(FIXTURES_DIR, prefix + ".extra-keys.json");
    if (fs.existsSync(extraPath)) {
      const extra = JSON.parse(fs.readFileSync(extraPath, "utf8"));
      Object.assign(seed, extra);
    }
  }
  return seed;
}

function parsePathState(localStorage) {
  try {
    return JSON.parse(localStorage.getItem(PATH_STORE_KEY) || "{}");
  } catch (_e) {
    return null;
  }
}

function findLesson(curriculum, lessonId) {
  for (const chapter of curriculum.chapters) {
    const lesson = chapter.lessons.find(l => l.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}
function findChapter(curriculum, chapterId) {
  return curriculum.chapters.find(c => c.id === chapterId) || null;
}

function findTask(curriculum, taskId) {
  for (const chapter of curriculum.chapters) {
    for (const lesson of chapter.lessons) {
      const task = lesson.requiredActivities.find(activity => activity.id === taskId);
      if (task) return task;
    }
  }
  return null;
}

const curriculum = JSON.parse(fs.readFileSync(path.join(ROOT, "data/curriculum.json"), "utf8"));
// fixture4は旧必修ルートの完了データであり、後から追加した活動には記録を持たない。
// 旧データを現行教材へ無理に完了扱いしないことを、この固定一覧で確認する。
const FIXTURE4_UNCOVERED_LESSON_IDS = [
  "lesson-10", "lesson-12", "lesson-17", "lesson-29", "lesson-30",
  "lesson-32", "lesson-33", "lesson-34", "lesson-35", "lesson-36",
  "lesson-38", "lesson-39", "lesson-40", "lesson-41", "lesson-42", "lesson-43",
];

/* ================= fixture 1: 進捗なし（空） ================= */
async function testFixture1() {
  const label = "fixture1(empty)";
  const { app, localStorage } = createHarness(loadFixtureSeed("01-empty"));
  await app.ensureData();

  const lesson01 = findLesson(curriculum, "lesson-01");
  const status = app.__test.lessonStatus(lesson01);
  check(label + ": lesson-01 not complete", status.complete === false);
  check(label + ": lesson-01 doneCount=0", status.doneCount === 0);

  const first = app.__test.firstIncompleteLesson();
  check(label + ": firstIncompleteLesson=lesson-01", !!first && first.id === "lesson-01");

  const state = parsePathState(localStorage);
  check(label + ": path state parses", !!state);
  check(label + ": curriculumVersion stamped", state && state.curriculumVersion === CURRICULUM_VERSION);
  check(label + ": removed textbookCheckpointV1 is absent", state && !state.textbookCheckpointV1);
  check(label + ": lessonCycles empty (nothing completed)",
    state && state.lessonCycles && Object.keys(state.lessonCycles).length === 0);
}

/* ================= fixture 2: Chapter1途中 ================= */
async function testFixture2() {
  const label = "fixture2(chapter1-partial)";
  const seed = loadFixtureSeed("02-chapter1-partial");
  const { app, localStorage } = createHarness(seed);
  await app.ensureData();

  const lesson01 = findLesson(curriculum, "lesson-01");
  const lesson02 = findLesson(curriculum, "lesson-02");
  const s01 = app.__test.lessonStatus(lesson01);
  const s02 = app.__test.lessonStatus(lesson02);
  check(label + ": lesson-01 complete", s01.complete === true);
  check(label + ": lesson-02 not complete", s02.complete === false);

  const first = app.__test.firstIncompleteLesson();
  check(label + ": firstIncompleteLesson=lesson-02", !!first && first.id === "lesson-02");

  const state1 = parsePathState(localStorage);
  check(label + ": lesson-01 completedAt stamped",
    !!(state1 && state1.lessonCycles && state1.lessonCycles["lesson-01"] && state1.lessonCycles["lesson-01"].completedAt));
  check(label + ": lesson-02 completedAt NOT stamped",
    !(state1 && state1.lessonCycles && state1.lessonCycles["lesson-02"] && state1.lessonCycles["lesson-02"].completedAt));

  // 冪等性: 同じlocalStorage状態から再起動しても、completedAtが増殖・変化しない。
  const reseed = { [STORE_KEY]: localStorage.getItem(STORE_KEY), [PATH_STORE_KEY]: localStorage.getItem(PATH_STORE_KEY) };
  await new Promise(resolve => setTimeout(resolve, 5)); // completedAtの秒精度差を確実にするための小休止
  const second = createHarness(reseed);
  await second.app.ensureData();
  const state2 = parsePathState(second.localStorage);
  check(label + ": idempotent re-boot keeps same completedAt",
    state1.lessonCycles["lesson-01"].completedAt === state2.lessonCycles["lesson-01"].completedAt);
}

/* ================= fixture 3: 旧必修2（用言）完了済みだが新構造では未移行 ================= */
async function testFixture3() {
  const label = "fixture3(legacy-yougo-not-migrated)";
  const { app, localStorage } = createHarness(loadFixtureSeed("03-legacy-yougo-complete-not-migrated"));
  await app.ensureData();

  const chapter1 = findChapter(curriculum, "chapter-1");
  const chapter1Status = app.__test.chapterStatus(chapter1);
  check(label + ": chapter-1 fully complete (5/5)",
    chapter1Status.completedLessons === 5 && chapter1Status.totalLessons === 5);

  ["lesson-06", "lesson-07", "lesson-08", "lesson-09", "lesson-11", "lesson-12"].forEach(id => {
    const lesson = findLesson(curriculum, id);
    const status = app.__test.lessonStatus(lesson);
    check(label + ": " + id + " NOT auto-completed by legacy yougo alone", status.complete === false);
  });

  const first = app.__test.firstIncompleteLesson();
  check(label + ": firstIncompleteLesson=lesson-06 (chapter1 done, chapter2 needs more than old yougo)",
    !!first && first.id === "lesson-06");

  const state = parsePathState(localStorage);
  check(label + ": lesson-06 completedAt NOT stamped",
    !(state.lessonCycles["lesson-06"] && state.lessonCycles["lesson-06"].completedAt));
  check(label + ": old grammarTaskCycles preserved untouched",
    state.grammarTaskCycles && state.grammarTaskCycles.yougo && state.grammarTaskCycles.yougo.passCompleted === true);
}

/* ================= fixture 4: 旧全必修完了済み ================= */
async function testFixture4() {
  const label = "fixture4(legacy-all-required-complete)";
  const { app, localStorage } = createHarness(loadFixtureSeed("04-legacy-all-required-complete"));
  await app.ensureData();

  const allLessons = curriculum.chapters.flatMap(c => c.lessons);
  let completedUnexpected = 0;
  allLessons.forEach(lesson => {
    const status = app.__test.lessonStatus(lesson);
    if (FIXTURE4_UNCOVERED_LESSON_IDS.includes(lesson.id)) {
      check(label + ": post-fixture lesson " + lesson.id + " stays incomplete (new content, no legacy answers)", status.complete === false);
    } else if (!status.complete) {
      completedUnexpected += 1; // 数え間違い検出用（0のはず）
      check(label + ": " + lesson.id + " should be complete", false);
    }
  });
  check(label + ": all originally-covered lessons complete", completedUnexpected === 0);

  const first = app.__test.firstIncompleteLesson();
  check(label + ": firstIncompleteLesson=" + FIXTURE4_UNCOVERED_LESSON_IDS[0] + " (first lesson added after this fixture)",
    !!first && first.id === FIXTURE4_UNCOVERED_LESSON_IDS[0]);

  const state = parsePathState(localStorage);
  const stampedCount = Object.keys(state.lessonCycles).filter(id => state.lessonCycles[id].completedAt).length;
  check(label + ": lessonCycles stamped for all " + (46 - FIXTURE4_UNCOVERED_LESSON_IDS.length) + " originally-covered lessons",
    stampedCount === 46 - FIXTURE4_UNCOVERED_LESSON_IDS.length);
  FIXTURE4_UNCOVERED_LESSON_IDS.forEach(id => {
    check(label + ": post-fixture lesson " + id + " has no completedAt",
      !(state.lessonCycles[id] && state.lessonCycles[id].completedAt));
  });

  check(label + ": old grammarCheckpoint is preserved but ignored", state.grammarCheckpoint && state.grammarCheckpoint.passed === true);
  check(label + ": removed textbook checkpoint is not initialized", !state.textbookCheckpointV1);
}

/* ================= fixture 5: 壊れたJSON ================= */
async function testFixture5() {
  const label = "fixture5(corrupted-json)";
  let threw = null;
  let app; let localStorage;
  try {
    const harness = createHarness(loadFixtureSeed("05-corrupted-json"));
    app = harness.app;
    localStorage = harness.localStorage;
    await app.ensureData();
  } catch (e) {
    threw = e;
  }
  check(label + ": boot does not throw on corrupted localStorage", threw === null);
  if (threw) {
    console.log("  -> " + String(threw));
    return;
  }

  const lesson01 = findLesson(curriculum, "lesson-01");
  let statusThrew = null;
  let status = null;
  try {
    status = app.__test.lessonStatus(lesson01);
  } catch (e) {
    statusThrew = e;
  }
  check(label + ": lessonStatus does not throw", statusThrew === null);
  check(label + ": lesson-01 treated as not complete (progress unreadable -> empty)", status && status.complete === false);

  let firstThrew = null;
  let first = null;
  try {
    first = app.__test.firstIncompleteLesson();
  } catch (e) {
    firstThrew = e;
  }
  check(label + ": firstIncompleteLesson does not throw", firstThrew === null);
  check(label + ": firstIncompleteLesson=lesson-01", !!first && first.id === "lesson-01");

  const state = parsePathState(localStorage);
  check(label + ": path state self-heals to valid JSON after boot (corrupted string was overwritten)", !!state);
}

/* ================= fixture 6: 旧単語モードのキーが同居 ================= */
async function testFixture6() {
  const label = "fixture6(legacy-vocab-key-present)";
  const { app, localStorage } = createHarness(loadFixtureSeed("06-legacy-vocab-key-present", { withExtraKeys: true }));
  const before = localStorage.getItem("kobun_vocab_progress");
  check(label + ": extra vocab key present before boot", typeof before === "string" && before.length > 0);

  let threw = null;
  try {
    await app.ensureData();
  } catch (e) {
    threw = e;
  }
  check(label + ": boot does not throw with unrelated legacy key present", threw === null);

  const first = app.__test.firstIncompleteLesson();
  check(label + ": firstIncompleteLesson=lesson-01 (unaffected by unrelated key)", !!first && first.id === "lesson-01");

  const after = localStorage.getItem("kobun_vocab_progress");
  check(label + ": extra vocab key left untouched by the app", after === before);
}

/* ================= chapterStatus().weakCount: procedure-kind必修（ids未指定）の苦手検出 =================
 * 章3〜6の必修の大半はkind:"procedure"かつcurriculum.json側にids指定が無い（procIdだけで実践プールを
 * 決める）。taskHasWeakRecord()が旧taskIds()でid解決すると、procedure taskはgroupIdを持たないため
 * 常に[]になりweakCountが常に0になるバグがあった（taskCheckedIds()経由に修正済み）。この回帰を検出する。
 */
async function testWeakCountProcedureTask() {
  const label = "weakCount(procedure-task)";
  const { app, localStorage } = createHarness(loadFixtureSeed("01-empty"));
  await app.ensureData();

  // lesson-18-proc-keri（kind:"procedure", setId:"shikibetsu", procId:"keri", idsフィールド無し）の
  // 実践IDの1つ（pn-keri-int2）を苦手記録（weak:true）にする。
  // __identificationPracticeVersion:2を付けないと、loadProgress()内の既存移行処理
  // （migrateIdentificationPracticeProgress）がshikibetsu:接頭辞のintegration問題記録を
  // 「旧バージョン」とみなして削除してしまうため、この回帰テスト自体が偽陽性のFAILになる。
  const progress = { "shikibetsu:pn-keri-int2": { c: 1, w: 1, weak: true }, "__identificationPracticeVersion": 2 };
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));

  const chapter3 = findChapter(curriculum, "chapter-3");
  const status = app.__test.chapterStatus(chapter3);
  check(label + ": chapter-3 weakCount picks up procedure-kind task's weak record", status.weakCount === 1);
}

/* ================= Task 1: 46講版の状態境界 ================= */
async function testCurriculumStateBoundaries() {
  const label = "curriculum-state-boundaries";
  const { app, localStorage } = createHarness(loadFixtureSeed("01-empty"));
  await app.ensureData();

  const lesson01Task = findTask(curriculum, "lesson-01-kiso");
  const lesson01 = findLesson(curriculum, "lesson-01");
  check(label + ": test task exists", !!lesson01Task);

  const progress = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  lesson01Task.ids.forEach(id => { progress["kiso:" + id] = { c: 1, w: 0, weak: false }; });
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));

  const fixed = "2026-08-18T00:00:00.000Z";
  app.__test.applyActivityCompletion(lesson01Task.id, { now: fixed });
  let path = parsePathState(localStorage);
  check(label + ": activity completion does not create grammarTaskCycles",
    !path.grammarTaskCycles || !path.grammarTaskCycles[lesson01Task.id]);
  check(label + ": last activity stamps lessonCycles once",
    path.lessonCycles && path.lessonCycles[lesson01.id] && path.lessonCycles[lesson01.id].completedAt === fixed);

  app.__test.applyActivityCompletion(lesson01Task.id, { now: "2026-08-18T01:00:00.000Z" });
  path = parsePathState(localStorage);
  check(label + ": repeated completion keeps the original completedAt",
    path.lessonCycles[lesson01.id].completedAt === fixed);

  app.__test.applyActivityCompletion(lesson01Task.id, { review: true, now: "2026-08-18T02:00:00.000Z" });
  path = parsePathState(localStorage);
  check(label + ": review updates lastReviewedAt only",
    path.lessonCycles[lesson01.id].completedAt === fixed
      && path.lessonCycles[lesson01.id].lastReviewedAt === "2026-08-18T02:00:00.000Z");

  check(label + ": removed checkpoint API is not exposed",
    typeof app.__test.saveCheckpointResult === "undefined");

  const blocked = app.__test.lessonStatus({ id: "blocked-fixture", number: 99, title: "blocked", status: "blocked", requiredActivities: [] });
  check(label + ": empty blocked lesson is not complete", blocked.complete === false);
}

async function testOptionalRoutesRemoved() {
  const label = "optional-routes-removed";
  const { app, localStorage } = createHarness(loadFixtureSeed("01-empty"));
  await app.ensureData();
  check(label + ": curriculum checkpoint is removed", !curriculum.checkpoint);
  check(label + ": curriculum extensions are removed",
    !curriculum.extensions || curriculum.extensions.length === 0);
  const progress = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  curriculum.chapters.flatMap(chapter => chapter.lessons).forEach(lesson => {
    lesson.requiredActivities.forEach(activity => {
      app.__test.taskCheckedIds({
        id: activity.id,
        kind: activity.kind,
        setId: activity.setId,
        groupId: activity.groupId,
        ids: activity.ids,
        procId: activity.procId,
      }).forEach(id => {
        const key = activity.setId + ":" + id;
        progress[key] = { c: 1, w: 0, weak: false };
      });
    });
  });
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  const status = app.__test.grammarCourseStatus();
  check(label + ": grammar completion is based on the 46 lessons only", status.complete === true);
  check(label + ": grammar status has no checkpoint", !status.checkpoint);
}

async function testActivityQueues() {
  const label = "activity-queues";
  const { app, localStorage } = createHarness(loadFixtureSeed("01-empty"));
  await app.ensureData();
  const lesson01 = findLesson(curriculum, "lesson-01");
  const chapter1 = findChapter(curriculum, "chapter-1");
  const firstEntries = app.__test.lessonQueueEntries(lesson01, false);
  check(label + ": first lesson queue has its activity", firstEntries.length === 1 && firstEntries[0].review === false);
  const chapterEntries = app.__test.chapterQueueEntries(chapter1);
  check(label + ": chapter queue keeps lesson order", chapterEntries.length > 1 && chapterEntries[0].task.lessonId === "lesson-01");
  check(label + ": chapter queue is review-only", chapterEntries.every(entry => entry.review === true));

  const progress = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  progress["kiso:k-yomi-03"] = { c: 0, w: 1, weak: true };
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  const weakEntries = app.__test.weakQueueEntries([lesson01]);
  check(label + ": weak queue narrows to concrete weak IDs",
    weakEntries.length === 1 && weakEntries[0].review === true && weakEntries[0].task.ids.length === 1
      && weakEntries[0].task.ids[0] === "k-yomi-03");
}

async function main() {
  await testFixture1();
  await testFixture2();
  await testFixture3();
  await testFixture4();
  await testFixture5();
  await testFixture6();
  await testWeakCountProcedureTask();
  await testCurriculumStateBoundaries();
  await testOptionalRoutesRemoved();
  await testActivityQueues();

  console.log("");
  console.log("PASS: " + passCount + " / FAIL: " + failCount);
  if (failCount > 0) {
    console.log("failed checks:");
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("UNCAUGHT ERROR:", err);
  process.exit(1);
});
