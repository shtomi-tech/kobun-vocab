"use strict";

/* ============================================================
   古文演習 — 古文単語／古典文法を切り替える薄いシェル。
   古典文法内の「活用表／文法4択／識別」は mode-katsuyo.js 側で切り替える。
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
