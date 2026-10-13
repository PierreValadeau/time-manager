import axe from 'axe-core';
import { expect } from 'vitest';

// axe audit of the render; contrast cannot be measured in jsdom (see styles/contrast.test.ts)
export async function expectNoA11yViolations(container: Element) {
  const { violations } = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(violations.map(({ id, help }) => `${id}: ${help}`)).toEqual([]);
}
