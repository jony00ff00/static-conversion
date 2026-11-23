import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'fixtures');
export const GOLDEN_DIR = path.join(REPO_ROOT, 'golden');
export const DIFF_DIR = path.join(REPO_ROOT, '.golden-diff');

/** Max fraction of differing pixels before a golden screenshot fails (0.5%). */
export const PIXEL_TOLERANCE = 0.005;

/** Fixture directories are named NN-name, e.g. 01-static. */
export function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((d) => /^\d\d-/.test(d) && statSync(path.join(FIXTURES_DIR, d)).isDirectory())
    .sort();
}

export const fixturePath = (name: string) => path.join(FIXTURES_DIR, name);
export const goldenPath = (name: string, file: string) => path.join(GOLDEN_DIR, name, file);
