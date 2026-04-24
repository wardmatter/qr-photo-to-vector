const fileInput = document.querySelector("#fileInput");
const sourcePreview = document.querySelector("#sourcePreview");
const sourcePlaceholder = document.querySelector("#sourcePlaceholder");
const statusBanner = document.querySelector("#statusBanner");
const payloadInput = document.querySelector("#payloadInput");
const eccSelect = document.querySelector("#eccSelect");
const sizeInput = document.querySelector("#sizeInput");
const marginInput = document.querySelector("#marginInput");
const shapeSelect = document.querySelector("#shapeSelect");
const fgColorInput = document.querySelector("#fgColorInput");
const bgColorInput = document.querySelector("#bgColorInput");
const transparentInput = document.querySelector("#transparentInput");
const renderButton = document.querySelector("#renderButton");
const copyButton = document.querySelector("#copyButton");
const vectorPreview = document.querySelector("#vectorPreview");
const downloadSvgButton = document.querySelector("#downloadSvgButton");
const downloadPngButton = document.querySelector("#downloadPngButton");

let currentSvgMarkup = "";

const QR_LIBS_TIMEOUT_MS = 8000;
const MAX_SCAN_DIMENSION = 1200;
const SCAN_ANGLES = [0, -12, 12, -24, 24, -35, 35];
const SCAN_VARIANTS = [
  { name: "raw", mode: "raw" },
  { name: "boosted contrast", mode: "contrast", amount: 1.35 },
  { name: "high contrast", mode: "contrast", amount: 1.7 },
  { name: "adaptive threshold", mode: "threshold", shift: 0 },
  { name: "lighter threshold", mode: "threshold", shift: -20 },
  { name: "darker threshold", mode: "threshold", shift: 20 },
];

function setStatus(message, tone = "neutral") {
  statusBanner.textContent = message;
  statusBanner.className = "status-banner";
  if (tone !== "neutral") {
    statusBanner.classList.add(tone);
  }
}

function waitForQrLibraries() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function check() {
      if (window.jsQR && window.qrcode) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > QR_LIBS_TIMEOUT_MS) {
        reject(
          new Error(
            "QR libraries did not load. Check your internet connection and reload the page."
          )
        );
        return;
      }

      window.setTimeout(check, 50);
    }

    check();
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not open that image."));
    image.src = dataUrl;
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function createBaseCanvas(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxDimension = Math.max(sourceWidth, sourceHeight);
  const scale = maxDimension > MAX_SCAN_DIMENSION ? MAX_SCAN_DIMENSION / maxDimension : 1;
  const canvas = createCanvas(sourceWidth * scale, sourceHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rotateCanvas(sourceCanvas, angleDegrees) {
  if (angleDegrees === 0) {
    return sourceCanvas;
  }

  const radians = (angleDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const rotatedCanvas = createCanvas(width * cos + height * sin, width * sin + height * cos);
  const context = rotatedCanvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  context.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  context.rotate(radians);
  context.drawImage(sourceCanvas, -width / 2, -height / 2);
  return rotatedCanvas;
}

function getCanvasImageData(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function buildLuminanceHistogram(imageData) {
  const histogram = new Array(256).fill(0);
  const luminance = new Uint8ClampedArray(imageData.width * imageData.height);
  const data = imageData.data;

  for (let sourceIndex = 0, luminanceIndex = 0; sourceIndex < data.length; sourceIndex += 4, luminanceIndex += 1) {
    const value = Math.round(data[sourceIndex] * 0.299 + data[sourceIndex + 1] * 0.587 + data[sourceIndex + 2] * 0.114);
    luminance[luminanceIndex] = value;
    histogram[value] += 1;
  }

  return { histogram, luminance };
}

function getOtsuThreshold(histogram, totalPixels) {
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    sum += index * histogram[index];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 127;

  for (let index = 0; index < histogram.length; index += 1) {
    weightBackground += histogram[index];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += index * histogram[index];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const betweenVariance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance;
      threshold = index;
    }
  }

  return threshold;
}

function cloneImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function applyVariant(imageData, variant) {
  if (variant.mode === "raw") {
    return cloneImageData(imageData);
  }

  const output = cloneImageData(imageData);
  const { histogram, luminance } = buildLuminanceHistogram(imageData);
  const data = output.data;

  if (variant.mode === "contrast") {
    for (let sourceIndex = 0, luminanceIndex = 0; sourceIndex < data.length; sourceIndex += 4, luminanceIndex += 1) {
      const value = Math.max(0, Math.min(255, (luminance[luminanceIndex] - 128) * variant.amount + 128));
      data[sourceIndex] = value;
      data[sourceIndex + 1] = value;
      data[sourceIndex + 2] = value;
    }

    return output;
  }

  if (variant.mode === "threshold") {
    const threshold = Math.max(0, Math.min(255, getOtsuThreshold(histogram, luminance.length) + variant.shift));

    for (let sourceIndex = 0, luminanceIndex = 0; sourceIndex < data.length; sourceIndex += 4, luminanceIndex += 1) {
      const value = luminance[luminanceIndex] >= threshold ? 255 : 0;
      data[sourceIndex] = value;
      data[sourceIndex + 1] = value;
      data[sourceIndex + 2] = value;
    }

    return output;
  }

  return output;
}

function detectWithJsQr(imageData) {
  return window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
}

async function detectWithBarcodeDetector(canvas) {
  if (!("BarcodeDetector" in window)) {
    return null;
  }

  try {
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const results = await detector.detect(canvas);
    return results.find((result) => result.rawValue)?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function extractQrFromImage(image) {
  const baseCanvas = createBaseCanvas(image);

  for (const angle of SCAN_ANGLES) {
    const rotatedCanvas = rotateCanvas(baseCanvas, angle);
    const nativeResult = await detectWithBarcodeDetector(rotatedCanvas);
    if (nativeResult) {
      return {
        data: nativeResult,
        strategy: angle === 0 ? "native detector" : `native detector at ${angle}deg`,
      };
    }

    const baseImageData = getCanvasImageData(rotatedCanvas);

    for (const variant of SCAN_VARIANTS) {
      const candidateImageData = applyVariant(baseImageData, variant);
      const result = detectWithJsQr(candidateImageData);

      if (result?.data) {
        const angleLabel = angle === 0 ? "" : ` at ${angle}deg`;
        return {
          data: result.data,
          strategy: `jsQR ${variant.name}${angleLabel}`,
        };
      }
    }
  }

  throw new Error(
    "No readable QR code was found. Try a tighter crop, less glare, or a straighter photo for codes with heavy center logos."
  );
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSvgMarkup(payload, options) {
  const qr = window.qrcode(0, options.errorCorrectionLevel);
  qr.addData(payload);
  qr.make();

  const modules = qr.getModuleCount();
  const totalModules = modules + options.margin * 2;
  const radius = options.shape === "rounded" ? 0.22 : 0;
  const bgFill = options.transparent ? "none" : options.background;
  const shapeRendering = options.shape === "square" ? ' shape-rendering="crispEdges"' : "";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 ${totalModules} ${totalModules}" role="img" aria-label="Regenerated QR code"${shapeRendering}>`,
    `<title>${escapeXml(payload)}</title>`,
    `<rect width="${totalModules}" height="${totalModules}" fill="${bgFill}"/>`,
  ];

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }

      const x = col + options.margin;
      const y = row + options.margin;
      parts.push(
        `<rect x="${x}" y="${y}" width="1" height="1" rx="${radius}" ry="${radius}" fill="${options.foreground}"/>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

function renderVector() {
  const payload = payloadInput.value.trim();
  if (!payload) {
    currentSvgMarkup = "";
    vectorPreview.className = "vector-preview placeholder";
    vectorPreview.textContent = "Enter or decode a QR payload to generate the vector output.";
    setExportState(false);
    setStatus("Add or decode some QR content first.", "error");
    return;
  }

  try {
    const size = Number(sizeInput.value);
    const margin = Number(marginInput.value);

    if (!Number.isFinite(size) || size < 128 || size > 2048) {
      throw new Error("Output size must be between 128 and 2048.");
    }

    if (!Number.isFinite(margin) || margin < 0 || margin > 16) {
      throw new Error("Quiet zone must be between 0 and 16.");
    }

    const options = {
      errorCorrectionLevel: eccSelect.value,
      size,
      margin,
      shape: shapeSelect.value,
      foreground: fgColorInput.value,
      background: bgColorInput.value,
      transparent: transparentInput.checked,
    };

    currentSvgMarkup = buildSvgMarkup(payload, options);
    vectorPreview.className = "vector-preview";
    vectorPreview.innerHTML = currentSvgMarkup;
    setExportState(true);
    setStatus("QR vector regenerated and ready to export.", "success");
  } catch (error) {
    currentSvgMarkup = "";
    setExportState(false);
    vectorPreview.className = "vector-preview placeholder";
    vectorPreview.textContent = "The QR could not be regenerated with the current settings.";
    setStatus(error.message || "The QR could not be regenerated.", "error");
  }
}

function setExportState(enabled) {
  downloadSvgButton.disabled = !enabled;
  downloadPngButton.disabled = !enabled;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadSvg() {
  if (!currentSvgMarkup) {
    return;
  }

  const blob = new Blob([currentSvgMarkup], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob("qr-vector.svg", blob);
}

async function downloadPng() {
  if (!currentSvgMarkup) {
    return;
  }

  const size = Number(sizeInput.value);
  const svgBlob = new Blob([currentSvgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = createCanvas(size, size);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas is unavailable in this browser.");
    }

    context.drawImage(image, 0, 0, size, size);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("PNG export failed.");
    }

    downloadBlob("qr-vector.png", blob);
  } catch (error) {
    setStatus(error.message || "PNG export failed.", "error");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function handleFileSelection(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    setStatus("Loading image and trying multiple QR scan passes...");
    await waitForQrLibraries();
    const dataUrl = await readFileAsDataUrl(file);
    sourcePreview.src = dataUrl;
    sourcePreview.hidden = false;
    sourcePlaceholder.hidden = true;

    const image = await loadImage(dataUrl);
    const decoded = await extractQrFromImage(image);

    payloadInput.value = decoded.data;
    renderVector();
    setStatus(`QR detected successfully via ${decoded.strategy}.`, "success");
  } catch (error) {
    payloadInput.value = "";
    currentSvgMarkup = "";
    sourcePreview.hidden = true;
    sourcePreview.removeAttribute("src");
    sourcePlaceholder.hidden = false;
    vectorPreview.className = "vector-preview placeholder";
    vectorPreview.textContent = "Your clean vector QR will render here.";
    setExportState(false);
    setStatus(error.message || "That image could not be processed.", "error");
  }
}

async function copyPayload() {
  const payload = payloadInput.value.trim();
  if (!payload) {
    setStatus("There is no payload to copy yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(payload);
    setStatus("Payload copied to your clipboard.", "success");
  } catch {
    setStatus("Clipboard copy failed in this browser.", "error");
  }
}

function bindLivePreview() {
  [
    payloadInput,
    eccSelect,
    sizeInput,
    marginInput,
    shapeSelect,
    fgColorInput,
    bgColorInput,
    transparentInput,
  ].forEach((element) => {
    element.addEventListener("input", renderVector);
    element.addEventListener("change", renderVector);
  });
}

fileInput.addEventListener("change", handleFileSelection);
renderButton.addEventListener("click", renderVector);
copyButton.addEventListener("click", copyPayload);
downloadSvgButton.addEventListener("click", downloadSvg);
downloadPngButton.addEventListener("click", downloadPng);

setExportState(false);
bindLivePreview();

waitForQrLibraries()
  .then(() => {
    setStatus("Select a photo to begin decoding.");
  })
  .catch((error) => {
    setStatus(error.message, "error");
  });
