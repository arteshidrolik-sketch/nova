// Eval sonuçlarının son çalıştırmasını sakla (data/evals.json).
import { promises as fs } from "fs";
import path from "path";
import type { EvalRun } from "./run";

const FILE = path.join(process.cwd(), "data", "evals.json");

export async function loadEvals(): Promise<EvalRun | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}

export async function saveEvals(run: EvalRun): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(run, null, 2), "utf8");
  } catch {
    /* yoksay */
  }
}
