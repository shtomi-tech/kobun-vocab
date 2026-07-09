"use strict";

/* ============================================================
   古文演習 — 単語／助動詞／用言／文法4択 を切り替える薄いシェル。
   各モードは static/mode-*.js に IIFE で閉じており、ここでは
   フラットな1段タブの切替と、表示中モードへのキー入力の橋渡しのみを担当する。
   ============================================================ */

const APPS = [
  { id: "vocab", tag: "VOCAB QUIZ", label: "単語", title: "古文単語 4択演習", mount: () => VocabApp.mount(), handleKey: (e) => VocabApp.handleKey(e) },
  { id: "jodoshi", tag: "AUXILIARY", label: "助動詞", title: "古文 助動詞 活用ドリル", mount: () => KatsuyoApp.mount("jodoshi"), handleKey: (e) => KatsuyoApp.handleKey(e) },
  { id: "yougo", tag: "YOUGO", label: "用言", title: "古文 用言 活用ドリル", mount: () => KatsuyoApp.mount("yougo"), handleKey: (e) => KatsuyoApp.handleKey(e) },
  { id: "choice", tag: "MULTIPLE CHOICE", label: "文法4択", title: "古文 文法4択", mount: () => KatsuyoApp.mount("choice"), handleKey: (e) => KatsuyoApp.handleKey(e) },
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
