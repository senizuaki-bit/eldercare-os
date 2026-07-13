import type { Metadata } from 'next';

import { LoginForm } from '../../../components/login-form';

export const metadata: Metadata = {
  title: '登录 · 照护运营台'
};

interface LoginPageProps {
  searchParams: Promise<{
    next?: string;
    reason?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, reason } = await searchParams;

  return <LoginForm nextPath={next} reason={reason} />;
}
