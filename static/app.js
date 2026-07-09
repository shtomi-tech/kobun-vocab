"use strict";

/* ============================================================
   古文演習 — 単語（VocabApp）／活用（KatsuyoApp）を切り替える薄いシェル。
   各モードは static/mode-*.js に IIFE で閉じており、ここでは
   トップレベルのタブ切替と表示中モードの mount のみを担当する。
   ============================================================ */

const APPS = [
  { id: "vocab", tag: "VOCAB QUIZ", label: "単語", title: "古文単語 4択演習", app: VocabApp },
  { id: "katsuyo", tag: "CONJUGATION", label: "活用", title: "古文 活用ドリル", app: KatsuyoApp },
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
  const prev = APPS.find(a => a.id === currentAppId);
  if (prev && prev.app.unmount) prev.app.unmount();
  currentAppId = id;
  const next = APPS.find(a => a.id === id);
  document.getElementById("appTitle").textContent = next.title;
  document.title = next.title;
  document.body.classList.toggle("vocabActive", id === "vocab");
  renderAppNav();
  next.app.mount();
}

switchApp("vocab");
