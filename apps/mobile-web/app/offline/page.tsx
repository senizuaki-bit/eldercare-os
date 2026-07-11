import type { Metadata } from 'next';

import { OfflineContent } from '../../components/offline-content';

export const metadata: Metadata = {
  title: '当前离线'
};

export default function OfflinePage() {
  return <OfflineContent />;
}
