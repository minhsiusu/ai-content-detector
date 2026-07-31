const axios = require("axios");
const c2paDetector = require("./c2pa-detector");

const SIGHTENGINE_ENDPOINT =
  "https://api.sightengine.com/1.0/check.json";

const createModelError = (message, code, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const isImageModelConfigured = () => Boolean(
  process.env.SIGHTENGINE_ENABLED === "true" &&
  process.env.SIGHTENGINE_API_USER &&
  process.env.SIGHTENGINE_API_SECRET
);

const describeSightengineError = error => {
  const status = error.response && error.response.status;
  const data = error.response && error.response.data;
  const apiMessage = data && data.error &&
    (data.error.message || data.error.type);

  if (status === 401 || status === 403) {
    return createModelError(
      "Sightengine API User 或 API Secret 無效，或帳戶沒有圖片偵測權限。",
      "IMAGE_MODEL_UNAUTHORIZED",
      status
    );
  }
  if (status === 429) {
    return createModelError(
      "Sightengine 免費額度或速率限制已達上限，請稍後再試。",
      "IMAGE_MODEL_RATE_LIMITED",
      429
    );
  }
  if (status === 400) {
    return createModelError(
      `Sightengine 無法分析此圖片：${apiMessage || "圖片網址或格式不受支援。"}`,
      "IMAGE_MODEL_BAD_REQUEST",
      400
    );
  }
  if (error.code === "ECONNABORTED") {
    return createModelError(
      "Sightengine 圖片分析逾時，請稍後再試。",
      "IMAGE_MODEL_TIMEOUT",
      504
    );
  }
  return createModelError(
    apiMessage
      ? `Sightengine 圖片分析失敗：${apiMessage}`
      : "無法連線到 Sightengine，請檢查網路後再試。",
    "IMAGE_MODEL_REQUEST_FAILED",
    502
  );
};

const getTopGenerators = scores => {
  if (!scores || typeof scores !== "object") return [];
  return Object.entries(scores)
    .map(([name, value]) => ({
      name,
      score: Math.round(Number(value) * 100)
    }))
    .filter(item => Number.isFinite(item.score) && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};

exports.isImageModelConfigured = isImageModelConfigured;

exports.analyze = async ({ imageUrl }) => {
  if (!isImageModelConfigured()) {
    throw createModelError(
      "尚未設定 Sightengine API User、API Secret 或啟用狀態。",
      "MODEL_NOT_CONFIGURED",
      503
    );
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw createModelError(
      "目前只能分析具有公開 http/https 網址的圖片。",
      "IMAGE_URL_NOT_PUBLIC",
      400
    );
  }

  let response;
  const c2paPromise = c2paDetector.inspectImageUrl(imageUrl);
  try {
    response = await axios.get(SIGHTENGINE_ENDPOINT, {
      timeout: 45000,
      params: {
        url: imageUrl,
        models: "genai",
        api_user: process.env.SIGHTENGINE_API_USER,
        api_secret: process.env.SIGHTENGINE_API_SECRET
      }
    });
  } catch (error) {
    throw describeSightengineError(error);
  }

  if (response.data.status !== "success") {
    const apiMessage = response.data.error &&
      (response.data.error.message || response.data.error.type);
    throw createModelError(
      `Sightengine 圖片分析失敗：${apiMessage || "未知錯誤"}`,
      "IMAGE_MODEL_FAILED",
      502
    );
  }

  const rawScore = Number(
    response.data.type && response.data.type.ai_generated
  );
  if (!Number.isFinite(rawScore)) {
    throw createModelError(
      "Sightengine 沒有回傳有效的 AI 圖片分數。",
      "IMAGE_MODEL_INVALID_RESPONSE",
      502
    );
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));
  const c2pa = await c2paPromise;
  return {
    score,
    label: "AI 生成或 AI 編輯像素風險",
    provider: "Sightengine",
    modelVersion: "genai",
    generators: getTopGenerators(
      response.data.type && response.data.type.ai_generators
    ),
    operations: response.data.request && response.data.request.operations,
    c2pa,
    warning: "此分數來自像素模型，只代表模型信心，不能單獨證明圖片來源。"
  };
};
