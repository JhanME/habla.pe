import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const port = 5187;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, ["server.mjs", "src", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, GEMINI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("El servidor no inició")), 5000);
    server.once("error", reject);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes(baseUrl)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

after(() => server?.kill());

test("sirve la landing y conserva el estado accesible de voz en entrevistas", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Modo expositor/);
  const interview = await fetch(`${baseUrl}/interview.html`);
  assert.match(await interview.text(), /id="voiceStatus"/);
});

test("genera seis preguntas de contingencia con entrada vacía", async () => {
  const response = await fetch(`${baseUrl}/api/interview/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobText: "", cvText: "" }),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.source, "fallback");
  assert.equal(data.questions.length, 6);
});

test("el endpoint provisional de preguntas fue eliminado", async () => {
  const response = await fetch(`${baseUrl}/api/interview/questions/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 404);
});

test("evalúa con contingencia una respuesta sin depender de Gemini", async () => {
  const response = await fetch(`${baseUrl}/api/interview/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: "Respuesta de prueba" }),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.source, "fallback");
  assert.equal(typeof data.feedback.score, "number");
});

test("genera una revisión de exposición con preguntas de jurado", async () => {
  const response = await fetch(`${baseUrl}/api/presentation/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slides: ["Problema y solución"], transcripts: ["Nuestra solución responde al problema"] }),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.review.questions.length >= 1);
  assert.equal(typeof data.review.score, "number");
});

test("rechaza métodos no permitidos en la API", async () => {
  const response = await fetch(`${baseUrl}/api/interview/questions`);
  assert.equal(response.status, 405);
});
