import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/game';
import { RECORD_FROM } from '../constants';
import { impactOf } from './impact';

const merge = (value: number): GameEvent => ({ type: 'merge', at: 0, value });
const spawn: GameEvent = { type: 'spawn', at: 1, value: 2 };

describe('impactOf', () => {
  it('머지가 없으면 아무 연출도 없다', () => {
    expect(impactOf([spawn], 0)).toEqual({ merge: 0, shake: 0, flash: 0, record: false });
  });

  it('작은 머지는 흔들림/번쩍임/기록 연출이 없다', () => {
    expect(impactOf([merge(4), merge(32)], 0)).toMatchObject({ shake: 0, flash: 0, record: false });
  });

  it('큰 머지일수록 흔들림이 커지고 상한이 있다', () => {
    const shakes = [128, 256, 512, 1024, 2048, 65536].map((v) => impactOf([merge(v)], 1 << 20).shake);
    expect(shakes[0]).toBeGreaterThan(0);
    expect(shakes).toEqual([...shakes].sort((a, b) => a - b));
    expect(shakes.at(-1)).toBe(24);
  });

  it('번쩍임은 512부터이고 값에 따라 커지며 상한이 있다', () => {
    const at = (v: number) => impactOf([merge(v)], 1 << 20).flash;
    expect(at(256)).toBe(0);
    expect(at(512)).toBeGreaterThan(0);
    expect(at(2048)).toBeGreaterThan(at(512));
    expect(at(1 << 20)).toBeLessThanOrEqual(0.4);
  });

  it('한 수의 여러 머지 중 가장 큰 값으로 정한다', () => {
    expect(impactOf([merge(8), merge(256), merge(16)], 1 << 20).merge).toBe(256);
  });

  it('최고 타일 갱신: 기준값부터, 이번 게임 최고보다 클 때만', () => {
    expect(impactOf([merge(RECORD_FROM / 2)], 0).record).toBe(false);
    expect(impactOf([merge(RECORD_FROM)], 32).record).toBe(true);
    expect(impactOf([merge(RECORD_FROM)], RECORD_FROM).record).toBe(false); // 같은 값은 갱신이 아니다
    expect(impactOf([merge(128)], 256).record).toBe(false);
    expect(impactOf([merge(RECORD_FROM)], 32).flash).toBeGreaterThan(0); // 작은 값이어도 갱신이면 번쩍인다
  });
});
