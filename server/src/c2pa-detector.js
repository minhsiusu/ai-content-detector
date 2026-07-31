const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");
const { downloadPublicImage } = require("./image-fetcher");

const execFile = util.promisify(childProcess.execFile);
const TOOL_PATH = path.resolve(__dirname, "../tools/c2patool.exe");

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

exports.inspectImageBuffer = async (buffer, extension = ".img") => {
  if (!exports.isAvailable()) {
    return {
      status: "unavailable",
      exists: false,
      error: "找不到 server/tools/c2patool.exe"
    };
  }

  const filePath = path.join(
    os.tmpdir(),
    `ai-detector-${crypto.randomBytes(12).toString("hex")}${extension}`
  );
  try {
    await fs.promises.writeFile(filePath, buffer);
    return await inspectFile(filePath);
  } catch (error) {
    return {
      status: "unavailable",
      exists: false,
      error: error.message
    };
  } finally {
    await fs.promises.unlink(filePath).catch(() => {});
  }
};

exports.inspectImageUrl = async imageUrl => {
  try {
    const image = await downloadPublicImage(imageUrl);
    return exports.inspectImageBuffer(image.buffer, image.extension);
  } catch (error) {
    return {
      status: "unavailable",
      exists: false,
      error: error.message
    };
  }
};
