import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "dist-desktop/**", "next-env.d.ts", ".repair-backups/**", "preview-server.cjs", ".agents/**"]),
]);
