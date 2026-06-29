const state = {
  questions: [],
  answers: new Map(),
  current: 0,
  secondsLeft: 120 * 60,
  timerId: null,
  cameraStream: null,
  visualDetector: null,
  visualLoopId: null,
  visualSamples: {
    total: 0,
    faceDetected: 0,
    inFrame: 0,
    eyeContact: 0,
  },
  visualStats: {
    faceDetected: false,
    inFrame: false,
    inFramePercentage: 0,
    eyeContact: false,
    eyeContactPercentage: 0,
    currentEyeContactScore: 0,
    detector: "none",
  },
  gazeScoreBuffer: [],
};

const $ = (selector) => document.querySelector(selector);

const els = {
  setupView: $("#setupView"),
  interviewView: $("#interviewView"),
  resultsView: $("#resultsView"),
  setupForm: $("#setupForm"),
  generateInterview: $("#generateInterview"),
  loadExample: $("#loadExample"),
  jobUrl: $("#jobUrl"),
  jobText: $("#jobText"),
  cvText: $("#cvText"),
  cvFile: $("#cvFile"),
  backButton: $("#backButton"),
  progressFill: $("#progressFill"),
  timer: $("#timer"),
  cameraPanel: $("#cameraPanel"),
  cameraVideo: $("#cameraVideo"),
  faceOverlay: $("#faceOverlay"),
  cameraStatus: $("#cameraStatus"),
  presenceMetric: $("#presenceMetric"),
  frameMetric: $("#frameMetric"),
  gazeMetric: $("#gazeMetric"),
  questionType: $("#questionType"),
  questionReason: $("#questionReason"),
  questionText: $("#questionText"),
  questionHint: $("#questionHint"),
  answerInput: $("#answerInput"),
  feedbackBox: $("#feedbackBox"),
  feedbackScore: $("#feedbackScore"),
  feedbackSummary: $("#feedbackSummary"),
  feedbackList: $("#feedbackList"),
  prevQuestion: $("#prevQuestion"),
  nextQuestion: $("#nextQuestion"),
  readQuestion: $("#readQuestion"),
  toggleCamera: $("#toggleCamera"),
  evaluateAnswer: $("#evaluateAnswer"),
  finalScore: $("#finalScore"),
  finalSummary: $("#finalSummary"),
  strengthsList: $("#strengthsList"),
  improvementsList: $("#improvementsList"),
  restartInterview: $("#restartInterview"),
  reviewInterview: $("#reviewInterview"),
};

const examples = {
  job: `Puesto: Data Analyst Junior
Responsabilidades: limpiar datos, crear dashboards, analizar metricas de producto, comunicar hallazgos a negocio y automatizar reportes.
Requisitos: SQL, Python, Pandas, visualizacion, pensamiento analitico, comunicacion clara, experiencia con stakeholders.
Deseable: Power BI, experimentacion A/B, estadistica basica y Git.`,
  cv: `CV: Estudiante de ingenieria con proyectos de analisis de datos en Python. Experiencia usando Pandas, SQL, Excel y Power BI. Proyecto destacado: dashboard de ventas con KPIs, limpieza de datos y presentacion a un equipo academico. Interes en producto, automatizacion y storytelling con datos.`,
};

els.loadExample.addEventListener("click", () => {
  els.jobUrl.value = "https://empresa.demo/jobs/data-analyst-junior";
  els.jobText.value = examples.job;
  els.cvText.value = examples.cv;
});

els.cvFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    els.cvText.value = "PDF cargado. Para esta demo pega aqui el texto del CV si el archivo no es TXT/MD.";
    return;
  }

  els.cvText.value = await file.text();
});

els.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const jobText = els.jobText.value.trim();
  const cvText = els.cvText.value.trim();

  if (jobText.length < 40 || cvText.length < 40) {
    alert("Pega un poco mas de contexto de la vacante y del CV para personalizar la entrevista.");
    return;
  }

  setButtonBusy(els.generateInterview, true, "Generando...");

  try {
    const result = await postJson("/api/interview/questions", {
      jobText,
      cvText,
      jobUrl: els.jobUrl.value.trim(),
    });

    state.questions = result.questions;
    state.answers = new Map();
    state.current = 0;
    state.secondsLeft = 120 * 60;
    resetVisualSamples();

    showView("interview");
    renderQuestion();
    startTimer();

    if (result.warning) {
      console.warn(result.warning);
    }
  } catch (error) {
    console.error(error);
    alert("No se pudo generar la entrevista. Revisa el servidor e intenta de nuevo.");
  } finally {
    setButtonBusy(els.generateInterview, false, "Generar entrevista");
  }
});

els.prevQuestion.addEventListener("click", () => {
  saveCurrentAnswer();
  state.current = Math.max(0, state.current - 1);
  renderQuestion();
});

els.nextQuestion.addEventListener("click", async () => {
  saveCurrentAnswer();
  if (state.current === state.questions.length - 1) {
    await renderResults();
    showView("results");
    return;
  }
  state.current += 1;
  renderQuestion();
});

els.evaluateAnswer.addEventListener("click", async () => {
  saveCurrentAnswer();
  const question = state.questions[state.current];
  const answer = state.answers.get(question.id)?.answer ?? "";

  setButtonBusy(els.evaluateAnswer, true, "Evaluando...");
  try {
    const result = await postJson("/api/interview/feedback", {
      question,
      answer,
      visualStats: getVisualStatsSnapshot(),
    });
    state.answers.set(question.id, { answer, feedback: result.feedback });
    renderFeedback(result.feedback);
  } catch (error) {
    console.error(error);
    alert("No se pudo evaluar la respuesta. Intenta nuevamente.");
  } finally {
    setButtonBusy(els.evaluateAnswer, false, "Evaluar");
  }
});

els.readQuestion.addEventListener("click", () => {
  const utterance = new SpeechSynthesisUtterance(els.questionText.textContent);
  utterance.lang = "es-ES";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
});

els.toggleCamera.addEventListener("click", async () => {
  if (state.cameraStream) {
    stopCamera();
    return;
  }
  await startCamera();
});

els.backButton.addEventListener("click", () => {
  if (!els.resultsView.classList.contains("hidden")) {
    showView("interview");
    return;
  }
  if (!els.interviewView.classList.contains("hidden")) {
    showView("setup");
    stopTimer();
  }
});

els.restartInterview.addEventListener("click", () => {
  stopCamera();
  stopTimer();
  showView("setup");
});

els.reviewInterview.addEventListener("click", () => {
  showView("interview");
  renderQuestion();
});

function showView(view) {
  els.setupView.classList.toggle("hidden", view !== "setup");
  els.interviewView.classList.toggle("hidden", view !== "interview");
  els.resultsView.classList.toggle("hidden", view !== "results");
}

function renderQuestion() {
  const question = state.questions[state.current];
  const saved = state.answers.get(question.id);
  const progress = ((state.current + 1) / state.questions.length) * 100;

  els.progressFill.style.width = `${progress}%`;
  els.questionType.textContent = `Q${state.current + 1}. ${question.type}`;
  els.questionReason.textContent = question.reason;
  els.questionText.textContent = question.question;
  els.questionHint.textContent = question.hint;
  els.answerInput.value = saved?.answer ?? "";

  if (saved?.feedback) {
    renderFeedback(saved.feedback);
  } else {
    els.feedbackBox.classList.add("hidden");
  }
}

function saveCurrentAnswer() {
  const question = state.questions[state.current];
  const previous = state.answers.get(question.id);
  state.answers.set(question.id, {
    answer: els.answerInput.value.trim(),
    feedback: previous?.feedback,
  });
}

function renderFeedback(feedback) {
  els.feedbackScore.textContent = `Score ${feedback.score}/10`;
  els.feedbackSummary.textContent = feedback.visualFeedback
    ? `${feedback.summary} ${feedback.visualFeedback}`
    : feedback.summary;
  els.feedbackList.innerHTML = "";
  feedback.tips.forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    els.feedbackList.appendChild(li);
  });
  els.feedbackBox.classList.remove("hidden");
}

async function renderResults() {
  saveCurrentAnswer();
  setButtonBusy(els.nextQuestion, true, "...");

  const evaluated = [];
  for (const question of state.questions) {
    const saved = state.answers.get(question.id);
    if (saved?.feedback) {
      evaluated.push(saved.feedback);
      continue;
    }

    const result = await postJson("/api/interview/feedback", {
      question,
      answer: saved?.answer ?? "",
      visualStats: getVisualStatsSnapshot(),
    });
    state.answers.set(question.id, { answer: saved?.answer ?? "", feedback: result.feedback });
    evaluated.push(result.feedback);
  }

  setButtonBusy(els.nextQuestion, false, ">");

  const average = Math.round(evaluated.reduce((sum, item) => sum + item.score, 0) / evaluated.length);
  const visual = getVisualStatsSnapshot();
  els.finalScore.textContent = `${average}`;
  els.finalSummary.textContent =
    average >= 8
      ? "Tu entrevista ya tiene una narrativa solida. Practica fluidez y cierre ejecutivo."
      : average >= 6
        ? "Vas bien. El salto esta en responder con historias mas concretas y resultados medibles."
        : "Conviene practicar respuestas con mas estructura antes de la entrevista real.";

  fillList(els.strengthsList, [
    "La entrevista esta personalizada al CV y a la vacante.",
    average >= 7 ? "Hay buena conexion entre experiencia y responsabilidades." : "Tienes una base clara para convertir experiencia en historias.",
    visual.faceDetected ? `El detector visual registro rostro durante ${Math.round(visual.presencePercentage)}% de la practica.` : "Activa la camara para incluir feedback visual.",
  ]);

  fillList(els.improvementsList, [
    "Usar mas metricas, tiempos o impacto observable.",
    "Responder con estructura: situacion, accion, resultado y aprendizaje.",
    visual.eyeContactPercentage >= 65 ? "Mantener contacto visual sin perder naturalidad." : "Practicar mirando mas a la camara durante respuestas clave.",
    visual.inFramePercentage >= 70 ? "Mantener el encuadre estable." : "Centrar rostro y hombros dentro de la guia antes de responder.",
  ]);
}

function fillList(element, items) {
  element.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
      audio: false,
    });
    state.cameraStream = stream;
    els.cameraVideo.srcObject = stream;
    await els.cameraVideo.play();
    resetVisualSamples();
    els.cameraPanel.classList.add("active");
    els.cameraStatus.textContent = "Cargando detector...";
    state.visualDetector = await createVisualDetector();
    startVisualLoop();
  } catch (error) {
    console.error(error);
    els.cameraStatus.textContent = "Permiso denegado";
    els.presenceMetric.textContent = "Presencia: sin camara";
    els.frameMetric.textContent = "Encuadre: sin camara";
    els.gazeMetric.textContent = "Mirada: sin camara";
  }
}

function stopCamera() {
  if (state.visualLoopId) cancelAnimationFrame(state.visualLoopId);
  state.visualLoopId = null;
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  state.visualDetector?.close?.();
  state.visualDetector = null;
  els.cameraVideo.srcObject = null;
  els.cameraPanel.classList.remove("active", "in-frame", "off-frame", "low-gaze");
  els.cameraStatus.textContent = "Camara inactiva";
  els.presenceMetric.textContent = "Presencia: --";
  els.frameMetric.textContent = "Encuadre: --";
  els.gazeMetric.textContent = "Mirada: --";
  clearOverlay();
}

async function createVisualDetector() {
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    return { type: "mediapipe", landmarker };
  } catch (error) {
    console.warn("MediaPipe no disponible, usando fallback.", error);
    if ("FaceDetector" in window) {
      return { type: "face-detector", detector: new FaceDetector({ fastMode: true, maxDetectedFaces: 1 }) };
    }
    return { type: "basic" };
  }
}

function startVisualLoop() {
  let lastRun = 0;
  const loop = async (now) => {
    if (!state.cameraStream) return;

    if (now - lastRun > 140 && els.cameraVideo.readyState >= 2) {
      lastRun = now;
      await updateVisualDetection(now);
    }

    state.visualLoopId = requestAnimationFrame(loop);
  };
  state.visualLoopId = requestAnimationFrame(loop);
}

async function updateVisualDetection(now) {
  const reading = await readVisualFrame(now);
  state.visualSamples.total += 1;
  if (reading.faceDetected) state.visualSamples.faceDetected += 1;
  if (reading.inFrame) state.visualSamples.inFrame += 1;
  if (reading.eyeContact) state.visualSamples.eyeContact += 1;

  state.visualStats = {
    faceDetected: reading.faceDetected,
    inFrame: reading.inFrame,
    inFramePercentage: percentage(state.visualSamples.inFrame, state.visualSamples.total),
    eyeContact: reading.eyeContact,
    eyeContactPercentage: percentage(state.visualSamples.eyeContact, state.visualSamples.total),
    currentEyeContactScore: reading.eyeContactScore,
    presencePercentage: percentage(state.visualSamples.faceDetected, state.visualSamples.total),
    detector: state.visualDetector?.type ?? "none",
  };

  renderVisualState(reading);
}

async function readVisualFrame(now) {
  if (state.visualDetector?.type === "mediapipe") {
    const result = state.visualDetector.landmarker.detectForVideo(els.cameraVideo, now);
    const landmarks = result.faceLandmarks?.[0];
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
    if (!landmarks) return emptyReading("mediapipe");

    const box = getLandmarkBox(landmarks);
    const gazeScore = smoothGazeScore(estimateGazeScore(landmarks, blendshapes));
    return {
      detector: "mediapipe",
      faceDetected: true,
      inFrame: isBoxInsideGuide(box),
      eyeContact: gazeScore >= 52,
      eyeContactScore: gazeScore,
      box,
    };
  }

  if (state.visualDetector?.type === "face-detector") {
    const faces = await state.visualDetector.detector.detect(els.cameraVideo);
    const face = faces[0];
    if (!face) return emptyReading("face-detector");
    const box = normalizeNativeBox(face.boundingBox, els.cameraVideo.videoWidth, els.cameraVideo.videoHeight);
    const inFrame = isBoxInsideGuide(box);
    return {
      detector: "face-detector",
      faceDetected: true,
      inFrame,
      eyeContact: inFrame,
      eyeContactScore: inFrame ? 55 : 25,
      box,
    };
  }

  return emptyReading("basic");
}

function emptyReading(detector) {
  return {
    detector,
    faceDetected: false,
    inFrame: false,
    eyeContact: false,
    eyeContactScore: 0,
    box: null,
  };
}

function getLandmarkBox(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: minX + (maxX - minX) / 2,
    centerY: minY + (maxY - minY) / 2,
  };
}

function normalizeNativeBox(box, videoWidth, videoHeight) {
  return {
    x: box.x / videoWidth,
    y: box.y / videoHeight,
    width: box.width / videoWidth,
    height: box.height / videoHeight,
    centerX: (box.x + box.width / 2) / videoWidth,
    centerY: (box.y + box.height / 2) / videoHeight,
  };
}

function isBoxInsideGuide(box) {
  if (!box) return false;
  const centeredX = box.centerX >= 0.31 && box.centerX <= 0.69;
  const centeredY = box.centerY >= 0.22 && box.centerY <= 0.64;
  const naturalSize = box.width >= 0.13 && box.width <= 0.52 && box.height >= 0.18 && box.height <= 0.68;
  return centeredX && centeredY && naturalSize;
}

function estimateGazeScore(landmarks, blendshapes) {
  const landmarkScore = estimateIrisGazeScore(landmarks);
  const get = (name) => blendshapes.find((item) => item.categoryName === name)?.score ?? 0;
  const horizontal = get("eyeLookInLeft") + get("eyeLookOutLeft") + get("eyeLookInRight") + get("eyeLookOutRight");
  const vertical = get("eyeLookUpLeft") + get("eyeLookDownLeft") + get("eyeLookUpRight") + get("eyeLookDownRight");
  const blink = get("eyeBlinkLeft") + get("eyeBlinkRight");
  const movement = horizontal * 0.72 + vertical * 0.45 + blink * 0.22;
  const blendshapeScore = Math.max(0, Math.min(100, 100 - movement * 95));

  if (landmarkScore === null) return Math.round(blendshapeScore);
  return Math.round(landmarkScore * 0.68 + blendshapeScore * 0.32);
}

function estimateIrisGazeScore(landmarks) {
  const left = getEyeRatio(landmarks, {
    outer: 33,
    inner: 133,
    top: 159,
    bottom: 145,
    iris: [468, 469, 470, 471, 472],
  });
  const right = getEyeRatio(landmarks, {
    outer: 263,
    inner: 362,
    top: 386,
    bottom: 374,
    iris: [473, 474, 475, 476, 477],
  });

  if (!left || !right) return null;

  const horizontalOffset = Math.abs(((left.x - 0.5) + (right.x - 0.5)) / 2);
  const verticalOffset = Math.abs(((left.y - 0.5) + (right.y - 0.5)) / 2);
  const asymmetry = Math.abs(left.x - (1 - right.x)) * 0.45;
  const penalty = horizontalOffset * 150 + verticalOffset * 105 + asymmetry * 80;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function getEyeRatio(landmarks, points) {
  const irisPoints = points.iris.map((index) => landmarks[index]).filter(Boolean);
  const outer = landmarks[points.outer];
  const inner = landmarks[points.inner];
  const top = landmarks[points.top];
  const bottom = landmarks[points.bottom];

  if (!irisPoints.length || !outer || !inner || !top || !bottom) return null;

  const iris = averagePoint(irisPoints);
  const minX = Math.min(outer.x, inner.x);
  const maxX = Math.max(outer.x, inner.x);
  const minY = Math.min(top.y, bottom.y);
  const maxY = Math.max(top.y, bottom.y);
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);

  return {
    x: (iris.x - minX) / width,
    y: (iris.y - minY) / height,
  };
}

function averagePoint(points) {
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 }
  );
}

function smoothGazeScore(score) {
  state.gazeScoreBuffer.push(score);
  if (state.gazeScoreBuffer.length > 8) state.gazeScoreBuffer.shift();
  const sorted = [...state.gazeScoreBuffer].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function renderVisualState(reading) {
  const frameText = `${Math.round(state.visualStats.inFramePercentage)}%`;
  const gazeText = `${Math.round(state.visualStats.eyeContactPercentage)}%`;

  els.cameraPanel.classList.toggle("in-frame", reading.faceDetected && reading.inFrame);
  els.cameraPanel.classList.toggle("off-frame", !reading.faceDetected || !reading.inFrame);
  els.cameraPanel.classList.toggle("low-gaze", reading.faceDetected && reading.inFrame && !reading.eyeContact);

  if (!reading.faceDetected) {
    els.cameraStatus.textContent = "Rostro fuera de camara";
    els.presenceMetric.textContent = "Presencia: no detectada";
  } else if (!reading.inFrame) {
    els.cameraStatus.textContent = "Fuera de encuadre";
    els.presenceMetric.textContent = "Presencia: activa";
  } else if (!reading.eyeContact) {
    els.cameraStatus.textContent = "Ajusta la mirada";
    els.presenceMetric.textContent = "Presencia: activa";
  } else {
    els.cameraStatus.textContent = "Encuadre y mirada correctos";
    els.presenceMetric.textContent = "Presencia: activa";
  }

  els.frameMetric.textContent = `Encuadre: ${frameText}`;
  els.gazeMetric.textContent = `Mirada: ${gazeText} (${Math.round(reading.eyeContactScore)}%)`;
  drawOverlay(reading);
}

function drawOverlay(reading) {
  const canvas = els.faceOverlay;
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * pixelRatio);
  canvas.height = Math.round(rect.height * pixelRatio);
  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  if (!reading.box) return;

  const x = (1 - reading.box.x - reading.box.width) * rect.width;
  const y = reading.box.y * rect.height;
  const width = reading.box.width * rect.width;
  const height = reading.box.height * rect.height;
  context.strokeStyle = reading.inFrame ? "#22c55e" : "#ef4444";
  context.lineWidth = 3;
  context.lineCap = "round";
  drawCornerFrame(context, x, y, width, height);
}

function clearOverlay() {
  const context = els.faceOverlay.getContext("2d");
  context.clearRect(0, 0, els.faceOverlay.width, els.faceOverlay.height);
}

function drawCornerFrame(context, x, y, width, height) {
  const corner = Math.min(width, height) * 0.22;
  const radius = 12;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + corner, y);
  context.moveTo(x, y + radius);
  context.lineTo(x, y + corner);

  context.moveTo(x + width - corner, y);
  context.lineTo(x + width - radius, y);
  context.moveTo(x + width, y + radius);
  context.lineTo(x + width, y + corner);

  context.moveTo(x + radius, y + height);
  context.lineTo(x + corner, y + height);
  context.moveTo(x, y + height - radius);
  context.lineTo(x, y + height - corner);

  context.moveTo(x + width - corner, y + height);
  context.lineTo(x + width - radius, y + height);
  context.moveTo(x + width, y + height - radius);
  context.lineTo(x + width, y + height - corner);
  context.stroke();
}

function resetVisualSamples() {
  state.visualSamples = { total: 0, faceDetected: 0, inFrame: 0, eyeContact: 0 };
  state.visualStats = {
    faceDetected: false,
    inFrame: false,
    inFramePercentage: 0,
    eyeContact: false,
    eyeContactPercentage: 0,
    currentEyeContactScore: 0,
    presencePercentage: 0,
    detector: "none",
  };
  state.gazeScoreBuffer = [];
}

function getVisualStatsSnapshot() {
  return { ...state.visualStats };
}

function percentage(value, total) {
  return total ? (value / total) * 100 : 0;
}

function startTimer() {
  stopTimer();
  renderTimer();
  state.timerId = window.setInterval(async () => {
    state.secondsLeft = Math.max(0, state.secondsLeft - 1);
    renderTimer();
    if (state.secondsLeft === 0) {
      stopTimer();
      await renderResults();
      showView("results");
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

function renderTimer() {
  const minutes = String(Math.floor(state.secondsLeft / 60)).padStart(2, "0");
  const seconds = String(state.secondsLeft % 60).padStart(2, "0");
  els.timer.textContent = `${minutes}:${seconds}`;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "request_failed");
  }
  return data;
}

function setButtonBusy(button, isBusy, text) {
  button.disabled = isBusy;
  button.textContent = text;
}
