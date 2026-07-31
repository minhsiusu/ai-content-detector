const TRADITIONAL_HINTS = new Set(
  "這個為與國體臺灣學會後發現時說對裡還來們點從將過於無實資訊網頁文章內容偵測應開關問題經濟環境總統產業機構專業顯示選擇結果進處當務動頭買賣書車門間話語廣東龍風雲萬億"
);

const SIMPLIFIED_HINTS = new Set(
  "这个为与国体台湾学会后发现时说对里还来们点从将过于无实资讯网页文章内容侦测应开关问题经济环境总统产业机构专业显示选择结果进处当务动头买卖书车门间话语广东龙风云万亿"
);

const countMatches = (text, pattern) => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const inspect = text => {
  const hanCount = countMatches(text, /\p{Script=Han}/gu);
  const kanaCount = countMatches(
    text,
    /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
  );
  const latinCount = countMatches(text, /\p{Script=Latin}/gu);
  const letterCount = countMatches(text, /\p{Letter}/gu);
  const otherLetterCount = Math.max(
    0,
    letterCount - hanCount - kanaCount - latinCount
  );
  let traditionalHints = 0;
  let simplifiedHints = 0;

  for (const character of text) {
    if (TRADITIONAL_HINTS.has(character)) traditionalHints += 1;
    if (SIMPLIFIED_HINTS.has(character)) simplifiedHints += 1;
  }

  const scriptTotal = letterCount;
  const hanRatio = scriptTotal ? hanCount / scriptTotal : 0;
  const kanaRatio = scriptTotal ? kanaCount / scriptTotal : 0;
  const latinRatio = scriptTotal ? latinCount / scriptTotal : 0;
  const otherRatio = scriptTotal ? otherLetterCount / scriptTotal : 0;
  const isMainlyHan = hanCount >= 80 && hanRatio >= 0.55;
  const hasTraditionalEvidence = traditionalHints >= 2;
  const looksSimplified = simplifiedHints >= 3 &&
    simplifiedHints > traditionalHints * 1.5;

  return {
    code: "zh-TW",
    label: "繁體中文",
    accepted: isMainlyHan && hasTraditionalEvidence && !looksSimplified,
    hanCount,
    kanaCount,
    latinCount,
    otherLetterCount,
    traditionalHints,
    simplifiedHints,
    hanRatio: Math.round(hanRatio * 100),
    kanaRatio: Math.round(kanaRatio * 100),
    latinRatio: Math.round(latinRatio * 100),
    otherRatio: Math.round(otherRatio * 100)
  };
};

module.exports = { inspect };
