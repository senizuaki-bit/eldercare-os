import type { Metadata } from 'next';

import { RoomDirectoryPage } from '../../../../components/room-directory-page';

export const metadata: Metadata = {
  title: '房间床位 · 照护运营台'
};

export default function RoomsPage() {
  return <RoomDirectoryPage />;
}
