import type { Metadata } from 'next';

import { ElderDirectoryPage } from '../../../components/elder-directory-page';

export const metadata: Metadata = {
  title: '老人档案 · 照护运营台'
};

export default function EldersPage() {
  return <ElderDirectoryPage />;
}
