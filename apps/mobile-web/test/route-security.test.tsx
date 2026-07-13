import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NotFoundPage from '../app/not-found';
import MobileRolePage from '../app/m/[role]/[[...section]]/page';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
}));

vi.mock('next/navigation', () => ({
  notFound,
  useRouter: () => ({ replace: vi.fn() })
}));

describe('mobile route safety', () => {
  it.each([
    { role: 'staff', section: ['home'] },
    { role: 'elder', section: ['admin'] },
    { role: 'family', section: ['events', 'private'] }
  ])('returns the same data-free not-found path for $role/$section', async ({ role, section }) => {
    await expect(MobileRolePage({ params: Promise.resolve({ role, section }) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
  });

  it('renders a generic not-found screen without session or care data', () => {
    render(<NotFoundPage />);

    expect(screen.getByRole('heading', { name: '未找到此页面' })).toBeInTheDocument();
    expect(screen.getByText(/不会显示任何账号、角色或照护数据/)).toBeInTheDocument();
    expect(screen.queryByText(/林安宁|青松院区|今日照护摘要/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回安全入口' })).toHaveAttribute('href', '/');
  });
});
