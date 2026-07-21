import type { Metadata } from 'next';

import { ShiftWeekPage } from '../../../components/shift-week-page';

export const metadata: Metadata = {
  title: '周排班 · 照护运营台'
};

export default function ShiftsPage() {
  return <ShiftWeekPage />;
}
