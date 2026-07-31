// Runs inside the active webpage and provides text/image selection tools.
(() => {
  const PANEL_ID = "ai-detector-panel";
  const OVERLAY_ID = "ai-detector-overlay";
  const BOX_ID = "ai-detector-selection-box";
  const MARKER_CLASS = "ai-detector-highlight";

  const oldInstance = window.__aiContentDetector;
  if (oldInstance) {
    oldInstance.openMenu();
    return;
  }

  const state = {
    selecting: false,
    startX: 0,
    startY: 0,
    overlay: null,
    box: null,
    highlightedRange: null,
    pendingSelectionText: "",
    pendingSelectionRange: null,
    imagePicking: false,
    hoveredImage: null
  };

  const escapeHtml = value => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const removeElementHighlights = () => {
    document.querySelectorAll(`.${MARKER_CLASS}`).forEach(element => {
      element.classList.remove(
        MARKER_CLASS,
        "ai-detector-low",
        "ai-detector-medium",
        "ai-detector-high"
      );
      element.removeAttribute("data-ai-score");
      element.querySelector(":scope > .ai-detector-badge")?.remove();
    });
  };

  const removeTextHighlight = () => {
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete("ai-detector-selection");
    }
    state.highlightedRange = null;
  };

  const removeOverlay = () => {
    state.selecting = false;
    state.overlay?.remove();
    state.overlay = null;
    state.box = null;
  };

  const stopImageSelection = () => {
    state.imagePicking = false;
    state.hoveredImage?.classList.remove("ai-detector-image-target");
    state.hoveredImage = null;
    document.documentElement.classList.remove("ai-detector-image-picking");
    document.removeEventListener("mousemove", handleImageHover, true);
    document.removeEventListener("click", handleImageClick, true);
  };

  const clearResults = () => {
    removeElementHighlights();
    removeTextHighlight();
    removeOverlay();
    stopImageSelection();
  };

  const closeDetector = () => {
    clearResults();
    document.getElementById(PANEL_ID)?.remove();
  };

  const getPanel = () => {
    let panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement("aside");
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    return panel;
  };

  const setPanel = (title, body, type = "menu") => {
    const panel = getPanel();
    panel.className = `ai-detector-panel ai-detector-panel-${type}`;
    panel.innerHTML = `
      <button class="ai-detector-close" type="button" aria-label="關閉">×</button>
      <strong class="ai-detector-title">${escapeHtml(title)}</strong>
      <div class="ai-detector-panel-body">${body}</div>
    `;
    panel.querySelector(".ai-detector-close")
      .addEventListener("click", closeDetector);
    return panel;
  };

  const openMenu = () => {
    removeOverlay();
    const currentSelection = window.getSelection();
    const currentText = currentSelection?.toString().trim() || "";
    if (currentText && currentSelection.rangeCount) {
      state.pendingSelectionText = currentText;
      state.pendingSelectionRange = currentSelection.getRangeAt(0).cloneRange();
    }
    const selectionLength = state.pendingSelectionText.length;
    const panel = setPanel(
      "選擇偵測方式",
      `
        <p class="ai-detector-hint">你想分析目前網頁的哪一部分？</p>
        <button class="ai-detector-action" data-mode="article" type="button">
          <span>▤</span>
          <span><b>整篇文章</b><small>自動尋找主要文章段落</small></span>
        </button>
        <button class="ai-detector-action" data-mode="selection" type="button">
          <span>▰</span>
          <span>
            <b>反白文字</b>
            <small>${selectionLength ? `已選取 ${selectionLength} 字` : "先在網頁反白一段文字"}</small>
          </span>
        </button>
        <button class="ai-detector-action" data-mode="area" type="button">
          <span>⌗</span>
          <span><b>拖曳框選</b><small>按住滑鼠左鍵拉出分析範圍</small></span>
        </button>
        <button class="ai-detector-action" data-mode="image" type="button">
          <span>▧</span>
          <span><b>點選圖片</b><small>分析網頁中的單張圖片</small></span>
        </button>
        <button class="ai-detector-secondary" data-mode="clear" type="button">
          清除全部標記
        </button>
      `
    );

    panel.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode;
        if (mode === "article") analyzeArticle();
        if (mode === "selection") analyzeSelection();
        if (mode === "area") startAreaSelection();
        if (mode === "image") startImageSelection();
        if (mode === "clear") {
          clearResults();
          openMenu();
        }
      });
    });
  };

  const findArticleRoot = () => {
    const selectors = [
      "article",
      "[itemprop='articleBody']",
      ".article-content",
      ".post-content",
      ".entry-content",
      ".story-body",
      "main"
    ];

    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => element && element.innerText.trim().length >= 200);
  };

  const elementsToParagraphs = elements => {
    const seen = new Set();

    return elements
      .filter(element => {
        if (!element || seen.has(element)) return false;
        seen.add(element);
        return true;
      })
      .map((element, index) => ({
        id: `ai-detector-${index}`,
        element,
        text: element.innerText.trim()
      }))
      .filter(item => item.text.length >= 30)
      .slice(0, 100);
  };

  const extractArticleParagraphs = articleRoot => {
    return elementsToParagraphs([
      ...articleRoot.querySelectorAll("p, h2, h3, blockquote, li")
    ]);
  };

  const sendForAnalysis = async paragraphs => {
    setPanel("AI 文章偵測器", "正在分析文字，請稍候……", "loading");

    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_ARTICLE",
      payload: {
        url: location.href,
        title: document.title,
        paragraphs: paragraphs.map(({ id, text }) => ({ id, text }))
      }
    });

    if (!response?.ok) {
      throw new Error(response?.message || "無法連接分析服務");
    }

    return response.data;
  };

  const getRiskLabel = risk => {
    if (risk === "high") return "高";
    if (risk === "medium") return "中";
    return "低";
  };

  const showResult = result => {
    const providerLabel = result.provider || "未知來源";
    const signalItems = Array.isArray(result.signals)
      ? result.signals.slice(0, 6).map(signal => `
        <li class="ai-detector-signal">
          <strong>${escapeHtml(signal.category || "特徵")}</strong>
          <span>${escapeHtml(signal.reason || "")}</span>
          ${signal.evidence
            ? `<q>${escapeHtml(signal.evidence)}</q>`
            : ""}
        </li>
      `).join("")
      : "";
    const panel = setPanel(
      "分析完成",
      `
        <button class="ai-detector-back" data-action="back" type="button">
          ← 返回偵測選項
        </button>
        <div class="ai-detector-score ai-detector-score-${result.overallScore >= 70 ? "high" : result.overallScore >= 30 ? "medium" : "low"}">
          ${result.overallScore}%
        </div>
        <div class="ai-detector-score-caption">AI 內容占比</div>
        <div class="ai-detector-summary">
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">段落</span>
            <span class="ai-detector-summary-value">${result.paragraphCount}</span>
          </div>
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">字數</span>
            <span class="ai-detector-summary-value">${result.analyzedCharacters}</span>
          </div>
          ${result.language ? `
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">文章語言</span>
            <span class="ai-detector-summary-value">${escapeHtml(result.language.label || result.language.code)}</span>
          </div>` : ""}
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">偵測來源</span>
            <span class="ai-detector-summary-value">${escapeHtml(providerLabel)}</span>
          </div>
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">模型版本</span>
            <span class="ai-detector-summary-value">${escapeHtml(result.modelVersion || "未知")}</span>
          </div>
          ${result.evasionRiskScore != null ? `
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">規避風險</span>
            <span class="ai-detector-summary-value">${result.evasionRiskScore}%</span>
          </div>` : ""}
          ${result.totalWords != null ? `
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">計費字數</span>
            <span class="ai-detector-summary-value">${result.totalWords}</span>
          </div>` : ""}
          ${result.creditsUsed != null ? `
          <div class="ai-detector-summary-row">
            <span class="ai-detector-summary-label">本次額度</span>
            <span class="ai-detector-summary-value">${result.creditsUsed} credits</span>
          </div>` : ""}
        </div>
        ${result.summary ? `
        <div class="ai-detector-explanation">
          <strong>分析摘要</strong>
          <p>${escapeHtml(result.summary)}</p>
        </div>` : ""}
        ${signalItems ? `
        <div class="ai-detector-explanation">
          <strong>命中特徵</strong>
          <ul class="ai-detector-signals">${signalItems}</ul>
        </div>` : ""}
        <div class="ai-detector-legend">
          <span class="ai-detector-dot ai-detector-dot-low"></span>低
          <span class="ai-detector-dot ai-detector-dot-medium"></span>中
          <span class="ai-detector-dot ai-detector-dot-high"></span>高
        </div>
        <p class="ai-detector-warning">${
          result.overallScore === 0
            ? "本次未偵測到明顯 AI 分類區段；不代表能證明內容一定由人撰寫。"
            : escapeHtml(result.warning)
        }</p>
        <button class="ai-detector-secondary" data-action="back" type="button">
          返回偵測選項
        </button>
      `,
      "success"
    );

    panel.querySelectorAll("[data-action='back']").forEach(button => {
      button.addEventListener("click", openMenu);
    });
  };

  const highlightElements = (localParagraphs, results) => {
    const resultMap = new Map(results.map(result => [result.id, result]));

    localParagraphs.forEach(paragraph => {
      const result = resultMap.get(paragraph.id);
      if (!result) return;

      paragraph.element.classList.add(
        MARKER_CLASS,
        `ai-detector-${result.risk}`
      );
      paragraph.element.dataset.aiScore = String(result.score);

      const badge = document.createElement("span");
      badge.className = `ai-detector-badge ai-detector-${result.risk}`;
      badge.textContent = `${getRiskLabel(result.risk)} · ${result.score}%`;
      paragraph.element.appendChild(badge);
    });
  };

  const analyzeParagraphs = async (paragraphs, options = {}) => {
    if (!paragraphs.length) {
      throw new Error("選取範圍內找不到至少 30 字的文字");
    }
    const totalCharacters = paragraphs.reduce((total, paragraph) => {
      return total + paragraph.text.length;
    }, 0);
    if (totalCharacters < 255) {
      throw new Error(
        `分析模型至少需要 255 個字元，目前只有 ${totalCharacters} 個。請多選一些文字。`
      );
    }

    const result = await sendForAnalysis(paragraphs);

    if (options.highlightElements !== false) {
      highlightElements(paragraphs, result.paragraphs);
    }
    showResult(result);
  };

  const analyzeArticle = async () => {
    clearResults();
    const articleRoot = findArticleRoot();

    if (!articleRoot) {
      setPanel("無法分析", "找不到足夠長度的文章主體。", "error");
      return;
    }

    try {
      await analyzeParagraphs(extractArticleParagraphs(articleRoot));
    } catch (error) {
      setPanel("分析失敗", escapeHtml(error.message), "error");
    }
  };

  const highlightSelectedRange = range => {
    removeTextHighlight();
    state.highlightedRange = range.cloneRange();

    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set(
        "ai-detector-selection",
        new Highlight(state.highlightedRange)
      );
    }
  };

  const analyzeSelection = async () => {
    const selection = window.getSelection();
    const currentText = selection?.toString().trim() || "";
    const text = currentText || state.pendingSelectionText;
    const range = currentText && selection.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : state.pendingSelectionRange?.cloneRange();

    if (text.length < 255 || !range) {
      setPanel(
        "尚未選取文字",
        `請先用滑鼠反白至少 255 個字元；目前只有 ${text.length} 個。`,
        "error"
      );
      return;
    }

    highlightSelectedRange(range);
    selection?.removeAllRanges();

    try {
      await analyzeParagraphs(
        [{ id: "selected-text", text, element: null }],
        { highlightElements: false }
      );
    } catch (error) {
      setPanel("分析失敗", escapeHtml(error.message), "error");
    }
  };

  const getRect = () => {
    const left = Math.min(state.startX, state.currentX);
    const top = Math.min(state.startY, state.currentY);
    const right = Math.max(state.startX, state.currentX);
    const bottom = Math.max(state.startY, state.currentY);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  };

  const updateSelectionBox = () => {
    const rect = getRect();
    Object.assign(state.box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };

  const collectElementsInRect = rect => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.nodeValue.replace(/\s+/g, " ").trim();
          const parent = node.parentElement;
          if (!text || !parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(`#${PANEL_ID}, #${OVERLAY_ID}, script, style, noscript`)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const selectedNodes = [];
    let node;

    while ((node = walker.nextNode())) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const intersects = [...range.getClientRects()].some(box => (
        box.right >= rect.left &&
        box.left <= rect.right &&
        box.bottom >= rect.top &&
        box.top <= rect.bottom
      ));
      if (intersects) selectedNodes.push(node);
      range.detach();
    }

    return selectedNodes;
  };

  const textNodesToParagraphs = nodes => {
    const groups = new Map();

    nodes.forEach(node => {
      const parent = node.parentElement.closest(
        "p, li, blockquote, h1, h2, h3, h4, article, section, div"
      ) || node.parentElement;
      const value = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!value) return;
      const current = groups.get(parent) || [];
      current.push(value);
      groups.set(parent, current);
    });

    const paragraphs = [...groups.entries()]
      .map(([element, values], index) => ({
        id: `ai-detector-area-${index}`,
        element,
        text: values.join(" ").trim()
      }))
      .filter(item => item.text.length >= 30);

    if (paragraphs.length) return paragraphs.slice(0, 100);

    const combinedText = nodes
      .map(node => node.nodeValue.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");

    if (combinedText.length < 30) return [];

    return [{
      id: "ai-detector-area-combined",
      element: null,
      text: combinedText
    }];
  };

  const finishAreaSelection = async () => {
    const rect = getRect();
    const textNodes = collectElementsInRect(rect);
    removeOverlay();

    if (rect.width < 20 || rect.height < 20) {
      openMenu();
      return;
    }

    try {
      const paragraphs = textNodesToParagraphs(textNodes);
      await analyzeParagraphs(paragraphs, {
        highlightElements: paragraphs.every(item => item.element)
      });
    } catch (error) {
      setPanel("框選失敗", escapeHtml(error.message), "error");
    }
  };

  const startAreaSelection = () => {
    removeOverlay();
    document.getElementById(PANEL_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="ai-detector-area-help">
        按住滑鼠左鍵拖出範圍 · Esc 取消
      </div>
      <div id="${BOX_ID}"></div>
    `;
    document.body.appendChild(overlay);

    state.overlay = overlay;
    state.box = overlay.querySelector(`#${BOX_ID}`);

    overlay.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      state.selecting = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.currentX = event.clientX;
      state.currentY = event.clientY;
      updateSelectionBox();
    });

    overlay.addEventListener("mousemove", event => {
      if (!state.selecting) return;
      state.currentX = event.clientX;
      state.currentY = event.clientY;
      updateSelectionBox();
    });

    overlay.addEventListener("mouseup", event => {
      if (!state.selecting || event.button !== 0) return;
      state.currentX = event.clientX;
      state.currentY = event.clientY;
      state.selecting = false;
      finishAreaSelection();
    });
  };

  function handleImageHover(event) {
    if (!state.imagePicking) return;
    const image = event.target.closest && event.target.closest("img");
    if (image === state.hoveredImage) return;

    state.hoveredImage?.classList.remove("ai-detector-image-target");
    state.hoveredImage = image || null;
    state.hoveredImage?.classList.add("ai-detector-image-target");
  }

  async function handleImageClick(event) {
    if (!state.imagePicking) return;
    const image = event.target.closest && event.target.closest("img");
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    const imageUrl = image.currentSrc || image.src;
    stopImageSelection();
    setPanel("AI 圖片偵測器", "正在準備圖片分析……", "loading");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_IMAGE",
        payload: {
          url: location.href,
          title: document.title,
          imageUrl,
          alt: image.alt || ""
        }
      });

      if (!response?.ok) {
        throw new Error(response?.message || "圖片分析失敗");
      }

      const result = response.data;
      const generatorItems = Array.isArray(result.generators)
        ? result.generators.map(generator => `
          <li class="ai-detector-generator">
            <span>${escapeHtml(generator.name)}</span>
            <strong>${generator.score}%</strong>
          </li>
        `).join("")
        : "";
      const c2pa = result.c2pa || {};
      const c2paStatusLabel = c2pa.status === "found"
        ? "找到內容憑證"
        : c2pa.status === "not-found"
          ? "未找到內容憑證"
          : "無法檢查";
      const signatureLabel = c2pa.signature === "valid"
        ? "有效"
        : c2pa.signature === "invalid"
          ? "無效或不受信任"
          : "未確認";
      const panel = setPanel(
        "圖片分析完成",
        `
          <img class="ai-detector-preview" src="${escapeHtml(imageUrl)}" alt="">
          <div class="ai-detector-score ai-detector-score-${result.score >= 70 ? "high" : result.score >= 30 ? "medium" : "low"}">
            ${result.score}%
          </div>
          <div class="ai-detector-explanation">
            <strong>C2PA 內容憑證</strong>
            <div class="ai-detector-summary">
              <div class="ai-detector-summary-row">
                <span class="ai-detector-summary-label">憑證狀態</span>
                <span class="ai-detector-summary-value">${escapeHtml(c2paStatusLabel)}</span>
              </div>
              ${c2pa.status === "found" ? `
              <div class="ai-detector-summary-row">
                <span class="ai-detector-summary-label">簽章驗證</span>
                <span class="ai-detector-summary-value">${escapeHtml(signatureLabel)}</span>
              </div>
              <div class="ai-detector-summary-row">
                <span class="ai-detector-summary-label">AI 聲明</span>
                <span class="ai-detector-summary-value">${c2pa.aiGenerated ? "有" : "未發現"}</span>
              </div>
              ${c2pa.generator ? `
              <div class="ai-detector-summary-row">
                <span class="ai-detector-summary-label">建立工具</span>
                <span class="ai-detector-summary-value">${escapeHtml(c2pa.generator)}</span>
              </div>` : ""}` : ""}
              ${c2pa.error ? `
              <div class="ai-detector-summary-row">
                <span class="ai-detector-summary-label">檢查訊息</span>
                <span class="ai-detector-summary-value">${escapeHtml(c2pa.error)}</span>
              </div>` : ""}
            </div>
          </div>
          <p>${escapeHtml(result.label || "AI 圖片特徵分數")}</p>
          <div class="ai-detector-summary">
            <div class="ai-detector-summary-row">
              <span class="ai-detector-summary-label">偵測來源</span>
              <span class="ai-detector-summary-value">${escapeHtml(result.provider || "未知")}</span>
            </div>
            <div class="ai-detector-summary-row">
              <span class="ai-detector-summary-label">模型代碼</span>
              <span class="ai-detector-summary-value">${escapeHtml(result.modelVersion || "未知")}</span>
            </div>
            ${result.operations != null ? `
            <div class="ai-detector-summary-row">
              <span class="ai-detector-summary-label">本次用量</span>
              <span class="ai-detector-summary-value">${result.operations} operations</span>
            </div>` : ""}
          </div>
          ${generatorItems ? `
          <div class="ai-detector-explanation">
            <strong>可能的生成器特徵</strong>
            <ul class="ai-detector-generators">${generatorItems}</ul>
          </div>` : ""}
          <p class="ai-detector-warning">${escapeHtml(result.warning)}</p>
          <button class="ai-detector-secondary" data-action="back" type="button">返回偵測選項</button>
        `,
        "success"
      );
      panel.querySelector("[data-action='back']").addEventListener("click", openMenu);
    } catch (error) {
      setPanel("圖片分析尚不可用", escapeHtml(error.message), "error");
    }
  }

  const startImageSelection = () => {
    removeOverlay();
    document.getElementById(PANEL_ID)?.remove();
    state.imagePicking = true;
    document.documentElement.classList.add("ai-detector-image-picking");
    document.addEventListener("mousemove", handleImageHover, true);
    document.addEventListener("click", handleImageClick, true);
  };

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.overlay) {
      removeOverlay();
      openMenu();
    }
    if (event.key === "Escape" && state.imagePicking) {
      stopImageSelection();
      openMenu();
    }
  });

  window.__aiContentDetector = {
    openMenu,
    closeDetector,
    clearResults
  };

  openMenu();
})();
