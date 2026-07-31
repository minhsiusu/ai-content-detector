const assert = require("assert").strict;
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");
const localImageForensics = require("../src/local-image-forensics");

const buildGradient = async () => {
  const width = 512;
  const height = 384;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = Math.round(x / width * 255);
      data[index + 1] = Math.round(y / height * 255);
      data[index + 2] = Math.round((x + y) / (width + height) * 255);
      data[index + 3] = 255;
    }
  }
  return PNG.sync.write({ width, height, data });
};

const buildCheckerboard = async () => {
  const width = 512;
  const height = 384;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (Math.floor(x / 16) + Math.floor(y / 16)) % 2
        ? 245
        : 10;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return jpeg.encode({ width, height, data }, 90).data;
};

const assertUnitInterval = value => {
  assert.ok(Number.isFinite(value));
  assert.ok(value >= 0 && value <= 1, `${value} is outside 0..1`);
};

const run = async () => {
  const gradient = await localImageForensics.analyze(await buildGradient());
  const checkerboard = await localImageForensics.analyze(await buildCheckerboard());

  assert.equal(gradient.available, true);
  assert.equal(gradient.quality.width, 512);
  assert.equal(gradient.quality.height, 384);
  assert.equal(gradient.quality.format, "png");
  assert.equal(checkerboard.quality.format, "jpeg");

  [gradient, checkerboard].forEach(result => {
    assertUnitInterval(result.noise.uniformity);
    assertUnitInterval(result.noise.anomaly);
    assertUnitInterval(result.frequency.lowFrequencyRatio);
    assertUnitInterval(result.frequency.midFrequencyRatio);
    assertUnitInterval(result.frequency.highFrequencyRatio);
    assertUnitInterval(result.frequency.anomaly);
    assertUnitInterval(result.edges.edgeDensity);
    assertUnitInterval(result.edges.anomaly);
    assert.ok(["low", "medium", "high"].includes(result.noise.risk));
    assert.ok(["low", "medium", "high"].includes(result.frequency.risk));
    assert.ok(["low", "medium", "high"].includes(result.edges.risk));
    assert.equal(result.stability.variantsTested.length, 2);
    assert.ok(["low", "medium", "high"].includes(result.stability.reliability));
  });

  assert.ok(
    checkerboard.edges.edgeDensity > gradient.edges.edgeDensity,
    "checkerboard should contain more strong edges than a gradient"
  );
  console.log("ok - local image forensics returns bounded, distinct features");
};

run().catch(error => {
  console.error("not ok - local image forensics");
  console.error(error);
  process.exitCode = 1;
});
