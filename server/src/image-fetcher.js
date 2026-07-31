const axios = require("axios");
const dns = require("dns");
const net = require("net");
const util = require("util");

const lookup = util.promisify(dns.lookup);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const contentTypeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tiff"
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

const downloadPublicImage = async imageUrl => {
  await assertPublicImageUrl(imageUrl);
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxRedirects: 0,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: { "User-Agent": "AI-Content-Detector/0.5" }
  });
  const contentType = String(response.headers["content-type"] || "")
    .split(";")[0]
    .toLowerCase();
  const extension = contentTypeExtensions[contentType];
  if (!extension) {
    throw new Error(`不支援的圖片格式：${contentType || "未知"}`);
  }
  return {
    buffer: Buffer.from(response.data),
    contentType,
    extension
  };
};

module.exports = {
  assertPublicImageUrl,
  downloadPublicImage,
  isPrivateIp
};
