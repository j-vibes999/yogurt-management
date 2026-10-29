import path from "node:path";

/** Mutable runtime data is separate from the immutable application directory. */
export function runtimeDataDirectory(rootDirectory = process.cwd(), configuredRoot = process.env.YOGURT_DATA_ROOT): string {
  if (configuredRoot === undefined) return path.resolve(rootDirectory, ".yogurt");
  if (!path.isAbsolute(configuredRoot)) throw new Error("YOGURT_DATA_ROOT must be an absolute path");
  return configuredRoot;
}
