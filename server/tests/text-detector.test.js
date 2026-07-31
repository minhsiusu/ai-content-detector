const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAnalysis } = require("../src/text-detector");

test("parseAnalysis accepts a well-formed Gemini response", () => {
  const result = parseAnalysis(JSON.stringify({
    aiRiskScore: 72,
    evasionRiskScore: 18,
    confidence: "high",
    label: "high",
    signals: [
      {
        category: "語氣與字詞模式",
        severity: "medium",
        evidence: "整段語氣一致",
        reason: "可見高頻率模板化措辭"
      }
    ],
    summary: "內容顯示明顯 AI 風險",
    limitations: "僅供參考"
  }));

  assert.equal(result.aiRiskScore, 72);
  assert.equal(result.evasionRiskScore, 18);
  assert.equal(result.signals.length, 1);
  assert.equal(result.summary, "內容顯示明顯 AI 風險");
});

test("parseAnalysis rejects malformed signal payloads", () => {
  assert.throws(
    () => parseAnalysis(JSON.stringify({
      aiRiskScore: 55,
      evasionRiskScore: 22,
      confidence: "medium",
      label: "medium",
      signals: "bad",
      summary: "ok",
      limitations: "ok"
    })),
    /格式不正確/
  );
});
