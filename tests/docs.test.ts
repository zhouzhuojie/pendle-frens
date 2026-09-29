/**
 * Documentation guardrails.
 *
 * A README whose banner or screenshots 404 is worse than one with no images, and
 * the breakage is invisible until a reader clicks. This walks every local image
 * and link in the markdown and asserts the target exists.
 *
 * The second test pins the shipped/unshipped split. `public/` is Vite's publicDir
 * and is copied into `dist/` verbatim, so anything parked there is shipped to
 * every user — source artwork, banners and screenshots belong under `docs/`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The docs a reader is expected to land on. */
const DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/DESIGN.md'];

/** `src="..."` for HTML images, `](...)` for markdown links. */
const LOCAL_REF = /(?:src="|\]\()([^")\s]+)/g;

function localReferences(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(LOCAL_REF)) {
    const target = match[1];
    if (!target) continue;
    // External URLs and in-page anchors are not our problem.
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    // Drop any #fragment so `docs/DESIGN.md#foo` checks the file itself.
    const path = target.split('#')[0];
    if (!path || !path.includes('.')) continue;
    found.push(path);
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('documentation', () => {
  it('has no broken local image or link targets', () => {
    const checked: string[] = [];

    for (const doc of DOCS) {
      const markdown = readFileSync(join(root, doc), 'utf8');
      for (const target of localReferences(markdown)) {
        // Every local reference in these files is written from the repo root.
        expect(existsSync(join(root, target)), `${doc} -> ${target}`).toBe(true);
        checked.push(target);
      }
    }

    // Guards against the pattern silently matching nothing and passing vacuously.
    expect(checked).toContain('docs/brand/banner.svg');
    expect(checked).toContain('docs/screenshots/discover.png');
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });

  it('ships only the images the extension actually needs', () => {
    // Anything matching this list had to be added on purpose. Source artwork,
    // the README banner and screenshots must never appear here.
    const shipped = walk(join(root, 'public'))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
      .filter((file) => /\.(jpe?g|png|gif|webp|svg)$/i.test(file))
      .sort();

    expect(shipped).toEqual([
      'public/brand/mark.svg',
      'public/icons/icon-128.png',
      'public/icons/icon-16.png',
      'public/icons/icon-32.png',
      'public/icons/icon-48.png',
    ]);
  });
});
