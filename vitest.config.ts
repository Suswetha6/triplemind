import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the units under test are pure functions and fetch
    // clients. The one browser API they touch (localStorage) is stubbed in
    // setup.ts, which keeps the suite fast and free of a jsdom dependency.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/**', 'src/prompts/**', 'src/store/**'],
    },
  },
});
