import { NICKNAME_MAX } from '../constants';

export interface Account {
  nickname: string;
  password: string; // 숫자 4자리 "문자열". 0123이 123이 되면 안 된다
}

// 닉네임은 앞뒤 공백을 지운 뒤 검사한다. 클라이언트와 서버가 같이 쓴다.
export function validAccount(nickname: unknown, password: unknown): boolean {
  return (
    typeof nickname === 'string' &&
    nickname === nickname.trim() &&
    nickname.length >= 1 &&
    nickname.length <= NICKNAME_MAX &&
    typeof password === 'string' &&
    /^\d{4}$/.test(password)
  );
}
