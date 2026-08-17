"use strict";

/* 文法ロードマップの予習資料。読み進める単位と10秒確認を、この画面だけで管理する。 */
const KobunPreparation = (function () {
  const PREPARATION_POST_CHAR_LIMIT = 280;
  const PREPARATION_PROGRESS_VERSION = 1;
  const PREPARATION_STORE_KEY = "kobun-preparation-progress-v1";
  const CALLOUT_LABELS = {
    board: "板書",
    practice: "次の一歩",
    check: "10秒確認",
  };
  const TRUSTED_IMAGE_SOURCE = /^(?:static|data)\/[A-Za-z0-9._/-]+$/;
  let activeCleanup = () => {};

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inlineMarkup(value) {
    let text = escapeHtml(value);
    text = text.replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return text;
  }

  function appendParagraph(target, lines, className = "") {
    const paragraph = document.createElement("p");
    if (className) paragraph.className = className;
    paragraph.innerHTML = inlineMarkup(lines.join("\n")).replace(/\n/g, "<br>");
    target.appendChild(paragraph);
  }

  function appendList(target, lines, ordered) {
    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "prepList";
    lines.forEach(line => {
      const item = document.createElement("li");
      item.innerHTML = inlineMarkup(line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
      list.appendChild(item);
    });
    target.appendChild(list);
  }

  function parseCheck(lines, fallbackId) {
    const check = {
      id: fallbackId || "check-" + Math.random().toString(36).slice(2),
      question: "",
      choices: [],
      answer: "",
      explanation: "",
    };
    lines.forEach(rawLine => {
      const line = rawLine.trim();
      const match = line.match(/^(question|choice|answer|explanation):\s*(.*)$/);
      if (!match) return;
      const field = match[1];
      const value = match[2];
      if (field === "choice") {
        const divider = value.indexOf("|");
        const key = divider >= 0 ? value.slice(0, divider).trim() : String.fromCharCode(65 + check.choices.length);
        const text = divider >= 0 ? value.slice(divider + 1).trim() : value;
        check.choices.push({ key, text });
      } else {
        check[field] = value;
      }
    });
    if (!check.question) check.question = "上の説明に当てはまるものは？";
    if (!check.explanation) check.explanation = "板書の接続と、直前の語の形・文中の働きを照合します。";
    if (!check.answer && check.choices[0]) check.answer = check.choices[0].key;
    return check;
  }

  function setCheckResult(box, selectedKey, controller, shouldPersist) {
    const correctKey = box.dataset.answer || "";
    const isCorrect = selectedKey === correctKey;
    box.classList.toggle("is-correct", isCorrect);
    box.classList.toggle("is-wrong", !isCorrect);
    box.querySelectorAll(".prepCheckChoice").forEach(choice => {
      const selected = choice.dataset.choice === selectedKey;
      choice.classList.toggle("is-selected", selected);
      choice.classList.toggle("is-answer", choice.dataset.choice === correctKey && !isCorrect);
      choice.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    const feedback = box.querySelector(".prepCheckFeedback");
    if (feedback) {
      feedback.hidden = false;
      feedback.className = "prepCheckFeedback " + (isCorrect ? "is-correct" : "is-wrong");
      feedback.textContent = isCorrect
        ? "正解。ここは10秒で思い出せれば十分です。"
        : "いったん板書に戻り、接続と文中の働きをもう一度確認します。";
    }
    const explanation = box.querySelector(".prepCheckExplanation");
    if (explanation) explanation.hidden = false;

    if (shouldPersist && controller && typeof controller.recordCheck === "function") {
      controller.recordCheck(box.dataset.checkId, selectedKey, isCorrect);
    }
  }

  function appendCheck(target, lines, explicitId, controller) {
    const check = parseCheck(lines, explicitId);
    const box = document.createElement("section");
    box.className = "prepCallout prepCallout-check prep-check-interactive";
    box.dataset.checkId = check.id;
    box.dataset.answer = check.answer;

    const heading = document.createElement("h3");
    heading.textContent = CALLOUT_LABELS.check;
    box.appendChild(heading);

    const fieldset = document.createElement("fieldset");
    fieldset.className = "prepCheckFieldset";
    const legend = document.createElement("legend");
    legend.id = check.id + "-question";
    legend.textContent = check.question;
    fieldset.appendChild(legend);

    const options = document.createElement("div");
    options.className = "prepCheckOptions";
    check.choices.forEach(choice => {
      const choiceButton = document.createElement("button");
      choiceButton.type = "button";
      choiceButton.className = "prepCheckChoice";
      choiceButton.dataset.choice = choice.key;
      choiceButton.setAttribute("aria-pressed", "false");
      choiceButton.setAttribute("aria-label", choice.key + " " + choice.text);
      const key = document.createElement("span");
      key.className = "prepCheckChoiceKey";
      key.textContent = choice.key;
      const label = document.createElement("span");
      label.className = "prepCheckChoiceText";
      label.textContent = choice.text;
      choiceButton.appendChild(key);
      choiceButton.appendChild(label);
      choiceButton.addEventListener("click", () => {
        setCheckResult(box, choice.key, controller, true);
      });
      options.appendChild(choiceButton);
    });
    fieldset.appendChild(options);
    box.appendChild(fieldset);

    const feedback = document.createElement("div");
    feedback.className = "prepCheckFeedback";
    feedback.hidden = true;
    feedback.setAttribute("aria-live", "polite");
    box.appendChild(feedback);

    const explanation = document.createElement("div");
    explanation.className = "prepCheckExplanation";
    explanation.hidden = true;
    const explanationLabel = document.createElement("strong");
    explanationLabel.textContent = "判断の理由";
    explanation.appendChild(explanationLabel);
    const explanationText = document.createElement("p");
    explanationText.innerHTML = inlineMarkup(check.explanation);
    explanation.appendChild(explanationText);
    box.appendChild(explanation);

    box.setAttribute("aria-labelledby", legend.id);
    target.appendChild(box);
    return box;
  }

  function appendCallout(target, type, lines, explicitId, controller) {
    if (type === "check") {
      appendCheck(target, lines, explicitId, controller);
      return;
    }
    const box = document.createElement("section");
    box.className = "prepCallout prepCallout-" + type;
    const heading = document.createElement("h3");
    heading.textContent = CALLOUT_LABELS[type] || type;
    box.appendChild(heading);
    const body = document.createElement("div");
    body.className = "prepCalloutBody";
    renderLines(lines, body, controller);
    box.appendChild(body);
    target.appendChild(box);
  }

  function imageMatch(line) {
    const match = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    return match && TRUSTED_IMAGE_SOURCE.test(match[2]) ? match : null;
  }

  function createPreparationImage(match) {
    const image = document.createElement("img");
    image.className = "prepIllustration";
    image.src = match[2];
    image.alt = match[1] || "";
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  }

  function createProfessorAvatar() {
    const image = document.createElement("img");
    image.className = "prepAvatar";
    image.src = "static/hedgehog-professor-original.png";
    image.alt = "ハリネズミ教授";
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  }

  function createPost(label, extraClass = "") {
    const post = document.createElement("section");
    post.className = "prepPost" + (extraClass ? " " + extraClass : "");

    const identity = document.createElement("div");
    identity.className = "prepPostIdentity";
    identity.appendChild(createProfessorAvatar());
    const meta = document.createElement("div");
    meta.className = "prepPostMeta";
    const name = document.createElement("strong");
    name.className = "prepProfessor";
    name.textContent = "ハリネズミ教授";
    const postLabel = document.createElement("span");
    postLabel.className = "prepPostLabel";
    postLabel.textContent = label;
    meta.appendChild(name);
    meta.appendChild(postLabel);
    identity.appendChild(meta);
    post.appendChild(identity);

    const body = document.createElement("div");
    body.className = "prepPostBody";
    post.appendChild(body);
    return { post, body };
  }

  function hasContent(lines) {
    return lines.some(line => line.trim());
  }

  function nodeCharacterCount(node) {
    return Array.from(node.textContent || "").length;
  }

  function appendNodeChunks(target, nodes, label, extraClass, posts, sectionIndex) {
    const chunks = [];
    let chunk = [];
    let count = 0;
    nodes.forEach(node => {
      const nodeCount = nodeCharacterCount(node);
      if (chunk.length && count + nodeCount > PREPARATION_POST_CHAR_LIMIT) {
        chunks.push(chunk);
        chunk = [];
        count = 0;
      }
      chunk.push(node);
      count += nodeCount;
    });
    if (chunk.length) chunks.push(chunk);

    chunks.forEach((chunkNodes, chunkIndex) => {
      const suffix = chunks.length > 1 ? " 続き " + (chunkIndex + 1) : "";
      const post = createPost(label + suffix, extraClass && chunkIndex === 0 ? extraClass : "");
      chunkNodes.forEach(node => post.body.appendChild(node));
      post.post.dataset.charCount = String(nodeCharacterCount(post.body));
      post.post.dataset.charLimit = String(PREPARATION_POST_CHAR_LIMIT);
      if (sectionIndex !== undefined) post.post.dataset.sectionIndex = String(sectionIndex);
      target.appendChild(post.post);
      posts.push(post.post);
    });
  }

  function renderThread(markdown, target, task, controller) {
    const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const posts = [];
    const titleIndex = lines.findIndex(line => /^#\s+/.test(line));
    if (titleIndex < 0) {
      const holder = document.createElement("div");
      renderLines(lines, holder, controller);
      appendNodeChunks(target, Array.from(holder.childNodes), "予習スレッド", "prepPostTitle", posts);
      return { posts };
    }

    const titleMatch = lines[titleIndex].match(/^#\s+(.+)$/);
    const titlePost = createPost("予習スレッド", "prepPostTitle");
    const title = document.createElement("h2");
    title.innerHTML = inlineMarkup(titleMatch[1]);
    titlePost.body.appendChild(title);
    const taskContext = document.createElement("p");
    taskContext.className = "prepTaskContext";
    taskContext.textContent = task.label;
    titlePost.body.appendChild(taskContext);
    titlePost.post.dataset.charCount = String(nodeCharacterCount(titlePost.body));
    titlePost.post.dataset.charLimit = String(PREPARATION_POST_CHAR_LIMIT);
    target.appendChild(titlePost.post);
    posts.push(titlePost.post);

    let cursor = titleIndex + 1;
    if (cursor < lines.length && imageMatch(lines[cursor])) cursor += 1;
    const remaining = lines.slice(cursor);
    const firstSectionIndex = remaining.findIndex(line => /^##\s+/.test(line));
    const introLines = firstSectionIndex < 0 ? remaining : remaining.slice(0, firstSectionIndex);
    if (hasContent(introLines)) {
      const holder = document.createElement("div");
      renderLines(introLines, holder, controller);
      appendNodeChunks(target, Array.from(holder.childNodes), "予習スレッド", "prepPostIntro", posts);
    }

    if (firstSectionIndex < 0) return { posts };
    const sections = [];
    let section = [];
    remaining.slice(firstSectionIndex).forEach(line => {
      if (/^##\s+/.test(line) && section.length) {
        sections.push(section);
        section = [];
      }
      section.push(line);
    });
    if (section.length) sections.push(section);

    sections.forEach((sectionLines, index) => {
      const holder = document.createElement("div");
      renderLines(sectionLines, holder, controller);
      appendNodeChunks(
        target,
        Array.from(holder.childNodes),
        (index + 1) + " / " + sections.length,
        "",
        posts,
        index,
      );
    });
    return { posts };
  }

  function renderLines(lines, target, controller) {
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const titleImage = headingMatch[1].length === 1 && index + 1 < lines.length
          ? imageMatch(lines[index + 1])
          : null;
        if (titleImage) {
          const titleBlock = document.createElement("div");
          titleBlock.className = "prepMaterialTitle";
          titleBlock.appendChild(createPreparationImage(titleImage));
          const title = document.createElement("h2");
          title.innerHTML = inlineMarkup(headingMatch[2]);
          titleBlock.appendChild(title);
          target.appendChild(titleBlock);
          index += 2;
          continue;
        }
        const level = Math.min(4, headingMatch[1].length + 1);
        const heading = document.createElement("h" + level);
        heading.innerHTML = inlineMarkup(headingMatch[2]);
        target.appendChild(heading);
        index += 1;
        continue;
      }

      const standaloneImage = imageMatch(line);
      if (standaloneImage) {
        target.appendChild(createPreparationImage(standaloneImage));
        index += 1;
        continue;
      }

      if (/^---+\s*$/.test(trimmed)) {
        target.appendChild(document.createElement("hr"));
        index += 1;
        continue;
      }

      const calloutMatch = trimmed.match(/^:::(board|practice|check)(?:\s+([A-Za-z0-9_-]+))?\s*$/);
      if (calloutMatch) {
        const type = calloutMatch[1];
        const explicitId = calloutMatch[2] || "";
        const body = [];
        index += 1;
        while (index < lines.length && lines[index].trim() !== ":::") {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        appendCallout(target, type, body, explicitId, controller);
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        const quote = document.createElement("blockquote");
        quote.className = "prepQuote";
        appendParagraph(quote, quoteLines);
        target.appendChild(quote);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const listLines = [];
        while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
          listLines.push(lines[index]);
          index += 1;
        }
        appendList(target, listLines, false);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const listLines = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
          listLines.push(lines[index]);
          index += 1;
        }
        appendList(target, listLines, true);
        continue;
      }

      const paragraphLines = [line];
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (!next.trim() || /^(#{1,4})\s+/.test(next) || /^---+\s*$/.test(next.trim())
          || /^:::(board|practice|check)(?:\s+[A-Za-z0-9_-]+)?\s*$/.test(next.trim())
          || /^>\s?/.test(next) || /^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) {
          break;
        }
        paragraphLines.push(next);
        index += 1;
      }
      appendParagraph(target, paragraphLines);
    }
  }

  function button(className, label) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    return element;
  }

  function readProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREPARATION_STORE_KEY) || "{}");
      if (!parsed || parsed.version !== PREPARATION_PROGRESS_VERSION || !parsed.tasks) {
        return { version: PREPARATION_PROGRESS_VERSION, tasks: {} };
      }
      return parsed;
    } catch (_error) {
      return { version: PREPARATION_PROGRESS_VERSION, tasks: {} };
    }
  }

  function normalizeProgress(record) {
    return {
      postIndex: Number.isInteger(record && record.postIndex) ? Math.max(0, record.postIndex) : 0,
      checks: record && record.checks && typeof record.checks === "object" ? record.checks : {},
      completedAt: record && record.completedAt ? record.completedAt : "",
      updatedAt: record && record.updatedAt ? record.updatedAt : "",
    };
  }

  function loadProgress(taskId) {
    return normalizeProgress(readProgress().tasks[taskId]);
  }

  function saveProgress(taskId, record) {
    try {
      const progress = readProgress();
      progress.tasks[taskId] = record;
      localStorage.setItem(PREPARATION_STORE_KEY, JSON.stringify(progress));
    } catch (_error) {
      /* 学習自体は、保存できない環境でも続けられるようにする。 */
    }
  }

  function clearProgress() {
    try {
      localStorage.removeItem(PREPARATION_STORE_KEY);
    } catch (_error) {
      /* 保存領域が無効でも、画面のリセットは続ける。 */
    }
  }

  function createProgressHeader(task, posts, checks, progress, onJump) {
    const header = document.createElement("section");
    header.className = "prepProgressHeader";
    header.setAttribute("aria-label", "予習の進み具合");

    const heading = document.createElement("h2");
    heading.textContent = "予習の進み具合";
    header.appendChild(heading);
    const status = document.createElement("p");
    status.className = "prepProgressStatus";
    header.appendChild(status);

    const segments = document.createElement("div");
    segments.className = "prepProgressSegments";
    segments.setAttribute("role", "group");
    segments.setAttribute("aria-label", "投稿ごとの進捗");
    const segmentButtons = posts.map((post, index) => {
      const segment = button("prepProgressSegment", "");
      segment.setAttribute("aria-label", "投稿 " + (index + 1) + "へ移動");
      segment.addEventListener("click", () => onJump(index));
      segments.appendChild(segment);
      return segment;
    });
    header.appendChild(segments);

    const resume = button("ghost prepResumeButton", "");
    resume.addEventListener("click", () => onJump(Math.min(progress.postIndex, posts.length - 1)));
    header.appendChild(resume);

    function refresh() {
      const postCount = posts.length;
      const current = Math.min(Math.max(progress.postIndex, 0), Math.max(0, postCount - 1));
      const answered = checks.filter(check => progress.checks[check.dataset.checkId]).length;
      status.textContent = "投稿 " + (postCount ? current + 1 : 0) + " / " + postCount
        + " ・ 10秒確認 " + answered + " / " + checks.length
        + (progress.completedAt ? " ・確認済み" : "");
      segmentButtons.forEach((segment, index) => {
        segment.classList.toggle("is-done", index < current);
        segment.classList.toggle("is-current", index === current);
        segment.setAttribute("aria-current", index === current ? "step" : "false");
      });
      const hasResume = progress.postIndex > 0 && progress.postIndex < postCount - 1;
      resume.hidden = !hasResume;
      if (hasResume) resume.textContent = "前回の続き（投稿 " + (progress.postIndex + 1) + "）";
    }
    refresh();
    return { element: header, refresh };
  }

  function attachPostProgress(posts, onAdvance) {
    let ticking = false;
    const inspect = () => {
      if (!posts.length) return;
      let current = 0;
      const boundary = window.innerHeight * 0.55;
      posts.forEach((post, index) => {
        if (post.getBoundingClientRect().top <= boundary) current = index;
      });
      onAdvance(current);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        inspect();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    inspect();
    return () => window.removeEventListener("scroll", onScroll);
  }

  function renderError(thread, onBack) {
    thread.innerHTML = "";
    const error = document.createElement("div");
    error.className = "prepError";
    error.appendChild(document.createElement("strong")).textContent = "予習資料を読み込めませんでした。";
    error.appendChild(document.createElement("p")).textContent = "通信状態か資料の場所を確認して、もう一度試してください。";
    const back = button("ghost prepBack", "ロードマップへ戻る");
    back.addEventListener("click", onBack);
    error.appendChild(back);
    thread.appendChild(error);
  }

  // options.preparationの各エントリが{path, sections}を持つ。sectionsが空でなければ、
  // 該当する:::check <id>を含むH2ブロックだけを残す（見出し前の本文＝タイトル・導入は保持する）。
  // H2境界の判定はrenderThreadと同じ「## から次の## の直前まで」。一致するブロックが無い場合は
  // フィルタせず全文を返す（データ不整合時に空白ページになるのを避ける安全側の挙動）。
  function filterMarkdownBySections(markdown, sections) {
    if (!Array.isArray(sections) || !sections.length) return markdown;
    const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
    const firstH2 = lines.findIndex(line => /^##\s+/.test(line));
    if (firstH2 < 0) return markdown;
    const head = lines.slice(0, firstH2);
    const body = lines.slice(firstH2);
    const blocks = [];
    let current = [];
    body.forEach(line => {
      if (/^##\s+/.test(line) && current.length) {
        blocks.push(current);
        current = [];
      }
      current.push(line);
    });
    if (current.length) blocks.push(current);

    const wanted = new Set(sections);
    const matched = blocks.filter(block => block.some(line => {
      const m = line.trim().match(/^:::(?:board|practice|check)(?:\s+([A-Za-z0-9_-]+))?\s*$/);
      return m && m[1] && wanted.has(m[1]);
    }));
    if (!matched.length) return markdown;
    return head.concat(...matched).join("\n");
  }

  // options.preparation（[{path, sections}]の配列。1講に複数資料の可能性がある）を、
  // 後方互換のため options.path（単一パスの旧呼び出し）からも組み立てられるようにする。
  function normalizeMaterials(options) {
    if (Array.isArray(options.preparation) && options.preparation.length) return options.preparation;
    if (options.path) return [{ path: options.path, sections: [] }];
    return [];
  }

  function render(options) {
    const container = options.container;
    const task = options.task;
    const stage = options.stage || null;
    const materials = normalizeMaterials(options);
    const onBack = typeof options.onBack === "function" ? options.onBack : () => {};
    const onPractice = typeof options.onPractice === "function" ? options.onPractice : () => {};
    // 予習進捗は資料ファイルのパスではなく講（lesson.id、= stage.id）を基準に保存する。
    // 1講に複数資料がある場合は、講idに資料の並び番号を付けて資料ごとに独立させる。
    const lessonId = String((stage && stage.id) || (task && (task.id || task.label)) || "prep");

    activeCleanup();
    let disposed = false;
    let removePostProgress = () => {};
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      removePostProgress();
      if (activeCleanup === dispose) activeCleanup = () => {};
    };
    activeCleanup = dispose;

    document.body.classList.add("prepPageMode");
    window.scrollTo(0, 0);
    container.innerHTML = "";
    container.classList.remove("hide");

    const shell = document.createElement("div");
    shell.className = "prepShell";

    const leave = () => {
      dispose();
      document.body.classList.remove("prepPageMode");
      onBack();
    };
    const back = button("ghost prepBack", "← 学習ルートに戻る");
    back.addEventListener("click", leave);
    shell.appendChild(back);

    const thread = document.createElement("article");
    thread.className = "card prepThread";
    thread.dataset.postCharLimit = String(PREPARATION_POST_CHAR_LIMIT);
    thread.setAttribute("aria-live", "polite");
    shell.appendChild(thread);
    container.appendChild(shell);

    if (!materials.length) {
      renderError(thread, leave);
      return shell;
    }

    let progressView = null;

    function loadMaterial(index) {
      removePostProgress();
      removePostProgress = () => {};
      if (progressView && progressView.element.isConnected) shell.removeChild(progressView.element);
      progressView = null;

      const material = materials[index];
      const taskId = materials.length > 1 ? lessonId + ":" + index : lessonId;
      const progress = loadProgress(taskId);
      const progressController = {
        checkIds: [],
        recordCheck(checkId, choice, correct) {
          progress.checks[checkId] = {
            choice,
            correct,
            answeredAt: new Date().toISOString(),
          };
          const complete = this.checkIds.length > 0
            && this.checkIds.every(id => progress.checks[id]);
          progress.completedAt = complete ? (progress.completedAt || new Date().toISOString()) : "";
          progress.updatedAt = new Date().toISOString();
          saveProgress(taskId, progress);
          if (progressView) progressView.refresh();
        },
      };

      thread.innerHTML = "";
      const loading = document.createElement("p");
      loading.className = "hint prepLoading";
      loading.textContent = "予習資料を開いています…";
      thread.appendChild(loading);

      const path = material.path;
      const query = path.includes("?") ? "&" : "?";
      fetch(path + query + "v=0.4.1")
        .then(response => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.text();
        })
        .then(markdown => {
          if (!shell.isConnected || disposed) return;
          const filtered = filterMarkdownBySections(markdown, material.sections);
          thread.innerHTML = "";
          const content = document.createElement("div");
          content.className = "prepContent";
          const parsed = renderThread(filtered, content, task, progressController);
          thread.appendChild(content);

          const checks = Array.from(content.querySelectorAll(".prep-check-interactive"));
          progressController.checkIds = checks.map(check => check.dataset.checkId);
          checks.forEach(check => {
            const saved = progress.checks[check.dataset.checkId];
            if (saved && saved.choice) setCheckResult(check, saved.choice, progressController, false);
          });

          const isLast = index >= materials.length - 1;
          const footer = document.createElement("div");
          footer.className = "prepFooter";
          footer.appendChild(document.createElement("p")).textContent = isLast
            ? "読み終えたら、同じ単元の問題で確かめます。"
            : "読み終えたら、次の資料に進みます。";
          const nextButton = button("cta prepPracticeButton", isLast ? "この単元の問題へ" : "次の資料へ →");
          nextButton.addEventListener("click", () => {
            if (isLast) {
              dispose();
              document.body.classList.remove("prepPageMode");
              onPractice();
            } else {
              loadMaterial(index + 1);
            }
          });
          footer.appendChild(nextButton);
          thread.appendChild(footer);

          const jumpToPost = postIndex => {
            const post = parsed.posts[postIndex];
            if (post) post.scrollIntoView({ behavior: "smooth", block: "start" });
          };
          progressView = createProgressHeader(task, parsed.posts, checks, progress, jumpToPost);
          shell.insertBefore(progressView.element, thread);
          window.scrollTo(0, 0);
          removePostProgress = attachPostProgress(parsed.posts, current => {
            if (current <= progress.postIndex) return;
            progress.postIndex = current;
            progress.updatedAt = new Date().toISOString();
            saveProgress(taskId, progress);
            if (progressView) progressView.refresh();
          });
          progressView.refresh();
        })
        .catch(() => {
          if (shell.isConnected && !disposed) renderError(thread, leave);
        });
    }

    loadMaterial(0);
    return shell;
  }

  return { render, clearProgress };
})();
