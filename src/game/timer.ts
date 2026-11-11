export interface TimerSettings {
  start: number;
  maxReduction: number;
  midMove: number;
  steepness: number;
}

// n = 지금까지 한 유효한 수의 횟수. 반환값은 초.
export function timeLimit(n: number, s: TimerSettings): number {
  return s.start - s.maxReduction / (1 + Math.exp(-s.steepness * (n - s.midMove)));
}
