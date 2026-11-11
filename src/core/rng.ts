// mulberry32. 상태를 숫자 하나로 들고 다녀 게임 상태가 그대로 직렬화된다.
export function rngNext(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}
