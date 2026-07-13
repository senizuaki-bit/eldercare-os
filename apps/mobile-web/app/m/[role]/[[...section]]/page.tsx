import { notFound } from 'next/navigation';

import { AuthenticatedPortal } from '../../../../components/authenticated-portal';
import { isRole, isRoleSection } from '../../../../components/types';

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

  const requestedSection = section ?? ['home'];
  const sectionName = requestedSection[0];

  if (
    requestedSection.length !== 1 ||
    sectionName === undefined ||
    !isRoleSection(role, sectionName)
  ) {
    notFound();
  }

  return <AuthenticatedPortal initialTab={sectionName} requestedRole={role} />;
}
