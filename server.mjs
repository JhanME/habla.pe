import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

await loadEnvFile();

const root = path.resolve(process.argv[2] ?? "src");
const port = Number(process.argv[3] ?? 5173);
const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const geminiApiKey = normalizeApiKey(process.env.GEMINI_API_KEY);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(url, response);
  } catch (error) {
    console.error(error);
    writeJson(response, 500, { error: "internal_error", message: "Error interno del servidor." });
  }
});

async function handleApi(request, response, url) {
  if (request.method !== "POST") {
    writeJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    writeJson(response, 400, { error: "invalid_json", message: "El cuerpo de la peticion no es JSON valido." });
    return;
  }

  if (url.pathname === "/api/interview/questions") {
    const result = await generateInterviewQuestions(body);
    writeJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/interview/questions/quick") {
    // Returns fallback questions instantly — no AI call
    const { jobText = "", cvText = "", jobUrl = "" } = body;
    writeJson(response, 200, {
      source: "fallback",
      questions: fallbackQuestions(jobText, cvText, jobUrl),
    });
    return;
  }

  if (url.pathname === "/api/interview/feedback") {
    const result = await evaluateInterviewAnswer(body);
    writeJson(response, 200, result);
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}

async function generateInterviewQuestions({ jobText = "", cvText = "", jobUrl = "" }) {
  if (!jobText.trim() || !cvText.trim()) {
    return { source: "fallback", questions: fallbackQuestions(jobText, cvText, jobUrl) };
  }

  if (!geminiApiKey) {
    return {
      source: "fallback",
      warning: "GEMINI_API_KEY no esta configurada. Usando generacion local.",
      questions: fallbackQuestions(jobText, cvText, jobUrl),
    };
  }

  const prompt = `
Eres un coach senior de entrevistas laborales en espanol.
Genera 6 preguntas personalizadas para practicar una entrevista.

Entrada:
- URL de vacante: ${jobUrl || "No indicada"}
- Vacante:
${jobText}

- CV:
${cvText}

Devuelve exclusivamente JSON valido con esta forma:
{
  "questions": [
    {
      "type": "experiencia | rol | tecnica | brecha | conductual | motivacion",
      "question": "pregunta clara y natural",
      "reason": "por que esta pregunta importa para esta vacante",
      "hint": "como deberia enfocar la respuesta",
      "criteria": ["criterio 1", "criterio 2", "criterio 3", "criterio 4"]
    }
  ]
}

Reglas:
- Usa espanol profesional y directo.
- Las preguntas deben cruzar requisitos reales de la vacante con evidencias del CV.
- Incluye una pregunta de brecha si falta una habilidad relevante.
- No inventes experiencia que no aparece en el CV.
`;

  try {
    const data = await callGeminiJson(prompt);
    const questions = normalizeQuestions(data.questions);
    return { source: "gemini", questions };
  } catch (error) {
    console.error("Gemini questions failed:", error);
    return {
      source: "fallback",
      warning: "Gemini no respondio correctamente. Usando generacion local.",
      questions: fallbackQuestions(jobText, cvText, jobUrl),
    };
  }
}

async function evaluateInterviewAnswer({ question, answer = "", speechStats = null, visualStats = null }) {
  if (!question || typeof question !== "object") {
    return { source: "fallback", feedback: fallbackFeedback({ criteria: [] }, answer, speechStats, visualStats) };
  }

  if (!geminiApiKey) {
    return {
      source: "fallback",
      warning: "GEMINI_API_KEY no esta configurada. Usando evaluacion local.",
      feedback: fallbackFeedback(question, answer, speechStats, visualStats),
    };
  }

  const prompt = `
Eres un coach senior de entrevistas laborales. Evalua la respuesta del candidato.

Pregunta:
${question.question}

Tipo: ${question.type}
Criterios esperados: ${(question.criteria ?? []).join(", ")}
Respuesta del candidato:
${answer || "(sin respuesta)"}

Metricas visuales estimadas:
${JSON.stringify(visualStats ?? {}, null, 2)}

Metricas orales estimadas:
${JSON.stringify(speechStats ?? {}, null, 2)}

Devuelve exclusivamente JSON valido con esta forma:
{
  "score": 1,
  "summary": "resumen breve",
  "tips": ["tip accionable 1", "tip accionable 2", "tip accionable 3"],
  "oralFeedback": "feedback breve sobre muletillas, pausas o ritmo si hay datos",
  "visualFeedback": "feedback breve sobre encuadre/contacto visual si hay datos"
}

Reglas:
- Score entero entre 1 y 10.
- Penaliza respuestas vacias o demasiado genericas.
- Valora estructura STAR, evidencia, metricas, claridad y ajuste al rol.
- Valora comunicacion oral: pocas muletillas, pausas controladas y ritmo natural.
- Si hay muchas muletillas como eh, mmm, este, o pausas largas, mencionalo con tacto y una accion concreta.
- Si hay bajo contacto visual o mal encuadre, mencionalo sin exagerar.
`;

  try {
    const data = await callGeminiJson(prompt);
    return { source: "gemini", feedback: normalizeFeedback(data) };
  } catch (error) {
    console.error("Gemini feedback failed:", error);
    return {
      source: "fallback",
      warning: "Gemini no respondio correctamente. Usando evaluacion local.",
      feedback: fallbackFeedback(question, answer, speechStats, visualStats),
    };
  }
}

async function callGeminiJson(prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.45,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini ${response.status}: ${text}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return parseJson(text);
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Invalid questions payload");
  }

  return questions.slice(0, 6).map((item) => ({
    id: crypto.randomUUID(),
    type: String(item.type ?? "entrevista"),
    question: String(item.question ?? "").trim(),
    reason: String(item.reason ?? "Personalizada para la vacante."),
    hint: String(item.hint ?? "Responde con contexto, accion y resultado."),
    criteria: Array.isArray(item.criteria) ? item.criteria.slice(0, 5).map(String) : [],
  })).filter((item) => item.question);
}

function normalizeFeedback(data) {
  const score = Math.max(1, Math.min(10, Math.round(Number(data.score) || 1)));
  const tips = Array.isArray(data.tips) ? data.tips.slice(0, 4).map(String) : [];
  return {
    score,
    summary: String(data.summary ?? "Feedback generado para tu respuesta."),
    tips: tips.length ? tips : ["Agrega una historia concreta con contexto, accion y resultado."],
    oralFeedback: data.oralFeedback ? String(data.oralFeedback) : "",
    visualFeedback: data.visualFeedback ? String(data.visualFeedback) : "",
  };
}

function fallbackQuestions(jobText, cvText, jobUrl) {
  const jobKeywords = extractKeywords(jobText);
  const cvKeywords = extractKeywords(cvText);
  const overlap = jobKeywords.filter((word) => cvKeywords.includes(word));
  const strongestSkill = overlap[0] ?? jobKeywords[0] ?? "tu experiencia";
  const secondSkill = overlap[1] ?? jobKeywords[1] ?? "el rol";
  const missingSkill = jobKeywords.find((word) => !cvKeywords.includes(word)) ?? "un requisito nuevo";
  const source = jobUrl ? "vacante enlazada" : "descripcion pegada";

  return [
    {
      id: crypto.randomUUID(),
      type: "experiencia",
      question: `Cuentame sobre un proyecto donde hayas usado ${strongestSkill}. Que problema resolviste y cual fue el resultado?`,
      reason: `Cruza tu CV con la ${source}.`,
      hint: "Responde con contexto, accion concreta, herramienta usada y resultado medible.",
      criteria: ["contexto", "accion", "resultado", strongestSkill],
    },
    {
      id: crypto.randomUUID(),
      type: "rol",
      question: `La vacante pide ${secondSkill}. Como aplicarias tu experiencia actual para generar valor en los primeros 30 dias?`,
      reason: "Evalua ajuste al puesto.",
      hint: "Conecta tus proyectos con responsabilidades reales del trabajo.",
      criteria: ["primeros 30 dias", "valor", "responsabilidades", secondSkill],
    },
    {
      id: crypto.randomUUID(),
      type: "tecnica",
      question: "Si recibes datos incompletos o inconsistentes, que pasos seguirias antes de presentar un analisis?",
      reason: "Pregunta tecnica base para roles de analisis y producto.",
      hint: "Menciona validacion, limpieza, supuestos y comunicacion de limites.",
      criteria: ["validacion", "limpieza", "supuestos", "comunicacion"],
    },
    {
      id: crypto.randomUUID(),
      type: "brecha",
      question: `Veo que el rol menciona ${missingSkill}. Si no lo dominas completamente, como cerrarias esa brecha rapidamente?`,
      reason: "Convierte una debilidad potencial en plan.",
      hint: "Se honesto y muestra metodo de aprendizaje aplicado.",
      criteria: ["honestidad", "aprendizaje", "plan", missingSkill],
    },
    {
      id: crypto.randomUUID(),
      type: "conductual",
      question: "Hablame de una vez en la que tuviste que explicar un hallazgo tecnico a alguien no tecnico.",
      reason: "Mide comunicacion con stakeholders.",
      hint: "Usa una historia breve: situacion, audiencia, decision y resultado.",
      criteria: ["audiencia", "claridad", "decision", "resultado"],
    },
    {
      id: crypto.randomUUID(),
      type: "motivacion",
      question: "Por que este puesto y esta empresa tienen sentido como siguiente paso para ti?",
      reason: "Cierre de motivacion y narrativa profesional.",
      hint: "Conecta rol, aprendizaje, contribucion y trayectoria.",
      criteria: ["motivacion", "rol", "contribucion", "trayectoria"],
    },
  ];
}

function fallbackFeedback(question, answer, speechStats, visualStats) {
  const normalized = answer.toLowerCase();
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const matchedCriteria = (question.criteria ?? []).filter((item) => normalized.includes(String(item).toLowerCase()));

  let score = answer.trim() ? 4 : 1;
  if (wordCount >= 35) score += 1;
  if (wordCount >= 75) score += 1;
  if (matchedCriteria.length >= 1) score += 1;
  if (matchedCriteria.length >= 2) score += 1;
  if (/\d|%|resultado|impacto|mejor/i.test(answer)) score += 1;
  if (/aprend|decid|implemente|analic|comuniqu/i.test(answer)) score += 1;
  if ((speechStats?.fillerCount ?? 0) >= 5) score -= 1;
  if ((speechStats?.longPauses ?? 0) >= 3) score -= 1;
  if ((speechStats?.wordsPerMinute ?? 0) > 0 && ((speechStats.wordsPerMinute < 85) || (speechStats.wordsPerMinute > 185))) score -= 1;
  if (visualStats?.inFramePercentage < 60) score -= 1;
  if (visualStats?.eyeContactPercentage < 45) score -= 1;
  score = Math.max(1, Math.min(10, score));

  const visualFeedback = visualStats
    ? `Encuadre ${Math.round(visualStats.inFramePercentage ?? 0)}%, contacto visual ${Math.round(visualStats.eyeContactPercentage ?? 0)}%.`
    : "";
  const oralFeedback = speechStats
    ? `Muletillas ${speechStats.fillerCount ?? 0}, pausas largas ${speechStats.longPauses ?? 0}, ritmo ${speechStats.wordsPerMinute ?? 0} ppm.`
    : "";

  return {
    score,
    summary: score >= 8
      ? "Respuesta fuerte: conecta experiencia, accion y valor para el rol."
      : score >= 6
        ? "Respuesta correcta, pero puede ganar fuerza con mas detalle y evidencia."
        : "Respuesta inicial: necesita estructura, ejemplos y un resultado mas claro.",
    tips: [
      wordCount < 50 ? "Agrega una historia concreta con situacion, accion y resultado." : "Manten la estructura clara y evita extenderte sin evidencia.",
      matchedCriteria.length < 2 ? `Incluye explicitamente: ${(question.criteria ?? []).slice(0, 3).join(", ")}.` : "Buen uso de criterios relevantes para la pregunta.",
      /\d|%/.test(answer) ? "Buen detalle: los numeros ayudan a sonar mas convincente." : "Anade una metrica, plazo o resultado observable.",
      (speechStats?.fillerCount ?? 0) >= 5 ? "Reduce muletillas: respira, pausa un segundo y retoma con la siguiente idea." : "Buen control de muletillas para una respuesta hablada.",
      (speechStats?.longPauses ?? 0) >= 3 ? "Practica una estructura de 3 puntos para evitar pausas largas." : "Las pausas no interrumpen demasiado la respuesta.",
    ],
    oralFeedback,
    visualFeedback,
  };
}

function extractKeywords(text) {
  const stopwords = new Set([
    "para", "como", "con", "los", "las", "una", "uno", "del", "que", "por", "and", "the",
    "de", "en", "y", "a", "el", "la", "un", "se", "su", "al", "o", "es", "son",
  ]);
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9+#.]{3,}/g) ?? [];
  const counts = new Map();
  words.forEach((word) => {
    if (!stopwords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([word]) => word);
}

async function serveStatic(url, response) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${pathname}`);

  if (!isInsideRoot(filePath)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeApiKey(value) {
  if (!value || value === "REEMPLAZA_CON_TU_API_KEY_DE_GEMINI") return "";
  return value;
}

async function loadEnvFile(filePath = ".env") {
  try {
    const raw = await readFile(path.resolve(filePath), "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}`);
  console.log(`Gemini model: ${geminiModel}`);
  console.log(geminiApiKey ? "Gemini API: enabled" : "Gemini API: disabled, using local fallback");
});
