export function previousQuestionIndex(currentIndex) {
  return Math.max(0, currentIndex - 1);
}

export function nextQuestionIndex(currentIndex, questionCount) {
  return currentIndex >= questionCount - 1 ? null : currentIndex + 1;
}

export function averageFeedbackScore(feedbackItems) {
  if (!feedbackItems.length) return 0;
  const total = feedbackItems.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return Math.round(total / feedbackItems.length);
}
