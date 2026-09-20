import { calculateSpeechMetrics } from "./modules/SpeechMetrics.js";

const $ = (selector) => document.querySelector(selector);
const state = { pdf: null, slideTexts: [], current: 0, transcripts: [], recognition: null, recording: false, startedAt: null, timerId: null, secondsLeft: null, stream: null, pose: null, poseLoop: null, poseSamples: 0, visibleBodySamples: 0 };
const els = { setup: $("#presentationSetup"), form: $("#presentationForm"), file: $("#presentationFile"), fileName: $("#fileName"), rubric: $("#rubric"), juryRole: $("#juryRole"), useTimer: $("#useTimer"), minutesField: $("#minutesField"), minutes: $("#timerMinutes"), stage: $("#stageView"), jury: $("#juryView"), slideCanvas: $("#slideCanvas"), counter: $("#slideCounter"), bottomCounter: $("#bottomSlideCounter"), slideNumber: $("#slideNumber"), slideTotal: $("#slideTotal"), timer: $("#stageTimer"), status: $("#stageStatus"), toggle: $("#togglePractice"), prev: $("#prevSlide"), next: $("#nextSlide"), finish: $("#finishPresentation"), exit: $("#exitStage"), video: $("#poseVideo"), poseCanvas: $("#poseCanvas"), cameraMessage: $("#cameraMessage"), posture: $("#postureMetric"), speech: $("#speechMetric"), transcript: $("#liveTranscript"), juryQuestions: $("#juryQuestions"), score: $("#presentationScore"), summary: $("#presentationSummary"), tips: $("#presentationTips") };

els.useTimer.addEventListener("change", () => els.minutesField.classList.toggle("hidden", !els.useTimer.checked));
els.file.addEventListener("change", () => { els.fileName.textContent = els.file.files?.[0]?.name ?? "Selecciona un archivo"; });
els.form.addEventListener("submit", preparePresentation);
els.toggle.addEventListener("click", () => state.recording ? stopPractice() : startPractice());
els.prev.addEventListener("click", () => changeSlide(-1));
els.next.addEventListener("click", () => changeSlide(1));
els.slideNumber.addEventListener("change", () => goToSlide(Number(els.slideNumber.value) - 1));
document.addEventListener("keydown", (event) => {
  if (els.stage.classList.contains("hidden") || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (event.key === "ArrowLeft" || event.key === "PageUp") changeSlide(-1);
  if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") { event.preventDefault(); changeSlide(1); }
});
els.finish.addEventListener("click", finishPresentation);
els.exit.addEventListener("click", () => { stopPractice(); stopCamera(); location.href = "./"; });

async function preparePresentation(event) {
  event.preventDefault();
  const file = els.file.files?.[0];
  if (!file) return;
  const submit = els.form.querySelector("button[type=submit]");
  submit.disabled = true; submit.textContent = "Leyendo presentación...";
  try {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    state.pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    state.transcripts = Array.from({ length: state.pdf.numPages }, () => "");
    state.slideTexts = await Promise.all(Array.from({ length: state.pdf.numPages }, async (_, index) => {
      const page = await state.pdf.getPage(index + 1); const content = await page.getTextContent();
      return content.items.map((item) => item.str).join(" ");
    }));
    state.secondsLeft = els.useTimer.checked ? Number(els.minutes.value) * 60 : null;
    els.setup.classList.add("hidden"); els.stage.classList.remove("hidden");
    await renderSlide(); await startCamera(); setupRecognition(); renderTimer();
  } catch (error) {
    console.error(error); alert("No se pudo leer el PDF. Verifica el archivo y tu conexión.");
  } finally { submit.disabled = false; submit.textContent = "Preparar práctica"; }
}

async function renderSlide() {
  const page = await state.pdf.getPage(state.current + 1);
  const base = page.getViewport({ scale: 1 }); const scale = Math.min(1.6, 850 / base.width);
  const viewport = page.getViewport({ scale }); const canvas = els.slideCanvas; const context = canvas.getContext("2d");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  els.counter.textContent = `Diapositiva ${state.current + 1} / ${state.pdf.numPages}`;
  els.bottomCounter.textContent = `${state.current + 1} / ${state.pdf.numPages}`;
  els.slideNumber.value = String(state.current + 1);
  els.slideNumber.max = String(state.pdf.numPages);
  els.slideTotal.textContent = `/ ${state.pdf.numPages}`;
  els.prev.disabled = state.current === 0; els.next.disabled = state.current === state.pdf.numPages - 1;
  renderTranscript();
}

async function changeSlide(delta) {
  await goToSlide(state.current + delta);
}

async function goToSlide(index) {
  const next = Math.max(0, Math.min(state.pdf.numPages - 1, Number(index) || 0));
  if (next === state.current) { els.slideNumber.value = String(state.current + 1); return; }
  state.current = next;
  await renderSlide();
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { els.status.textContent = "Transcripción no disponible"; return; }
  state.recognition = new Recognition(); state.recognition.lang = "es-PE"; state.recognition.continuous = true; state.recognition.interimResults = true;
  state.recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript?.trim() ?? "";
      if (event.results[i].isFinal && text) state.transcripts[state.current] = `${state.transcripts[state.current]} ${text}`.trim(); else interim += ` ${text}`;
    }
    renderTranscript(interim.trim()); renderSpeechMetric(interim);
  });
  state.recognition.addEventListener("end", () => { if (state.recording) try { state.recognition.start(); } catch {} });
}

function startPractice() {
  state.recording = true; state.startedAt ??= Date.now(); els.toggle.textContent = "Pausar exposición"; els.status.textContent = "Exposición en curso";
  try { state.recognition?.start(); } catch {}
  if (state.secondsLeft !== null && !state.timerId) state.timerId = setInterval(() => { state.secondsLeft = Math.max(0, state.secondsLeft - 1); renderTimer(); if (!state.secondsLeft) stopPractice(); }, 1000);
}
function stopPractice() { state.recording = false; els.toggle.textContent = "Continuar exposición"; els.status.textContent = "Práctica pausada"; try { state.recognition?.stop(); } catch {} if (state.timerId) clearInterval(state.timerId); state.timerId = null; }
function renderTranscript(interim = "") { const text = [state.transcripts[state.current], interim].filter(Boolean).join(" "); els.transcript.textContent = text || "Tu transcripción aparecerá aquí."; }
function renderSpeechMetric(interim = "") { const all = `${state.transcripts.join(" ")} ${interim}`; const seconds = state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0; const metrics = calculateSpeechMetrics(all, seconds); els.speech.textContent = `Muletillas: ${metrics.fillerCount} · Ritmo: ${metrics.wordsPerMinute} ppm`; }
function renderTimer() { if (state.secondsLeft === null) { els.timer.textContent = "Sin límite"; return; } const min = String(Math.floor(state.secondsLeft / 60)).padStart(2,"0"); const sec = String(state.secondsLeft % 60).padStart(2,"0"); els.timer.textContent = `${min}:${sec}`; }

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 720, height: 960 }, audio: false }); els.video.srcObject = state.stream; await els.video.play(); els.cameraMessage.textContent = "Ubica tu cuerpo completo dentro del encuadre";
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"); const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    state.pose = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task", delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1 });
    poseLoop();
  } catch (error) { console.error(error); els.cameraMessage.textContent = "Cámara o análisis corporal no disponible"; }
}
function poseLoop() { const run = () => { if (!state.stream) return; if (els.video.readyState >= 2 && state.pose) { const result = state.pose.detectForVideo(els.video, performance.now()); drawPose(result.landmarks?.[0]); } state.poseLoop = requestAnimationFrame(run); }; run(); }
function drawPose(points) {
  const canvas = els.poseCanvas;
  canvas.width = els.video.videoWidth || 720;
  canvas.height = els.video.videoHeight || 960;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.poseSamples += 1;

  if (!points?.length) {
    els.posture.textContent = "Postura: fuera de encuadre";
    return;
  }

  const bodyPoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const facePoints = [0, 2, 5, 7, 8, 9, 10];
  const visible = bodyPoints.filter((index) => (points[index]?.visibility ?? 1) > .55);
  if (visible.length >= 10) state.visibleBodySamples += 1;
  els.posture.textContent = visible.length >= 10 ? "Postura: cuerpo visible" : "Postura: ajusta el encuadre";

  ctx.strokeStyle = "rgba(255,255,255,.78)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const links = [
    [7, 2], [2, 0], [0, 5], [5, 8], [9, 10],
    [7, 11], [8, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
  ];
  links.forEach(([from, to]) => {
    const a = points[from];
    const b = points[to];
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  });

  drawHeadOutline(ctx, points, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  [...facePoints, ...bodyPoints].forEach((index) => {
    const point = points[index];
    if (!point || (point.visibility ?? 1) < .35) return;
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, index < 11 ? 3.5 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHeadOutline(ctx, points, width, height) {
  const leftEar = points[7];
  const rightEar = points[8];
  const nose = points[0];
  if (!leftEar || !rightEar || !nose) return;

  const leftX = leftEar.x * width;
  const rightX = rightEar.x * width;
  const earY = ((leftEar.y + rightEar.y) / 2) * height;
  const faceWidth = Math.max(24, Math.abs(rightX - leftX) * 1.35);
  const faceHeight = faceWidth * 1.25;
  const centerX = (leftX + rightX) / 2;
  const centerY = earY - faceHeight * .08;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, faceWidth / 2, faceHeight / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
function stopCamera() { if (state.poseLoop) cancelAnimationFrame(state.poseLoop); state.stream?.getTracks().forEach((track)=>track.stop()); state.pose?.close?.(); state.stream=null; }

async function finishPresentation() {
  stopPractice(); els.finish.disabled = true; els.finish.textContent = "El jurado está evaluando...";
  const transcript = state.transcripts.join(" "); const duration = state.startedAt ? (Date.now()-state.startedAt)/1000 : 0;
  try {
    const response = await fetch("/api/presentation/review", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ juryRole:els.juryRole.value, rubric:els.rubric.value, slides:state.slideTexts, transcripts:state.transcripts, speechStats:calculateSpeechMetrics(transcript,duration), bodyStats:{ fullBodyPercentage: state.poseSamples ? Math.round(state.visibleBodySamples/state.poseSamples*100) : 0 } }) });
    const data = await response.json(); if(!response.ok) throw new Error(data.message||"No se pudo evaluar"); stopCamera(); els.stage.classList.add("hidden"); els.jury.classList.remove("hidden"); renderJury(data.review);
  } catch(error) { console.error(error); alert(error.message); els.finish.disabled=false; els.finish.textContent="Finalizar y pasar al jurado"; }
}
function renderJury(review) { els.juryQuestions.innerHTML=""; review.questions.forEach((question,index)=>{const card=document.createElement("article");card.className="jury-question";const label=document.createElement("span");label.textContent=`Pregunta ${index+1}`;const text=document.createElement("p");text.textContent=question;card.append(label,text);els.juryQuestions.append(card);});els.score.textContent=`${review.score}/10`;els.summary.textContent=review.summary;els.tips.innerHTML="";review.tips.forEach((tip)=>{const li=document.createElement("li");li.textContent=tip;els.tips.append(li);});}
