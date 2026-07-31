const childProcess = require("child_process");
const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const util = require("util");
const axios = require("axios");

const execFile = util.promisify(childProcess.execFile);
const lookup = util.promisify(dns.lookup);
const TOOL_PATH = path.resolve(__dirname, "../tools/c2patool.exe");
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const contentTypeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg"
};

const isPrivateIp = address => {
  if (!address) return true;
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("fc") || address.startsWith("fd") ||
      address.startsWith("fe80:")) return true;
  if (!net.isIPv4(address)) return false;
  const parts = address.split(".").map(Number);
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
};

const assertPublicImageUrl = async imageUrl => {
  const parsed = new URL(imageUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("圖片不是公開的 http/https 網址");
  }
  if (parsed.username || parsed.password) {
    throw new Error("圖片網址不可包含登入資訊");
  }
  const result = await lookup(parsed.hostname, { all: true });
  if (!result.length || result.some(item => isPrivateIp(item.address))) {
    throw new Error("基於安全限制，不能下載內網或本機圖片");
  }
};

const downloadImage = async imageUrl => {
  await assertPublicImageUrl(imageUrl);
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxRedirects: 0,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: {
      "User-Agent": "AI-Content-Detector/0.4"
    }
  });
  const contentType = String(response.headers["content-type"] || "")
    .split(";")[0]
    .toLowerCase();
  const extension = contentTypeExtensions[contentType];
  if (!extension) {
    throw new Error(`不支援的圖片格式：${contentType || "未知"}`);
  }
  const filePath = path.join(
    os.tmpdir(),
    `ai-detector-${crypto.randomBytes(12).toString("hex")}${extension}`
  );
  await fs.promises.writeFile(filePath, response.data);
  return filePath;
};

const parseJsonReport = (stdout, stderr) => {
  const output = String(stdout || "").trim();
  if (!output) {
    return null;
  }
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error("無法解析 c2patool 的 JSON 報告");
  }
};

const collectValidationCodes = report => {
  const codes = [];
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    if (typeof value.code === "string") codes.push(value.code);
    Object.values(value).forEach(visit);
  };
  visit(report.validation_status);
  visit(report.validation_results);
  return [...new Set(codes)];
};

const getSignatureStatus = codes => {
  if (codes.some(code => /invalid|mismatch|tamper|failure|untrusted/i.test(code))) {
    return "invalid";
  }
  if (codes.some(code => /valid|trusted|claimSignature\.validated/i.test(code))) {
    return "valid";
  }
  return "unknown";
};

const findActiveManifest = report => {
  if (!report || !report.manifests) return null;
  return report.manifests[report.active_manifest] ||
    Object.values(report.manifests)[0] ||
    null;
};

const getGeneratorName = manifest => {
  if (!manifest) return null;
  const info = manifest.claim_generator_info;
  if (Array.isArray(info) && info[0] && info[0].name) return info[0].name;
  return manifest.claim_generator || null;
};

const findAiDeclaration = report => {
  const serialized = JSON.stringify(report).toLowerCase();
  return [
    "trainedalgorithmicmedia",
    "trainedalgorithmicdata",
    "compositewithtrainedalgorithmicmedia",
    "algorithmicmedia",
    "generative ai",
    "ai-generated"
  ].some(marker => serialized.includes(marker));
};

const summarizeReport = report => {
  if (!report || !report.active_manifest) {
    return {
      status: "not-found",
      exists: false,
      signature: "unknown",
      aiGenerated: false,
      generator: null,
      validationCodes: []
    };
  }
  const manifest = findActiveManifest(report);
  const validationCodes = collectValidationCodes(report);
  return {
    status: "found",
    exists: true,
    signature: getSignatureStatus(validationCodes),
    aiGenerated: findAiDeclaration(report),
    generator: getGeneratorName(manifest),
    title: manifest && manifest.title || null,
    format: manifest && manifest.format || null,
    validationCodes
  };
};

const inspectFile = async filePath => {
  try {
    const result = await execFile(TOOL_PATH, [filePath], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });
    return summarizeReport(parseJsonReport(result.stdout, result.stderr));
  } catch (error) {
    const report = parseJsonReport(error.stdout, error.stderr);
    if (report === null) return summarizeReport(null);
    if (report) return summarizeReport(report);
    throw error;
  }
};

exports.isAvailable = () => fs.existsSync(TOOL_PATH);

exports.inspectImageUrl = async imageUrl => {
  if (!exports.isAvailable()) {
    return {
      status: "unavailable",
      exists: false,
      error: "找不到 server/tools/c2patool.exe"
    };
  }

  let filePath;
  try {
    filePath = await downloadImage(imageUrl);
    return await inspectFile(filePath);
  } catch (error) {
    return {
      status: "unavailable",
      exists: false,
      error: error.message
    };
  } finally {
    if (filePath) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
  }
};
