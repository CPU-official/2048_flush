import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  base: './', // 패키징 후 file://로 로드한다
  // 테스트 실행 중에는 Electron을 띄우지 않는다
  plugins: process.env.VITEST ? [] : [electron({ main: { entry: 'electron/main.ts' } })],
});
