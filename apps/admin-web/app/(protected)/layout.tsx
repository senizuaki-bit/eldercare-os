import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '../../components/admin-shell';
import { SafeStatusPage } from '../../components/safe-status-page';
import { getServerSession } from '../../lib/server-session';

export default async function ProtectedLayout({ children }: Readonly<{ children: ReactNode }>) {
  const result = await getServerSession();

  if (result.status === 'unauthenticated') {
    redirect('/login?reason=required');
  }

  if (result.status === 'unavailable') {
    return (
      <SafeStatusPage
        kind="unavailable"
        title="暂时无法验证登录状态"
        description="为避免在身份不明确时展示机构数据，页面已安全停止加载。请稍后重试。"
      />
    );
  }

  if (result.session.portal !== 'admin') {
    redirect('/forbidden');
  }

  return <AdminShell session={result.session}>{children}</AdminShell>;
}
