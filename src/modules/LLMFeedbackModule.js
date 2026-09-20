export class LLMFeedbackModule {
  static async evaluateAnswer(question, answer, speechStats, visualStats) {
    const payload = { question, answer, speechStats, visualStats };
    const response = await fetch("/api/interview/feedback", {
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

  static async generateQuestions(payload) {
    const response = await fetch("/api/interview/questions", {
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
}
