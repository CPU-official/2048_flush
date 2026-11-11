import fs from 'node:fs';
import { validAccount } from '../../src/game/account';
import type { RankEntry, RankError } from '../../src/net/messages';

export interface RankingData {
  users: Record<string, string>; // 닉네임 → 비밀번호(평문). 서버 밖으로 내보내지 않는다
  games: (RankEntry & { id: string })[];
}

export interface Submission {
  id: string;
  nickname: string;
  password: string;
  score: number;
  maxTile: number;
}

export function load(file: string): RankingData {
  if (!fs.existsSync(file)) return { users: {}, games: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 쓰는 도중 종료돼도 파일이 깨지지 않게 tmp에 쓰고 rename한다.
export function save(file: string, data: RankingData): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// data를 직접 바꾼다. 반환값이 null이면 성공(중복 id 포함).
export function submit(data: RankingData, s: Submission, now: number): RankError | null {
  if (!validAccount(s.nickname, s.password) || typeof s.id !== 'string' || !Number.isFinite(s.score) || !Number.isFinite(s.maxTile)) {
    return 'invalid';
  }
  if (Object.hasOwn(data.users, s.nickname)) {
    if (data.users[s.nickname] !== s.password) return 'password';
  } else {
    data.users[s.nickname] = s.password;
  }
  if (!data.games.some((g) => g.id === s.id)) {
    data.games.push({ id: s.id, nickname: s.nickname, score: s.score, maxTile: s.maxTile, at: now });
  }
  return null;
}

const strip = ({ nickname, score, maxTile, at }: RankEntry): RankEntry => ({ nickname, score, maxTile, at });
// 점수 높은 순, 같으면 먼저 기록한 쪽이 위.
const byScore = (a: RankEntry, b: RankEntry) => b.score - a.score || a.at - b.at;

// 전체 순위: 닉네임별 최고 점수 한 줄.
export function listAll(data: RankingData, top: number): RankEntry[] {
  const best = new Map<string, RankEntry>();
  for (const g of [...data.games].sort(byScore)) if (!best.has(g.nickname)) best.set(g.nickname, g);
  return [...best.values()].slice(0, top).map(strip);
}

// 개인 기록: 한 닉네임의 게임별 기록.
export function listPlayer(data: RankingData, nickname: string, top: number): RankEntry[] {
  return data.games.filter((g) => g.nickname === nickname).sort(byScore).slice(0, top).map(strip);
}
