import type { Metadata } from 'next';

import { StaffDirectoryPage } from '../../../components/staff-directory-page';

export const metadata: Metadata = {
  title: '员工目录 · 照护运营台'
};

export default function StaffPage() {
  return <StaffDirectoryPage />;
}
