'use client';

import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';

import { apiFetch } from '../lib/api-client';
import { parseAuthSession } from '../lib/auth-contract';
import { safeNextPath } from '../lib/safe-navigation';

interface LoginValues {
  loginName: string;
  password: string;
}

interface LoginFormProps {
  nextPath?: string | null;
  reason?: string | null;
  onAuthenticated?: (nextPath: string) => void;
}

type LoginError = 'invalid' | 'rate-limited' | 'unavailable' | null;

const reasonMessages: Record<string, { type: 'info' | 'success' | 'warning'; message: string }> = {
  expired: {
    type: 'warning',
    message: '登录已失效。为保护机构数据，请重新登录。'
  },
  logout: {
    type: 'success',
    message: '您已安全退出。'
  },
  required: {
    type: 'info',
    message: '请先登录后继续访问管理端。'
  }
};

const errorMessages: Record<Exclude<LoginError, null>, string> = {
  invalid: '账号或密码不正确，请重新输入。',
  'rate-limited': '尝试次数过多，请稍后再试。',
  unavailable: '登录服务暂时不可用，请稍后重试。'
};

export function LoginForm({
  nextPath,
  reason,
  onAuthenticated = (path) => window.location.assign(path)
}: Readonly<LoginFormProps>) {
  const [form] = Form.useForm<LoginValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<LoginError>(null);
  const next = safeNextPath(nextPath);
  const reasonNotice = reason === null || reason === undefined ? undefined : reasonMessages[reason];

  const submit = async (values: LoginValues) => {
    setSubmitting(true);
    setLoginError(null);

    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginName: values.loginName.trim(),
          password: values.password
        })
      });

      if (response.status === 401) {
        setLoginError('invalid');
        form.setFieldValue('password', '');
        form.focusField('password');
        return;
      }

      if (response.status === 429) {
        setLoginError('rate-limited');
        return;
      }

      if (!response.ok) {
        setLoginError('unavailable');
        return;
      }

      const session = parseAuthSession(await response.json());
      onAuthenticated(session.portal === 'admin' ? next : '/forbidden');
    } catch {
      setLoginError('unavailable');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-frame" aria-labelledby="login-title">
        <div className="auth-brand-panel">
          <div className="auth-brand-lockup">
            <SafetyCertificateOutlined aria-hidden="true" />
            <span>照护<br />运营台</span>
          </div>
          <div className="auth-brand-copy">
            <p>机构管理端</p>
            <h1>让每一次访问<br />都有身份和范围</h1>
            <ul>
              <li><SafetyCertificateOutlined aria-hidden="true" />后端校验角色与院区范围</li>
              <li><LockOutlined aria-hidden="true" />安全会话不会写入本地存储</li>
            </ul>
          </div>
        </div>

        <div className="auth-form-panel">
          <div className="auth-heading">
            <p>欢迎回来</p>
            <h2 id="login-title">登录照护运营台</h2>
            <span>使用机构发放的本地演示账号。所有账号和数据均为虚构示例。</span>
          </div>

          {reasonNotice ? (
            <Alert className="auth-alert" showIcon type={reasonNotice.type} title={reasonNotice.message} />
          ) : null}
          {loginError ? (
            <Alert
              className="auth-alert"
              showIcon
              type="error"
              role="alert"
              title={errorMessages[loginError]}
            />
          ) : null}

          <Form<LoginValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => void submit(values)}
          >
            <Form.Item
              label="账号"
              name="loginName"
              rules={[
                { required: true, whitespace: true, message: '请输入账号' },
                { min: 3, max: 96, message: '账号长度应为 3–96 个字符' },
                {
                  pattern: /^[\p{L}\p{N}._-]+$/u,
                  message: '账号仅支持文字、数字、点、下划线和连字符'
                }
              ]}
            >
              <Input
                autoComplete="username"
                maxLength={96}
                prefix={<UserOutlined aria-hidden="true" />}
                placeholder="请输入机构账号"
              />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                autoComplete="current-password"
                maxLength={256}
                prefix={<LockOutlined aria-hidden="true" />}
                placeholder="请输入密码"
              />
            </Form.Item>
            <Button
              block
              className="auth-submit"
              htmlType="submit"
              loading={submitting}
              type="primary"
              aria-label={submitting ? '正在安全登录' : '登录'}
            >
              {submitting ? '正在安全登录' : '登录'}
            </Button>
          </Form>

          <p className="auth-privacy-note">
            登录事件会记录账号、时间和结果，不记录密码或敏感业务内容。
          </p>
        </div>
      </section>
    </main>
  );
}
