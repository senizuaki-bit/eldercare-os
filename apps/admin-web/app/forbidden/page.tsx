import type { Metadata } from 'next';

import { SafeStatusPage } from '../../components/safe-status-page';

export const metadata: Metadata = {
  title: '无权访问 · 照护运营台'
};

export default function ForbiddenPage() {
  return (
    <SafeStatusPage
      kind="forbidden"
      title="您无权访问此页面"
      description="当前角色或院区范围不包含这项功能。页面不会显示受限机构、用户或资源信息。"
    />
  );
}
