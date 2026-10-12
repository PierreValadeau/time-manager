// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// WCAG 2.1 AA contrast of the color pairs actually used, read from the index.css tokens

const css = readFileSync(new URL('../../../src/index.css', import.meta.url), 'utf8');

// Resolves a token down to its hex value, following var(--…) aliases
function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Token --${name} not found`);
  const value = match[1].trim();
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return token(alias[1]);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a hex color: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT = 4.5; // normal text (1.4.3)
const UI = 3; // component outlines and focus indicator (1.4.11)

// [foreground, background, threshold, usage]
const PAIRS: [string, string, number, string][] = [
  ['color-text', 'color-bg', TEXT, 'body text'],
  ['color-text', 'color-surface', TEXT, 'text in a card, field or toast'],
  ['color-accent', 'color-bg', TEXT, 'links, primary and ghost buttons'],
  ['color-accent', 'color-surface', TEXT, 'links and buttons in a card, active nav links'],
  ['color-accent-400', 'color-bg', TEXT, 'hovered link'],
  ['color-neutral-300', 'color-surface', TEXT, 'sidebar links, icon button'],
  ['color-neutral-400', 'color-bg', TEXT, 'field labels, muted text'],
  ['color-neutral-400', 'color-surface', TEXT, 'table headers, field hints, mobile tabs'],
  ['color-neutral-500', 'color-bg', TEXT, 'page header date'],
  ['color-neutral-500', 'color-surface', TEXT, 'info message in a card or dialog'],
  ['color-error', 'color-bg', TEXT, 'field error message'],
  ['color-error', 'color-surface', TEXT, 'error message in a card'],
  ['color-accent-300', 'color-surface', TEXT, 'success message in a card'],
  ['color-accent-100', 'color-accent-800', TEXT, 'accent tag, avatar'],
  ['color-neutral-200', 'color-neutral-800', TEXT, 'neutral tag'],
  ['color-accent-300', 'color-bg', TEXT, 'outline tag'],
  ['color-border-input', 'color-bg', UI, 'field outline, select (bg background)'],
  ['color-border-input', 'color-surface', UI, 'field outline in a card'],
  ['color-error', 'color-surface', UI, 'invalid field outline'],
  ['color-accent', 'color-bg', UI, 'focus ring'],
  ['color-accent', 'color-surface', UI, 'focus ring in a card'],
];

describe('AA contrast', () => {
  it.each(PAIRS)('%s on %s ≥ %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
});
