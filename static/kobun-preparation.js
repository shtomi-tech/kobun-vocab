"use strict";

/* 文法ロードマップの予習資料。Markdownのうち、教材で使う小さな記法だけを描画する。 */
const KobunPreparation = (function () {
  const PREPARATION_POST_CHAR_LIMIT = 280;
  const CALLOUT_LABELS = {
    board: "板書",
    practice: "次の一歩",
  };
  const TRUSTED_IMAGE_SOURCE = /^(?:static|data)\/[A-Za-z0-9._/-]+$/;

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
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
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

  function appendCallout(target, type, lines) {
    const box = document.createElement("section");
    box.className = "prepCallout prepCallout-" + type;
    const heading = document.createElement("h3");
    heading.textContent = CALLOUT_LABELS[type] || type;
    box.appendChild(heading);
    const body = document.createElement("div");
    body.className = "prepCalloutBody";
    renderLines(lines, body);
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

  function renderThread(markdown, target, task) {
    const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const titleIndex = lines.findIndex(line => /^#\s+/.test(line));
    if (titleIndex < 0) {
      const fallback = createPost("予習スレッド", "prepPostTitle");
      renderLines(lines, fallback.body);
      target.appendChild(fallback.post);
      return;
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
    target.appendChild(titlePost.post);

    let cursor = titleIndex + 1;
    if (cursor < lines.length && imageMatch(lines[cursor])) cursor += 1;
    const remaining = lines.slice(cursor);
    const firstSectionIndex = remaining.findIndex(line => /^##\s+/.test(line));
    const introLines = firstSectionIndex < 0 ? remaining : remaining.slice(0, firstSectionIndex);
    if (hasContent(introLines)) {
      const intro = createPost("予習スレッド", "prepPostIntro");
      renderLines(introLines, intro.body);
      target.appendChild(intro.post);
    }

    if (firstSectionIndex < 0) return;
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

    const numberedTotal = Math.max(1, sections.length - 1);
    sections.forEach((sectionLines, index) => {
      const label = index === 0 && sections.length > 1
        ? "予習スレッド"
        : (index === 0 ? "予習スレッド" : index + " / " + numberedTotal);
      const post = createPost(label);
      renderLines(sectionLines, post.body);
      target.appendChild(post.post);
    });
  }

  function renderLines(lines, target) {
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

      const calloutMatch = trimmed.match(/^:::(board|practice)\s*$/);
      if (calloutMatch) {
        const type = calloutMatch[1];
        const body = [];
        index += 1;
        while (index < lines.length && lines[index].trim() !== ":::") {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        appendCallout(target, type, body);
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
          || /^:::(board|practice)\s*$/.test(next.trim())
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

  function render(options) {
    const container = options.container;
    const task = options.task;
    const stage = options.stage;
    const path = options.path;
    const onBack = typeof options.onBack === "function" ? options.onBack : () => {};
    const onPractice = typeof options.onPractice === "function" ? options.onPractice : () => {};

    document.body.classList.add("prepPageMode");
    window.scrollTo(0, 0);
    container.innerHTML = "";
    container.classList.remove("hide");

    const shell = document.createElement("div");
    shell.className = "prepShell";

    const leave = () => {
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
    const loading = document.createElement("p");
    loading.className = "hint prepLoading";
    loading.textContent = "予習資料を開いています…";
    thread.appendChild(loading);
    shell.appendChild(thread);
    container.appendChild(shell);

    const query = path.includes("?") ? "&" : "?";
    fetch(path + query + "v=0.2.1")
      .then(response => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(markdown => {
        if (!shell.isConnected) return;
        thread.innerHTML = "";
        const content = document.createElement("div");
        content.className = "prepContent";
        renderThread(markdown, content, task);
        content.querySelectorAll(".prepPost").forEach(post => {
          const body = post.querySelector(".prepPostBody");
          if (!body) return;
          post.dataset.charCount = String(Array.from(body.textContent || "").length);
          post.dataset.charLimit = String(PREPARATION_POST_CHAR_LIMIT);
        });
        thread.appendChild(content);

        const footer = document.createElement("div");
        footer.className = "prepFooter";
        footer.appendChild(document.createElement("p")).textContent = "読み終えたら、同じ単元の問題で確かめます。";
        const practice = button("cta prepPracticeButton", "この単元の問題へ");
        practice.addEventListener("click", () => {
          document.body.classList.remove("prepPageMode");
          onPractice();
        });
        footer.appendChild(practice);
        thread.appendChild(footer);
      })
      .catch(() => {
        if (shell.isConnected) renderError(thread, leave);
      });

    return shell;
  }

  return { render };
})();
