// Types for start-production.cjs, so its tests are type-checked.
declare const launcher: {
  parseEnvFile(text: string): Record<string, string>;
  applySettings(values: Record<string, string>, env: Record<string, string | undefined>): void;
  settingsFile(env: Record<string, string | undefined>, releaseDir: string): string;
};

export = launcher;
