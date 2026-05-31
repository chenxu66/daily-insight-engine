import path from "path";
import { config } from "../config.js";

function dateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function artifactDir(date?: Date): string {
  return path.join(config.outputDir, dateString(date));
}

export function artifactPath(filename: string, date?: Date): string {
  return path.join(artifactDir(date), filename);
}
