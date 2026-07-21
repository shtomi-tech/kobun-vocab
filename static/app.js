"use strict";

/* ============================================================
   古文演習 — 段階1の古文単語／段階2の古典文法を切り替える薄いシェル。
   文法ロードマップと内部の練習UIは mode-katsuyo.js 側で管理する。
   ============================================================ */

const APPS = [
  { id: "vocab", tag: "VOCABULARY", label: "古文単語", title: "古文単語 4択演習", mount: () => VocabApp.mount(), handleKey: (e) => VocabApp.handleKey(e) },
  { id: "grammar", tag: "GRAMMAR", label: "古典文法", title: "古典文法演習", mount: () => KatsuyoApp.mount("grammar"), handleKey: (e) => KatsuyoApp.handleKey(e) },
];

let currentAppId = null;

function renderAppNav() {
  const nav = document.getElementById("appNav");
  nav.innerHTML = "";
  APPS.forEach(a => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "appTab";
    const locked = a.id === "grammar" && !VocabApp.isStage1Complete();
    if (locked) {
      btn.classList.add("locked");
      btn.setAttribute("aria-disabled", "true");
      btn.title = "コア300語を完了すると解放されます";
    }
    btn.setAttribute("aria-pressed", a.id === currentAppId ? "true" : "false");
    const tag = document.createElement("span");
    tag.textContent = a.tag;
    btn.appendChild(tag);
    btn.appendChild(document.createTextNode(a.label));
    btn.addEventListener("click", () => switchApp(a.id));
    nav.appendChild(btn);
  });
}

function switchApp(id) {
  if (id === "grammar" && !VocabApp.isStage1Complete()) {
    currentAppId = "vocab";
    document.getElementById("appTitle").textContent = APPS[0].title;
    document.title = APPS[0].title;
    renderAppNav();
    VocabApp.showStageGate();
    return;
  }
  if (currentAppId === id) return;
  currentAppId = id;
  const next = APPS.find(a => a.id === id);
  document.getElementById("appTitle").textContent = next.title;
  document.title = next.title;
  renderAppNav();
  next.mount();
}

document.addEventListener("keydown", (e) => {
  const app = APPS.find(a => a.id === currentAppId);
  if (app && app.handleKey) app.handleKey(e);
});

switchApp("vocab");
