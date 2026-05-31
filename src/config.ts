function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Please set ${name} before running the pipeline.`
    );
  }
  return value;
}

export const config = {
  get anthropicApiKey(): string {
    return requireEnv("ANTHROPIC_API_KEY");
  },
  outputDir: process.env["OUTPUT_DIR"] ?? "output",
  logLevel: (process.env["LOG_LEVEL"] ?? "info") as "debug" | "info" | "warn" | "error",
};
