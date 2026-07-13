import type { Metadata } from 'next';

import { LoginExperience } from '../../components/login-experience';

export const metadata: Metadata = {
  title: '登录'
};

export default function LoginPage() {
  return <LoginExperience />;
}
