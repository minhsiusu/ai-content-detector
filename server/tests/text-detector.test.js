const assert = require("assert").strict;
const { parseAnalysis } = require("../src/text-detector");

const validAnalysis = overrides => ({
  aiRiskScore: 72,
  evasionRiskScore: 18,
  confidence: "high",
  label: "high",
  signals: [{
    category: "語氣與字詞模式",
    severity: "medium",
    evidence: "整段語氣一致",
    reason: "可見高頻率模板化措辭"
  }],
  summary: "內容顯示明顯 AI 風險",
  limitations: "僅供參考",
  ...overrides
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("accepts a well-formed Gemini response", () => {
  const result = parseAnalysis(JSON.stringify(validAnalysis()));
  assert.equal(result.aiRiskScore, 72);
  assert.equal(result.signals.length, 1);
});

test("rejects signals that are not an array", () => {
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({ signals: "bad" }))),
    error => error.code === "MODEL_INVALID_RESPONSE" &&
      error.statusCode === 502
  );
});

test("rejects invalid scores", () => {
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({ aiRiskScore: 101 }))),
    /格式不正確/
  );
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({ aiRiskScore: "72" }))),
    /格式不正確/
  );
});

test("rejects unsupported enum values", () => {
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({ confidence: "certain" }))),
    /格式不正確/
  );
});

test("rejects empty required text and too many signals", () => {
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({ summary: " " }))),
    /格式不正確/
  );
  assert.throws(
    () => parseAnalysis(JSON.stringify(validAnalysis({
      signals: Array.from({ length: 13 }, () => validAnalysis().signals[0])
    }))),
    /格式不正確/
  );
});

let failed = 0;
tests.forEach(current => {
  try {
    current.run();
    console.log(`ok - ${current.name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${current.name}`);
    console.error(error);
  }
});

if (failed) {
  process.exitCode = 1;
  console.error(`\n${failed} test(s) failed`);
} else {
  console.log(`\n${tests.length} test(s) passed`);
}
