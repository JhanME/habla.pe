import assert from "node:assert/strict";
import test from "node:test";
import {
  averageFeedbackScore,
  nextQuestionIndex,
  previousQuestionIndex,
} from "../src/modules/InterviewSession.js";

test("la navegación no retrocede antes de la primera pregunta", () => {
  assert.equal(previousQuestionIndex(0), 0);
  assert.equal(previousQuestionIndex(3), 2);
});

test("la navegación indica el final después de la última pregunta", () => {
  assert.equal(nextQuestionIndex(1, 6), 2);
  assert.equal(nextQuestionIndex(5, 6), null);
});

test("el reporte calcula promedio y soporta una entrevista sin evaluaciones", () => {
  assert.equal(averageFeedbackScore([]), 0);
  assert.equal(averageFeedbackScore([{ score: 6 }, { score: 9 }]), 8);
});
