import type { Metadata } from 'next';

import { WorkOrderListPage } from '../../../components/work-order-list-page';

export const metadata: Metadata = {
  title: '工单管理 | 照护运营台'
};

export default function WorkOrdersRoute() {
  return <WorkOrderListPage />;
}
