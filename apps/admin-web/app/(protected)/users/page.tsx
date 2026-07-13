import type { Metadata } from 'next';

import { AccessManagementPage } from '../../../components/access-management-page';

export const metadata: Metadata = {
  title: '用户与访问范围 · 照护运营台'
};

export default function UsersPage() {
  return <AccessManagementPage kind="users" />;
}
