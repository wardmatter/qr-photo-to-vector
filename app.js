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

function extractQrFromImage(image) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });

  if (!result?.data) {
    throw new Error("No readable QR code was found in that photo.");
  }

  return result.data;
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
  const cellSize = options.size / totalModules;
  const radius = options.shape === "rounded" ? Math.max(cellSize * 0.32, 1.8) : 0;
  const bgFill = options.transparent ? "none" : options.background;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 ${options.size} ${options.size}" role="img" aria-label="Regenerated QR code">`,
    `<title>${escapeXml(payload)}</title>`,
    `<rect width="${options.size}" height="${options.size}" fill="${bgFill}"/>`,
  ];

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }

      const x = (col + options.margin) * cellSize;
      const y = (row + options.margin) * cellSize;
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${radius}" ry="${radius}" fill="${options.foreground}"/>`
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
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas is unavailable in this browser.");
    }

    canvas.width = size;
    canvas.height = size;
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
    setStatus("Loading image and scanning for QR data...");
    await waitForQrLibraries();
    const dataUrl = await readFileAsDataUrl(file);
    sourcePreview.src = dataUrl;
    sourcePreview.hidden = false;
    sourcePlaceholder.hidden = true;

    const image = await loadImage(dataUrl);
    const payload = extractQrFromImage(image);

    payloadInput.value = payload;
    renderVector();
    setStatus("QR detected successfully. You can edit the payload or styling now.", "success");
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
  [payloadInput, eccSelect, sizeInput, marginInput, shapeSelect, fgColorInput, bgColorInput, transparentInput].forEach(
    (element) => {
      element.addEventListener("input", renderVector);
      element.addEventListener("change", renderVector);
    }
  );
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
