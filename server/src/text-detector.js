const axios = require("axios");
const {
  SYSTEM_PROMPT,
  buildUserPrompt
} = require("./prompts/text-analysis-prompt");
const traditionalChineseDetector = require("./traditional-chinese-detector");

const MIN_CHARACTERS = 255;
const MAX_CHARACTERS = 50000;
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    aiRiskScore: {
      type: "integer",
      minimum: 0,
      maximum: 100
    },
    evasionRiskScore: {
      type: "integer",
      minimum: 0,
      maximum: 100
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"]
    },
    label: {
      type: "string",
      enum: ["low", "medium", "high"]
    },
    signals: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          evidence: { type: "string" },
          reason: { type: "string" }
        },
        required: ["category", "severity", "evidence", "reason"]
      }
    },
    summary: { type: "string" },
    limitations: { type: "string" }
  },
  required: [
    "aiRiskScore",
    "evasionRiskScore",
    "confidence",
    "label",
    "signals",
    "summary",
    "limitations"
  ]
};

const createModelError = (message, code, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const validateScore = (value, fieldName) => {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw createModelError(
      `Gemini 回傳的 ${fieldName} 格式不正確。`,
      "MODEL_INVALID_RESPONSE",
      502
    );
  }
  return value;
};

const validateEnum = (value, allowed, fieldName) => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw createModelError(
      `Gemini 回傳的 ${fieldName} 格式不正確。`,
      "MODEL_INVALID_RESPONSE",
      502
    );
  }
  return value;
};

const validateText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw createModelError(
      `Gemini 回傳的 ${fieldName} 格式不正確。`,
      "MODEL_INVALID_RESPONSE",
      502
    );
  }
  return value.trim();
};

const isTextModelConfigured = () => Boolean(
  process.env.GEMINI_ENABLED === "true" &&
  process.env.GEMINI_API_KEY &&
  process.env.GEMINI_MODEL
);

const combineParagraphs = paragraphs => {
  return paragraphs.map(paragraph => paragraph.text).join("\n\n");
};

const describeGeminiError = error => {
  const status = error.response && error.response.status;
  const responseError = error.response &&
    error.response.data &&
    error.response.data.error;
  const apiMessage = responseError && responseError.message;

  if (status === 400) {
    return createModelError(
      `Gemini 請求格式錯誤：${apiMessage || "請檢查模型與輸入內容。"}`,
      "MODEL_BAD_REQUEST",
      400
    );
  }
  if (status === 401 || status === 403) {
    return createModelError(
      "Gemini API Key 無效、權限不足，或所在地區無法使用此模型。",
      "MODEL_UNAUTHORIZED",
      status
    );
  }
  if (status === 429) {
    return createModelError(
      "Gemini 免費額度或速率限制已達上限，請稍後再試或檢查 AI Studio Usage。",
      "MODEL_RATE_LIMITED",
      429
    );
  }
  if (error.code === "ECONNABORTED") {
    return createModelError(
      "Gemini 分析逾時，請稍後再試。",
      "MODEL_TIMEOUT",
      504
    );
  }
  return createModelError(
    apiMessage
      ? `Gemini 分析失敗：${apiMessage}`
      : "無法連線到 Gemini，請檢查網路後再試。",
    "MODEL_REQUEST_FAILED",
    502
  );
};

const extractResponseText = response => {
  const candidates = response.data.candidates || [];
  const parts = candidates[0] &&
    candidates[0].content &&
    candidates[0].content.parts;
  const text = Array.isArray(parts)
    ? parts.map(part => part.text || "").join("")
    : "";

  if (!text) {
    const blockReason = response.data.promptFeedback &&
      response.data.promptFeedback.blockReason;
    throw createModelError(
      blockReason
        ? `Gemini 拒絕分析此內容：${blockReason}`
        : "Gemini 沒有回傳分析內容。",
      "MODEL_EMPTY_RESPONSE",
      502
    );
  }
  return text;
};

const validateSignal = signal => {
  if (!signal || typeof signal !== "object") {
    throw createModelError(
      "Gemini 回傳的信號格式不正確。",
      "MODEL_INVALID_RESPONSE",
      502
    );
  }

  return {
    category: validateText(signal.category, "信號分類"),
    severity: validateEnum(
      signal.severity,
      ["low", "medium", "high"],
      "信號嚴重度"
    ),
    evidence: validateText(signal.evidence, "信號證據"),
    reason: validateText(signal.reason, "信號原因")
  };
};

const parseAnalysis = text => {
  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch (error) {
    throw createModelError(
      "Gemini 回傳的分析結果不是有效 JSON。",
      "MODEL_INVALID_RESPONSE",
      502
    );
  }

  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    throw createModelError(
      "Gemini 回傳的分析結果格式不正確。",
      "MODEL_INVALID_RESPONSE",
      502
    );
  }

  if (!Array.isArray(analysis.signals) || analysis.signals.length > 12) {
    throw createModelError(
      "Gemini 回傳的信號格式不正確。",
      "MODEL_INVALID_RESPONSE",
      502
    );
  }

  return {
    ...analysis,
    aiRiskScore: validateScore(analysis.aiRiskScore, "AI 風險分數"),
    evasionRiskScore: validateScore(
      analysis.evasionRiskScore,
      "規避風險分數"
    ),
    confidence: validateEnum(
      analysis.confidence,
      ["low", "medium", "high"],
      "信心程度"
    ),
    label: validateEnum(
      analysis.label,
      ["low", "medium", "high"],
      "風險分類"
    ),
    signals: analysis.signals.map(validateSignal),
    summary: validateText(analysis.summary, "摘要"),
    limitations: validateText(analysis.limitations, "限制說明")
  };
};

const requestGemini = async text => {
  const model = process.env.GEMINI_MODEL;
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await axios.post(
      endpoint,
      {
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserPrompt(text) }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA
        }
      },
      {
        timeout: 60000,
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    return parseAnalysis(extractResponseText(response));
  } catch (error) {
    if (error.statusCode) throw error;
    throw describeGeminiError(error);
  }
};

const toParagraphResults = (paragraphs, score) => {
  const risk = score >= 70 ? "high" : score >= 30 ? "medium" : "low";
  return paragraphs.map(paragraph => ({
    id: paragraph.id,
    score,
    risk
  }));
};

exports.isTextModelConfigured = isTextModelConfigured;
exports.parseAnalysis = parseAnalysis;

exports.analyze = async paragraphs => {
  if (!isTextModelConfigured()) {
    throw createModelError(
      "尚未設定 Gemini API Key、模型或啟用狀態。",
      "MODEL_NOT_CONFIGURED",
      503
    );
  }

  const text = combineParagraphs(paragraphs);
  if (text.length < MIN_CHARACTERS) {
    throw createModelError(
      `分析模型至少需要 ${MIN_CHARACTERS} 個字元，目前只有 ${text.length} 個。`,
      "TEXT_TOO_SHORT_FOR_MODEL",
      400
    );
  }
  if (text.length > MAX_CHARACTERS) {
    throw createModelError(
      `單次最多分析 ${MAX_CHARACTERS} 個字元，請縮小選取範圍。`,
      "TEXT_TOO_LONG_FOR_MODEL",
      400
    );
  }

  const language = traditionalChineseDetector.inspect(text);
  if (!language.accepted) {
    throw createModelError(
      "目前僅支援以繁體中文為主要內容的文章；可包含少量日語、英文、數字與專有名詞。",
      "LANGUAGE_NOT_SUPPORTED",
      400
    );
  }

  const analysis = await requestGemini(text);
  return {
    overallScore: analysis.aiRiskScore,
    evasionRiskScore: analysis.evasionRiskScore,
    confidence: analysis.confidence,
    label: analysis.label,
    analyzedCharacters: text.length,
    paragraphCount: paragraphs.length,
    paragraphs: toParagraphResults(paragraphs, analysis.aiRiskScore),
    signals: analysis.signals,
    summary: analysis.summary,
    limitations: analysis.limitations,
    language: {
      code: language.code,
      label: language.label,
      hanRatio: language.hanRatio,
      kanaRatio: language.kanaRatio,
      latinRatio: language.latinRatio,
      otherRatio: language.otherRatio
    },
    modelVersion: process.env.GEMINI_MODEL,
    provider: "Gemini",
    sandbox: false
  };
};
