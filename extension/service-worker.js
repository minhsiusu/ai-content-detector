const API_BASE_URL = "http://localhost:3200";

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (error) {
    console.error("Unable to start detector", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const endpoints = {
    ANALYZE_ARTICLE: "/api/detect",
    ANALYZE_IMAGE: "/api/detect-image"
  };
  const endpoint = endpoints[message.type];
  if (!endpoint) return false;

  fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message.payload)
  })
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "分析失敗");
      sendResponse({ ok: true, data });
    })
    .catch(error => {
      sendResponse({
        ok: false,
        message: error.message || "無法連接分析服務"
      });
    });

  return true;
});
