// harness/cloud.js v2.0.0 — 正本は dev/portal/shared/cloud.js。
// 各アプリへは `node portal/tools/sync-cloud.mjs` で配布する。配布先を直接編集しない。
"use strict";
/* ============================================================
   生徒別クラウド同期（共通スキーマ app_students / app_progress）
   共有URL ?s=<id>&t=<token> があり config.json が揃うときだけ有効。
   無ければ完全に no-op ＝ 従来の匿名ローカル動作。

   端末間の整合を保つ仕組み:
   - 未送信の変更は localStorage の送信待ちキュー（outbox）に残す。
     通信失敗・タブを閉じた場合も、次に開いたとき必ず再送する。
   - 保存は revision による楽観ロック（*_v2 RPC）。他端末が先に保存していたら
     最新を取り直し、前回同期時点（base）からの自端末の差分だけを重ねる3方向マージを行う。
   - タブに戻ったときに最新を取り直し、applyLoaded(progress, { reason }) で画面へ反映する。
   - v2 RPC がないDBでは旧RPCへ自動で切り替える（競合検出なし）。

   applyLoaded は reason = "init" | "refresh" | "conflict" で呼ばれる。
   アプリは渡された progress を正として、メモリ上の状態も読み直すこと。
   ============================================================ */
(function (root) {
  const FULL_KEY = "__all__";
  const RETRY_DELAYS = [2000, 5000, 15000, 30000, 60000];
  const KEEPALIVE_LIMIT = 60000;
  const REFRESH_INTERVAL = 5000;
  const MAX_CONFLICT_ROUNDS = 4;

  function isObj(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => deepEqual(a[k], b[k]));
  }

  // 3方向マージ。base から local で変わった部分だけを remote に重ねる。
  // 同じ値を両方が別々に変えた場合は local（今この端末で操作した内容）を採る。
  // 片方の削除ともう片方の変更がぶつかった場合は変更を残す。
  function merge3(base, local, remote) {
    if (deepEqual(local, base)) return clone(remote);
    if (deepEqual(remote, base) || deepEqual(remote, local)) return clone(local);
    if (local === undefined) return clone(remote);
    if (remote === undefined) return clone(local);
    if (isObj(local) && isObj(remote)) {
      const b = isObj(base) ? base : {};
      const out = {};
      const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
      keys.forEach((key) => {
        const merged = merge3(b[key], local[key], remote[key]);
        if (merged !== undefined) out[key] = merged;
      });
      return out;
    }
    return clone(local);
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function currentSearch() {
    const loc = root.location || (root.window && root.window.location);
    return (loc && loc.search) || "";
  }

  async function loadOptionalJson(path) {
    try {
      const r = await root.fetch(path, { cache: "no-store" });
      if (!r.ok) return {};
      return await r.json();
    } catch (e) {
      return {};
    }
  }

  function normalizeConfig(raw = {}) {
    const supabase = (raw && raw.supabase) || {};
    return {
      appBaseUrl: String((raw && raw.appBaseUrl) || "").trim(),
      supabaseUrl: String((raw && raw.supabaseUrl) || supabase.url || "").trim().replace(/\/+$/, ""),
      supabaseAnonKey: String((raw && raw.supabaseAnonKey) || supabase.anonKey || "").trim(),
    };
  }

  function parseSharedParams() {
    const p = new URLSearchParams(currentSearch());
    return {
      studentId: p.get("s") || p.get("student") || "",
      token: p.get("t") || p.get("token") || "",
    };
  }

  function statusTime(date = new Date()) {
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  /**
   * createCloud — クラウド同期層。
   *   opts.appId          app_progress.app に入れる値
   *   opts.configPath     config.json の場所（既定 "static/config.json"）
   *   opts.getPayload     () => 保存する progress 全体（全体保存アプリ）
   *   opts.getPatch       () => { datasetId, progress, meta }（回単位保存アプリ。指定時はこちらを使う）
   *   opts.applyLoaded    (progress, { reason }) => クラウドの進捗を適用
   *   opts.onStatus       (message, tone) => UI 通知（省略可）
   *   opts.readOnly       true なら読み込みのみ（保存・自動再取得をしない）
   *   opts.refreshOnFocus false ならタブ復帰時の再取得をしない
   */
  function createCloud(opts) {
    const {
      appId,
      configPath = "static/config.json",
      getPayload,
      getPatch,
      applyLoaded = () => {},
      onStatus = () => {},
      readOnly = false,
      refreshOnFocus = true,
    } = opts || {};
    const datasetMode = typeof getPatch === "function";
    const session = { requested: false, enabled: false, studentId: "", token: "", student: null, protocol: "v2" };
    let cfg = {};
    let remote = {};
    let revision = 0;
    let outbox = {};
    let saveTimer = null;
    let retryTimer = null;
    let retryCount = 0;
    let queue = Promise.resolve();
    let lastRefresh = 0;

    function hasConfig() {
      const url = cfg.supabaseUrl || "";
      const key = cfg.supabaseAnonKey || "";
      return Boolean(url && key)
        && !/example\.supabase\.co|YOUR_PROJECT_ID/i.test(url)
        && !/^dummy$|^YOUR_/i.test(key);
    }

    function studentName() {
      return session.student ? session.student.name : "";
    }

    function creds(extra) {
      return Object.assign({ p_app: appId, p_student_id: session.studentId, p_access_token: session.token }, extra);
    }

    async function rpc(name, payload, { keepalive = false } = {}) {
      if (!hasConfig()) throw new Error("Supabase設定が未完了です。");
      const init = {
        method: "POST",
        headers: {
          apikey: cfg.supabaseAnonKey,
          Authorization: `Bearer ${cfg.supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      };
      if (keepalive) init.keepalive = true;
      const res = await root.fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, init);
      if (!res.ok) {
        const text = typeof res.text === "function" ? await res.text().catch(() => "") : "";
        const error = new Error(`${name}: ${res.status} ${text || res.statusText || ""}`.trim());
        error.status = res.status;
        error.rpcName = name;
        throw error;
      }
      if (res.status === 204) return null;
      return res.json();
    }

    function isMissingRpc(error) {
      return Boolean(error && error.status === 404);
    }

    /* ---------- outbox（未送信の変更） ---------- */
    function outboxKey() {
      return `harness-cloud-outbox:${appId}:${session.studentId}`;
    }

    function readOutbox() {
      const store = storage();
      if (!store) return {};
      try {
        const parsed = JSON.parse(store.getItem(outboxKey()) || "{}");
        return isObj(parsed) ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function writeOutbox() {
      const store = storage();
      if (!store) return;
      try {
        if (Object.keys(outbox).length) store.setItem(outboxKey(), JSON.stringify(outbox));
        else store.removeItem(outboxKey());
      } catch (e) {
        console.warn("送信待ちの進捗を端末に保存できませんでした。", e);
      }
    }

    function remoteValue(key) {
      if (!datasetMode) return remote;
      return isObj(remote) ? remote[key] : undefined;
    }

    // remote が更新されたら、未送信の変更をその上へ載せ直す。
    function rebase() {
      Object.keys(outbox).forEach((key) => {
        const entry = outbox[key];
        const latest = remoteValue(key);
        entry.value = merge3(entry.base, entry.value, latest);
        entry.base = clone(latest);
        if (!datasetMode && deepEqual(entry.value, latest)) delete outbox[key];
      });
    }

    // アプリへ渡す「最新のクラウド + 未送信の変更」。
    function view() {
      if (!datasetMode) return clone(outbox[FULL_KEY] ? outbox[FULL_KEY].value : remote) || {};
      const out = clone(remote) || {};
      Object.keys(outbox).forEach((key) => {
        const entry = outbox[key];
        if (entry.value !== undefined) out[key] = clone(entry.value);
        if (isObj(entry.meta)) out._meta = Object.assign({}, out._meta || {}, clone(entry.meta));
      });
      return out;
    }

    function deliver(reason) {
      try {
        applyLoaded(view(), { reason });
      } catch (e) {
        console.error(e);
      }
    }

    async function loadRemote() {
      if (session.protocol === "v2") {
        try {
          const row = await rpc("app_load_progress_v2", creds({}));
          if (!isObj(row)) throw new Error("生徒URLを確認できませんでした。QRコードを作り直してください。");
          return { progress: isObj(row.progress) ? row.progress : {}, revision: Number(row.revision) || 0 };
        } catch (e) {
          if (!isMissingRpc(e)) throw e;
          session.protocol = "legacy";
        }
      }
      const loaded = await rpc("app_load_progress", creds({}));
      const row = Array.isArray(loaded) ? loaded[0] : loaded;
      const progress = isObj(row) ? (isObj(row.progress) ? row.progress : row) : {};
      return { progress, revision: 0 };
    }

    /* ---------- 起動 ---------- */
    async function init() {
      cfg = normalizeConfig(await loadOptionalJson(configPath));
      const shared = parseSharedParams();
      session.studentId = shared.studentId;
      session.token = shared.token;
      session.requested = Boolean(shared.studentId || shared.token);
      if (!session.requested) return session;

      if (!hasConfig()) {
        onStatus("共有URLですが、クラウド設定が未完了です。先生に連絡してください。", "ng");
        return session;
      }
      try {
        const authRows = await rpc("app_auth_student", {
          p_student_id: session.studentId,
          p_access_token: session.token,
        });
        const student = Array.isArray(authRows) ? authRows[0] : authRows;
        if (!student || !student.id) {
          throw new Error("生徒URLを確認できませんでした。QRコードを作り直してください。");
        }
        session.student = { id: String(student.id), name: String(student.display_name || student.id) };

        outbox = readOutbox();
        const loaded = await loadRemote();
        remote = loaded.progress;
        revision = loaded.revision;
        const hadPending = Object.keys(outbox).length > 0;
        rebase();
        writeOutbox();
        deliver("init");
        // load 完了後にだけ保存を許可する（空のローカル状態でクラウドを上書きしない）。
        session.enabled = true;
        bindLifecycle();
        if (hadPending && !readOnly) {
          onStatus(`${studentName()} さんの未送信の進捗を送信中…`, "syncing");
          flush();
        } else {
          onStatus(`${studentName()} さんとして学習中（クラウド同期済み ${statusTime()}）`, "ok");
        }
      } catch (e) {
        session.enabled = false;
        console.error(e);
        onStatus(e.message || "共有URLの読み込みに失敗しました。", "ng");
      }
      return session;
    }

    /* ---------- 保存 ---------- */
    function queueSave(patchOverride = null) {
      if (!session.enabled || readOnly) return;
      let key;
      let value;
      let meta;
      if (datasetMode) {
        const patch = patchOverride || getPatch();
        if (!patch || patch.datasetId == null || patch.datasetId === "" || !isObj(patch.progress)) return;
        key = String(patch.datasetId);
        value = patch.progress;
        meta = isObj(patch.meta) ? patch.meta : {};
      } else {
        key = FULL_KEY;
        value = typeof getPayload === "function" ? getPayload() : {};
        if (!isObj(value)) return;
      }
      const entry = outbox[key] || { base: clone(remoteValue(key)) };
      entry.value = clone(value);
      if (datasetMode) entry.meta = clone(meta);
      outbox[key] = entry;
      writeOutbox();
      onStatus(`${studentName()} さんの進捗を保存中…`, "syncing");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { flush(); }, 600);
    }

    function markSent(key, sent, meta) {
      if (datasetMode) {
        if (!isObj(remote)) remote = {};
        remote[key] = clone(sent);
        remote._meta = Object.assign({}, remote._meta || {}, clone(meta) || {});
      } else {
        remote = clone(sent);
      }
      const entry = outbox[key];
      if (!entry) return;
      // 送信中に新しい変更が積まれていたら、送った内容を base にして残す。
      if (deepEqual(entry.value, sent) && deepEqual(entry.meta, meta)) delete outbox[key];
      else entry.base = clone(sent);
    }

    async function pushOne(key, keepalive) {
      for (let round = 0; round < MAX_CONFLICT_ROUNDS; round += 1) {
        const entry = outbox[key];
        if (!entry) return;
        const sent = clone(entry.value);
        const meta = clone(entry.meta);
        const body = datasetMode
          ? creds({ p_dataset_id: key, p_dataset_progress: sent || {}, p_meta: meta || {} })
          : creds({ p_progress: sent || {} });
        const useKeepalive = keepalive && JSON.stringify(body).length < KEEPALIVE_LIMIT;
        let result = null;
        if (session.protocol === "v2") {
          try {
            result = await rpc(
              datasetMode ? "app_save_progress_dataset_v2" : "app_save_progress_v2",
              Object.assign({ p_base_revision: revision }, body),
              { keepalive: useKeepalive },
            );
          } catch (e) {
            if (!isMissingRpc(e)) throw e;
            session.protocol = "legacy";
          }
        }
        if (session.protocol === "legacy") {
          await rpc(datasetMode ? "app_save_progress_dataset" : "app_save_progress", body, { keepalive: useKeepalive });
          result = { ok: true, revision };
        }
        if (result && result.ok) {
          revision = Number(result.revision) || revision;
          markSent(key, sent, meta);
          writeOutbox();
          return;
        }
        // 競合: 他端末の保存を取り込み、自端末の差分を載せ直して再送する。
        remote = result && isObj(result.progress) ? result.progress : {};
        revision = Number(result && result.revision) || 0;
        rebase();
        writeOutbox();
        deliver("conflict");
      }
      throw new Error("他の端末との保存競合が続いたため、保存を後で再試行します。");
    }

    async function pushAll(keepalive) {
      const keys = Object.keys(outbox);
      if (!keys.length) return;
      try {
        for (const key of keys) await pushOne(key, keepalive);
        retryCount = 0;
        clearTimeout(retryTimer);
        retryTimer = null;
        if (!Object.keys(outbox).length) {
          onStatus(`${studentName()} さんの進捗を保存済み（${statusTime()}）`, "ok");
        }
      } catch (e) {
        console.error(e);
        scheduleRetry();
        onStatus("進捗のクラウド保存に失敗しました。この端末に保持し、通信が戻りしだい再送します。", "ng");
      }
    }

    function scheduleRetry() {
      clearTimeout(retryTimer);
      const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
      retryCount += 1;
      retryTimer = setTimeout(() => { retryTimer = null; flush(); }, delay);
    }

    function flush({ keepalive = false } = {}) {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!session.enabled || readOnly) return queue;
      queue = queue.then(() => pushAll(keepalive)).catch((e) => console.error(e));
      return queue;
    }

    /* ---------- 他端末の変更の取り込み ---------- */
    function refresh({ force = false } = {}) {
      if (!session.enabled || readOnly) return queue;
      const now = Date.now();
      if (!force && now - lastRefresh < REFRESH_INTERVAL) return queue;
      lastRefresh = now;
      flush();
      queue = queue.then(async () => {
        const loaded = await loadRemote();
        const unchanged = session.protocol === "v2"
          ? loaded.revision === revision
          : deepEqual(loaded.progress, remote);
        if (unchanged) return;
        remote = loaded.progress;
        revision = loaded.revision;
        rebase();
        writeOutbox();
        deliver("refresh");
        onStatus(`${studentName()} さんの最新の進捗を反映しました（${statusTime()}）`, "ok");
      }).catch((e) => console.error(e));
      return queue;
    }

    let lifecycleBound = false;
    function bindLifecycle() {
      if (lifecycleBound || readOnly) return;
      lifecycleBound = true;
      const doc = root.document;
      if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("visibilitychange", () => {
          if (doc.visibilityState === "hidden") flush({ keepalive: true });
          else if (refreshOnFocus) refresh();
        });
      }
      if (typeof root.addEventListener === "function") {
        root.addEventListener("pagehide", () => flush({ keepalive: true }));
        root.addEventListener("online", () => flush());
        if (refreshOnFocus) root.addEventListener("focus", () => refresh());
      }
    }

    return {
      init,
      queueSave,
      flush,
      refresh,
      hasPending: () => Object.keys(outbox).length > 0,
      isEnabled: () => session.enabled,
      getSession: () => session,
    };
  }

  root.createCloud = createCloud;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createCloud, merge3, deepEqual, normalizeConfig, parseSharedParams, loadOptionalJson };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
