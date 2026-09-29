/**
 * Manifest guardrails.
 *
 * A Chrome extension's permission list is its attack surface, so it is asserted
 * here. Any PR that widens it has to change this test and explain why.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/manifest.json`, 'utf8')) as Record<string, unknown>;

describe('manifest', () => {
  it('is a manifest v3 extension targeting a Chrome with side panel support', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(114);
  });

  it('requests the minimum permission set', () => {
    expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
  });

  it('does not request a background scheduler', () => {
    // `alarms` was removed deliberately: nothing runs on a timer and the
    // panel refreshes on open. Nothing here should need a timer.
    expect(manifest.permissions).not.toContain('alarms');
    expect(manifest.permissions).not.toContain('notifications');
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('only reaches out to the two documented APIs', () => {
    expect(manifest.host_permissions).toEqual([
      'https://api-v2.pendle.finance/*',
      'https://api.fiscaldata.treasury.gov/*',
    ]);
  });

  it('ships as a side panel, not a transient popup', () => {
    expect(manifest.side_panel).toEqual({ default_path: 'panel/index.html' });
    expect(manifest.action).not.toHaveProperty('default_popup');
  });

  it('does not inject into pages or expose remote code', () => {
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest).not.toHaveProperty('externally_connectable');
    const csp = JSON.stringify(manifest.content_security_policy ?? {});
    expect(csp).not.toContain('unsafe-eval');
  });

  it('is branded consistently as Pendle Frens', () => {
    expect(manifest.name).toBe('Pendle Frens');
    const panelHtml = readFileSync(`${root}src/panel/index.html`, 'utf8');
    // The header logo is the generated brand mark, not a stand-in monogram.
    expect(panelHtml).toContain('class="logo" src="/brand/mark.svg"');
    expect(panelHtml).toContain('<span class="brand-name">Pendle Frens</span>');
    expect(existsSync(`${root}public/brand/mark.svg`)).toBe(true);
    // No stale branding anywhere the user can see.
    expect(JSON.stringify(manifest)).not.toMatch(/pFriend/);
    expect(panelHtml).not.toMatch(/pFriend/);
  });

  it('declares a module service worker and every icon it references', () => {
    const background = manifest.background as { service_worker: string; type: string };
    expect(background.type).toBe('module');
    expect(background.service_worker).toBe('background.js');

    const icons = manifest.icons as Record<string, string>;
    for (const path of Object.values(icons)) {
      expect(existsSync(`${root}public/${path}`)).toBe(true);
    }
  });

  it('points the side panel at a file that exists in the source tree', () => {
    const sidePanel = manifest.side_panel as { default_path: string };
    expect(existsSync(`${root}src/${sidePanel.default_path}`)).toBe(true);
  });
});
