import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button, ErrorState, StatusBadge } from './index.js';

describe('shared accessible primitives', () => {
  it('makes a loading button unavailable and announces progress', () => {
    const html = renderToStaticMarkup(<Button loading>保存</Button>);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('处理中');
  });

  it('uses text and a symbol in addition to status color', () => {
    const html = renderToStaticMarkup(<StatusBadge tone="danger">需立即处理</StatusBadge>);

    expect(html).toContain('role="status"');
    expect(html).toContain('需立即处理');
    expect(html).toContain('状态：');
  });

  it('announces error states as alerts', () => {
    const html = renderToStaticMarkup(
      <ErrorState description="请稍后重试" title="无法读取数据" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('无法读取数据');
  });
});
