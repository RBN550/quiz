// Responsibility: countdown timer mechanics only.
// Returns a handle with a stop() method.
// onTick(timeLeft, totalTime) is called immediately and on every decrement.
// onEnd() is called when timeLeft reaches 0.

export function startTimer(seconds, { onTick, onEnd } = {}) {
  let timeLeft = seconds;
  const totalTime = seconds;

  onTick?.(timeLeft, totalTime);

  const id = setInterval(() => {
    timeLeft--;
    onTick?.(timeLeft, totalTime);
    if (timeLeft <= 0) {
      clearInterval(id);
      onEnd?.();
    }
  }, 1000);

  return { stop: () => clearInterval(id) };
}
