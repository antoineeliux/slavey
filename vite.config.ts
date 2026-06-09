import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const criticalCoverageModules = [
  "src/lib/employeeActivityContractView.ts",
  "src/components/employee-scene/activityPresentation.ts",
  "src/components/employee-floor/employeeFloorViewModel.ts",
  "src/store/slices/employeesSlice.ts",
  "src/store/slices/terminalSlice.ts",
];

const criticalCoverageThresholds = {
  "src/lib/employeeActivityContractView.ts": {
    statements: 70,
    branches: 60,
    functions: 80,
    lines: 70,
  },
  "src/components/employee-scene/activityPresentation.ts": {
    statements: 75,
    branches: 75,
    functions: 95,
    lines: 75,
  },
  "src/components/employee-floor/employeeFloorViewModel.ts": {
    statements: 60,
    branches: 55,
    functions: 90,
    lines: 60,
  },
  "src/store/slices/employeesSlice.ts": {
    statements: 70,
    branches: 60,
    functions: 80,
    lines: 70,
  },
  "src/store/slices/terminalSlice.ts": {
    statements: 70,
    branches: 65,
    functions: 75,
    lines: 70,
  },
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    css: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      include: criticalCoverageModules,
      exclude: [
        ...configDefaults.coverage.exclude,
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/lib/e2eTauriMock.ts",
        "e2e/**",
        "dist/**",
        "coverage/**",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/frontend",
      thresholds: criticalCoverageThresholds,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-codemirror",
              test: /node_modules[\\/](@codemirror|@lezer|codemirror|crelt|style-mod|w3c-keyname)[\\/]/,
              priority: 3,
            },
            {
              name: "vendor-xterm",
              test: /node_modules[\\/]@xterm[\\/]/,
              priority: 3,
            },
          ],
        },
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
