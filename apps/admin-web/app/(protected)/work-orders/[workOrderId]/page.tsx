import type { Metadata } from 'next';

import { WorkOrderDetailPage } from '../../../../components/work-order-detail-page';

export const metadata: Metadata = {
  title: '工单详情 | 照护运营台'
};

export default async function WorkOrderDetailRoute({
  params
}: Readonly<{ params: Promise<{ workOrderId: string }> }>) {
  const { workOrderId } = await params;
  return <WorkOrderDetailPage workOrderId={workOrderId} />;
}
