import type { Metadata } from 'next';

import { NeedReviewQueuePage } from '../../../components/need-review-queue-page';

export const metadata: Metadata = {
  title: '需求复核队列 | 照护运营台'
};

export default function NeedsRoute() {
  return <NeedReviewQueuePage />;
}
