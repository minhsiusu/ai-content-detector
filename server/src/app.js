require("dotenv").config();

const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const textDetector = require("./text-detector");
const imageDetector = require("./image-detector");
const c2paDetector = require("./c2pa-detector");

const app = express();
const port = Number(process.env.PORT) || 3200;

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "AI Content Detector API is running.",
    health: "/health"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ai-content-detector",
    textModel: textDetector.isTextModelConfigured()
      ? process.env.GEMINI_MODEL || "gemini"
      : "not-configured",
    imageModel: imageDetector.isImageModelConfigured()
      ? "sightengine-genai"
      : "not-configured",
    c2paTool: c2paDetector.isAvailable()
  });
});

app.post("/api/detect", async (req, res, next) => {
  try {
    const input = Array.isArray(req.body.paragraphs)
      ? req.body.paragraphs
      : [];
    const paragraphs = input
      .map((item, index) => ({
        id: String(item && item.id || `paragraph-${index}`),
        text: String(item && item.text || "").trim()
      }))
      .filter(item => item.text.length >= 30)
      .slice(0, 100);

    if (!paragraphs.length) {
      return res.status(400).json({
        message: "找不到至少 30 字的文章內容"
      });
    }

    const result = await textDetector.analyze(paragraphs);
    return res.json({
      ...result,
      warning: "偵測結果僅供參考，不能證明內容一定由 AI 生成。"
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/detect-image", async (req, res, next) => {
  try {
    const imageUrl = String(req.body.imageUrl || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({
        message: "目前只能分析具有公開 http/https 網址的圖片"
      });
    }

    return res.json(await imageDetector.analyze({
      imageUrl,
      pageUrl: String(req.body.url || "").slice(0, 2048),
      alt: String(req.body.alt || "").slice(0, 500)
    }));
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = error.statusCode ||
    (error.code === "MODEL_NOT_CONFIGURED" ? 503 : 500);
  res.status(status).json({
    message: error.message || "分析服務發生錯誤",
    code: error.code || "INTERNAL_ERROR"
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`AI detector API listening on http://localhost:${port}`);
  });
}

module.exports = app;
