const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const SAMPLE_SIZE = 128;
const round = (value, digits = 4) => Number(value.toFixed(digits));
const clamp = value => Math.max(0, Math.min(1, value));
const riskFrom = (value, medium, high) => (
  value >= high ? "high" : value >= medium ? "medium" : "low"
);

const mean = values => values.reduce((sum, value) => sum + value, 0) /
  Math.max(1, values.length);

const variance = values => {
  const average = mean(values);
  return mean(values.map(value => (value - average) ** 2));
};

const resizeGrayscale = (pixels, width, height, targetWidth, targetHeight) => {
  const resized = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y * height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x * width / targetWidth));
      resized[y * targetWidth + x] = pixels[sourceY * width + sourceX];
    }
  }
  return resized;
};

const decodeRgba = buffer => {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const isPng = buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(pngSignature);
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff &&
    buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isPng) {
    return { ...PNG.sync.read(buffer), format: "png" };
  }
  if (isJpeg) {
    return {
      ...jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: true,
        maxMemoryUsageInMB: 128,
        maxResolutionInMP: 40
      }),
      format: "jpeg"
    };
  }
  throw new Error("本機影像鑑識目前僅支援 JPEG 與 PNG");
};

const decode = async buffer => {
  const decoded = decodeRgba(buffer);
  if (decoded.width * decoded.height > 40000000) {
    throw new Error("圖片像素超過 4,000 萬，拒絕執行本機分析");
  }
  const grayscale = new Uint8Array(decoded.width * decoded.height);
  let hasAlpha = false;
  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4;
    grayscale[index] = Math.round(
      decoded.data[offset] * 0.299 +
      decoded.data[offset + 1] * 0.587 +
      decoded.data[offset + 2] * 0.114
    );
    if (decoded.data[offset + 3] < 255) hasAlpha = true;
  }
  return {
    pixels: resizeGrayscale(
      grayscale,
      decoded.width,
      decoded.height,
      SAMPLE_SIZE,
      SAMPLE_SIZE
    ),
    width: SAMPLE_SIZE,
    height: SAMPLE_SIZE,
    metadata: {
      width: decoded.width,
      height: decoded.height,
      format: decoded.format,
      space: "srgb",
      hasAlpha,
      pages: 1
    }
  };
};

const laplacianValues = sample => {
  const { pixels, width, height } = sample;
  const values = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      values.push(
        pixels[index - width] + pixels[index + width] +
        pixels[index - 1] + pixels[index + 1] - 4 * pixels[index]
      );
    }
  }
  return values;
};

const inspectImageQuality = sample => {
  const { metadata } = sample;
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const megapixels = width * height / 1000000;
  const sharpness = variance(laplacianValues(sample));
  const warnings = [];
  if (width < 256 || height < 256) warnings.push("圖片尺寸過小，鑑識訊號可能不穩定");
  if (megapixels > 30) warnings.push("原圖尺寸很大，分析已使用縮圖以限制資源");
  if (sharpness < 35) warnings.push("圖片明顯模糊，邊緣與頻率分析可信度較低");
  if (metadata.pages && metadata.pages > 1) warnings.push("動態或多頁圖片只分析第一幀");
  return {
    width,
    height,
    megapixels: round(megapixels, 2),
    format: metadata.format || "unknown",
    colorSpace: metadata.space || "unknown",
    hasAlpha: Boolean(metadata.hasAlpha),
    sharpness: round(sharpness, 2),
    quality: warnings.length ? "limited" : "acceptable",
    warnings
  };
};

const analyzeNoiseResidual = sample => {
  const { pixels, width, height } = sample;
  const residuals = [];
  const regions = Array.from({ length: 16 }, () => []);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let total = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          total += pixels[(y + dy) * width + x + dx];
        }
      }
      const residual = Math.abs(pixels[y * width + x] - total / 9);
      residuals.push(residual);
      const region = Math.min(3, Math.floor(y * 4 / height)) * 4 +
        Math.min(3, Math.floor(x * 4 / width));
      regions[region].push(residual);
    }
  }
  const regionalMeans = regions.map(mean);
  const averageResidual = mean(residuals);
  const regionalVariation = Math.sqrt(variance(regionalMeans)) /
    Math.max(1, averageResidual);
  const uniformity = 1 - clamp(regionalVariation / 1.5);
  const anomaly = clamp((uniformity - 0.72) / 0.28) *
    clamp((5 - Math.min(5, averageResidual)) / 5);
  return {
    averageResidual: round(averageResidual, 3),
    regionalVariation: round(regionalVariation, 3),
    uniformity: round(uniformity, 3),
    anomaly: round(anomaly, 3),
    risk: riskFrom(anomaly, 0.35, 0.7)
  };
};

const fft = (real, imaginary) => {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    for (let start = 0; start < length; start += size) {
      for (let offset = 0; offset < size / 2; offset += 1) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const even = start + offset;
        const odd = even + size / 2;
        const oddReal = real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
};

const analyzeFrequencySpectrum = sample => {
  const size = sample.width;
  const real = Array.from({ length: size }, () => new Float64Array(size));
  const imaginary = Array.from({ length: size }, () => new Float64Array(size));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const window = Math.sin(Math.PI * x / (size - 1)) *
        Math.sin(Math.PI * y / (size - 1));
      real[y][x] = (sample.pixels[y * size + x] - 128) * window;
    }
    fft(real[y], imaginary[y]);
  }
  for (let x = 0; x < size; x += 1) {
    const columnReal = new Float64Array(size);
    const columnImaginary = new Float64Array(size);
    for (let y = 0; y < size; y += 1) {
      columnReal[y] = real[y][x];
      columnImaginary[y] = imaginary[y][x];
    }
    fft(columnReal, columnImaginary);
    for (let y = 0; y < size; y += 1) {
      real[y][x] = columnReal[y];
      imaginary[y][x] = columnImaginary[y];
    }
  }
  const energy = [0, 0, 0];
  const radialBins = Array(16).fill(0);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.min(x, size - x);
      const dy = Math.min(y, size - y);
      const radius = Math.sqrt(dx * dx + dy * dy) / (size / Math.sqrt(2));
      if (radius === 0 || radius > 1) continue;
      const power = Math.log1p(real[y][x] ** 2 + imaginary[y][x] ** 2);
      const band = radius < 0.2 ? 0 : radius < 0.55 ? 1 : 2;
      energy[band] += power;
      radialBins[Math.min(15, Math.floor(radius * 16))] += power;
    }
  }
  const total = energy.reduce((sum, value) => sum + value, 0) || 1;
  const ratios = energy.map(value => value / total);
  const binAverage = mean(radialBins);
  const peakCount = radialBins.filter(value => value > binAverage * 1.8).length;
  const anomaly = clamp(Math.abs(ratios[1] - 0.45) * 1.3 +
    Math.abs(ratios[2] - 0.3) + peakCount * 0.04);
  return {
    lowFrequencyRatio: round(ratios[0]),
    midFrequencyRatio: round(ratios[1]),
    highFrequencyRatio: round(ratios[2]),
    spectralPeakCount: peakCount,
    anomaly: round(anomaly, 3),
    risk: riskFrom(anomaly, 0.35, 0.68)
  };
};

const analyzeEdgeConsistency = sample => {
  const { pixels, width, height } = sample;
  const magnitudes = [];
  const regionMeans = Array.from({ length: 16 }, () => []);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (dx, dy) => pixels[(y + dy) * width + x + dx];
      const gx = -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) +
        2 * at(1, 0) - at(-1, 1) + at(1, 1);
      const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) +
        at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      magnitudes.push(magnitude);
      const region = Math.min(3, Math.floor(y * 4 / height)) * 4 +
        Math.min(3, Math.floor(x * 4 / width));
      regionMeans[region].push(magnitude);
    }
  }
  const edgeThreshold = 90;
  const edgeDensity = magnitudes.filter(value => value > edgeThreshold).length /
    magnitudes.length;
  const localVariation = Math.sqrt(variance(regionMeans.map(mean))) /
    Math.max(1, mean(magnitudes));
  const anomaly = clamp(Math.abs(edgeDensity - 0.22) * 1.7 +
    Math.max(0, localVariation - 0.9) * 0.5);
  return {
    edgeDensity: round(edgeDensity),
    averageStrength: round(mean(magnitudes), 2),
    regionalVariation: round(localVariation, 3),
    anomaly: round(anomaly, 3),
    risk: riskFrom(anomaly, 0.35, 0.68)
  };
};

const featureDistance = (left, right) => mean([
  Math.abs(left.noise.uniformity - right.noise.uniformity),
  Math.abs(left.frequency.midFrequencyRatio - right.frequency.midFrequencyRatio),
  Math.abs(left.frequency.highFrequencyRatio - right.frequency.highFrequencyRatio),
  Math.abs(left.edges.edgeDensity - right.edges.edgeDensity),
  Math.abs(left.edges.regionalVariation - right.edges.regionalVariation) / 2
]);

const analyzeCore = sample => ({
  noise: analyzeNoiseResidual(sample),
  frequency: analyzeFrequencySpectrum(sample),
  edges: analyzeEdgeConsistency(sample)
});

const sampleToRgba = sample => {
  const data = Buffer.alloc(sample.pixels.length * 4);
  sample.pixels.forEach((value, index) => {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  });
  return data;
};

const testFeatureStability = async (buffer, baseline, baselineSample) => {
  const jpegBuffer = jpeg.encode({
    data: sampleToRgba(baselineSample),
    width: SAMPLE_SIZE,
    height: SAMPLE_SIZE
  }, 80).data;
  const jpegSample = await decode(jpegBuffer);
  const smallPixels = resizeGrayscale(
    baselineSample.pixels,
    SAMPLE_SIZE,
    SAMPLE_SIZE,
    96,
    96
  );
  const resizedSample = {
    ...baselineSample,
    pixels: resizeGrayscale(smallPixels, 96, 96, SAMPLE_SIZE, SAMPLE_SIZE)
  };
  const distances = [
    featureDistance(baseline, analyzeCore(jpegSample)),
    featureDistance(baseline, analyzeCore(resizedSample))
  ];
  const variation = Math.max(...distances);
  return {
    stable: variation < 0.16,
    variation: round(variation, 3),
    variantsTested: ["jpeg-quality-80", "resize-75-percent"],
    reliability: variation < 0.08 ? "high" : variation < 0.16 ? "medium" : "low"
  };
};

const analyze = async buffer => {
  const sample = await decode(buffer);
  const core = analyzeCore(sample);
  return {
    available: true,
    methodVersion: "local-forensics-0.1",
    quality: inspectImageQuality(sample),
    ...core,
    stability: await testFeatureStability(buffer, core, sample),
    warning: "本機鑑識為未經資料集校準的輔助訊號，不代表圖片來源證明。"
  };
};

module.exports = {
  analyze,
  analyzeEdgeConsistency,
  analyzeFrequencySpectrum,
  analyzeNoiseResidual,
  inspectImageQuality,
  testFeatureStability
};
