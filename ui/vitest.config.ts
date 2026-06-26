import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        // simulate.ts is pure logic over plain objects — no DOM needed.
        environment: 'node',
        include: ['test/**/*.test.ts'],
    },
})
