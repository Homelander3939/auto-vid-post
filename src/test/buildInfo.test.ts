import { describe, expect, it } from 'vitest';

import { formatBuildLabel } from '@/lib/buildInfo';

describe('formatBuildLabel', () => {
  it('shows PR number with the provided build name', () => {
    expect(formatBuildLabel('Fix TikTok upload confirmation', '42', '128')).toBe(
      'PR #128 · Fix TikTok upload confirmation · Build #42',
    );
  });

  it('falls back to dev when no build or PR metadata exists', () => {
    expect(formatBuildLabel('', '', '')).toBe('dev');
  });
});
