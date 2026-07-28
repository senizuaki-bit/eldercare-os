import type { Metadata } from 'next';

import { EmergencyCommandCenterPage } from '../../../../components/emergency-command-center-page';

export const metadata: Metadata = {
  title: '紧急响应指挥 | 照护运营台'
};

export default async function EmergencyCommandCenterRoute({
  params
}: Readonly<{ params: Promise<{ emergencyId: string }> }>) {
  const { emergencyId } = await params;
  return <EmergencyCommandCenterPage emergencyId={emergencyId} />;
}
