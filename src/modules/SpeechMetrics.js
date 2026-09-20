const fillerPattern = /\b(e+h+|eh+|em+|mmm+|um+|este+|o sea|osea|tipo|bueno)\b/gi;

export function calculateSpeechMetrics(transcript, durationSeconds, pauseStats = {}) {
  const text = String(transcript ?? "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const fillerMatches = text.match(fillerPattern) ?? [];
  const duration = Math.max(0, Number(durationSeconds) || 0);
  return {
    fillerCount: fillerMatches.length,
    fillers: [...new Set(fillerMatches.map((item) => item.toLowerCase()))].slice(0, 8),
    longPauses: Number(pauseStats.longPauses) || 0,
    longestPauseSeconds: Math.round(((Number(pauseStats.longestPauseMs) || 0) / 1000) * 10) / 10,
    durationSeconds: Math.round(duration),
    wordsPerMinute: duration ? Math.round((words.length / duration) * 60) : 0,
    wordCount: words.length,
  };
}
