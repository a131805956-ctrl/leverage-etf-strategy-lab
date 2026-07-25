import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('deployment asset paths', () => {
  it('derives the favicon URL from the active Vite base path', () => {
    const index = readFileSync(
      new URL('../index.html', import.meta.url),
      'utf8',
    );

    expect(index).toContain('href="%BASE_URL%favicon.svg"');
    expect(index).not.toContain('href="/leverage-etf/favicon.svg"');
  });
});
