import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Test environment configuration
    environment: "node",
    
    // Global test setup
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    
    // Test file patterns
    include: [
      "tests/**/*.{test,spec}.{js,ts}",
      "src/**/*.{test,spec}.{js,ts}"
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**"
    ],
    
    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/__tests__/**",
        "dist/**",
        "node_modules/**"
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Test timeouts
    testTimeout: 10000,
    hookTimeout: 10000,
    
    // Reporter configuration
    reporter: ["verbose"],
    
    // Watch mode configuration
    watch: false,
    
    // Concurrency settings
    maxConcurrency: 5
  },
  
  // Resolve configuration for imports
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@tests": resolve(__dirname, "./tests")
    }
  },
  
  // Define configuration for TypeScript
  esbuild: {
    target: "es2022"
  }
});