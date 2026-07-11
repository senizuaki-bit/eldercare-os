import { notFound } from 'next/navigation';

import { MobileExperience } from '../../../../components/mobile-experience';
import { isRole } from '../../../../components/types';

interface MobileRolePageProps {
  params: Promise<{
    role: string;
    section?: string[];
  }>;
}

export default async function MobileRolePage({ params }: MobileRolePageProps) {
  const { role, section } = await params;

  if (!isRole(role)) {
    notFound();
  }

  return <MobileExperience initialRole={role} initialTab={section?.[0] ?? 'home'} />;
}
