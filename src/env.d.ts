// electron/preload.ts가 노출하는 API. 브라우저에서 dev server를 직접 열면 없다.
interface Window {
  api?: { admin(name: string, ...args: unknown[]): Promise<import('./net/admin').AdminResult> };
}
