import { notFound } from 'next/navigation';

import { AuthenticatedPortal } from '../../../../components/authenticated-portal';
import { isRole, isRoleSectionPath } from '../../../../components/types';

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
  if (!isRoleSectionPath(role, requestedSection)) {
    notFound();
  }

  return <AuthenticatedPortal initialPath={requestedSection} requestedRole={role} />;
}
