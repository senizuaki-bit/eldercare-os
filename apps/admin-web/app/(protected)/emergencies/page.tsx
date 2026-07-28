import type { Metadata } from 'next';

import { EmergencyListPage } from '../../../components/emergency-list-page';

export const metadata: Metadata = {
  title: '紧急事件 | 照护运营台'
};

export default function EmergenciesRoute() {
  return <EmergencyListPage />;
}
