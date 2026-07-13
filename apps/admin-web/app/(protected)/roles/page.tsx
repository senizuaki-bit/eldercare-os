import type { Metadata } from 'next';

import { AccessManagementPage } from '../../../components/access-management-page';

export const metadata: Metadata = {
  title: '角色与权限 · 照护运营台'
};

export default function RolesPage() {
  return <AccessManagementPage kind="roles" />;
}
