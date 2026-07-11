import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DisconnectOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'default' | 'elder';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    loading = false,
    loadingLabel = '处理中',
    size = 'default',
    type = 'button',
    variant = 'primary',
    ...rest
  },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      aria-busy={loading || undefined}
      className={classes(
        'ec-button',
        `ec-button--${variant}`,
        size === 'elder' && 'ec-button--elder',
        className,
      )}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ec-button__spinner" /> : null}
      {loading ? <span className="ec-sr-only">{loadingLabel}：</span> : null}
      <span>{children}</span>
    </button>
  );
});

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { actions, children, className, description, heading, ...rest },
  ref,
) {
  const generatedHeadingId = useId();
  const labelledBy = rest['aria-labelledby'] ??
    (heading === undefined ? undefined : generatedHeadingId);

  return (
    <section
      {...rest}
      ref={ref}
      aria-labelledby={labelledBy}
      className={classes('ec-card', className)}
    >
      {heading === undefined && description === undefined && actions === undefined ? null : (
        <header className="ec-card__header">
          <div>
            {heading === undefined ? null : (
              <h2 className="ec-card__heading" id={generatedHeadingId}>
                {heading}
              </h2>
            )}
            {description === undefined ? null : (
              <div className="ec-card__description">{description}</div>
            )}
          </div>
          {actions === undefined ? null : <div className="ec-card__actions">{actions}</div>}
        </header>
      )}
      <div className="ec-card__body">{children}</div>
    </section>
  );
});

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'offline';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: StatusTone;
}

const STATUS_ICONS = {
  success: CheckCircleOutlined,
  warning: ExclamationCircleOutlined,
  danger: CloseCircleOutlined,
  info: InfoCircleOutlined,
  neutral: MinusCircleOutlined,
  offline: DisconnectOutlined,
};

export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge({ children, className, tone = 'neutral', ...rest }, ref) {
    const StatusIcon = STATUS_ICONS[tone];

    return (
      <span
        {...rest}
        ref={ref}
        className={classes('ec-status-badge', `ec-status-badge--${tone}`, className)}
        role="status"
      >
        <StatusIcon aria-hidden="true" className="ec-status-badge__symbol" />
        <span className="ec-sr-only">状态：</span>
        <span>{children}</span>
      </span>
    );
  },
);

export type PageStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'forbidden'
  | 'stale';

export interface PageStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly kind: PageStateKind;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}

const PAGE_STATE_ICONS = {
  loading: LoadingOutlined,
  empty: InboxOutlined,
  error: ExclamationCircleOutlined,
  offline: DisconnectOutlined,
  forbidden: StopOutlined,
  stale: ClockCircleOutlined,
};

const ALERT_STATES = new Set<PageStateKind>(['error', 'offline', 'forbidden']);

export const PageState = forwardRef<HTMLDivElement, PageStateProps>(function PageState(
  { action, className, description, kind, title, ...rest },
  ref,
) {
  const StateIcon = PAGE_STATE_ICONS[kind];

  return (
    <div
      {...rest}
      ref={ref}
      aria-live={kind === 'loading' ? 'polite' : undefined}
      className={classes('ec-page-state', `ec-page-state--${kind}`, className)}
      role={ALERT_STATES.has(kind) ? 'alert' : 'status'}
    >
      <StateIcon
        aria-hidden="true"
        className="ec-page-state__symbol"
        spin={kind === 'loading'}
      />
      <h2 className="ec-page-state__title">{title}</h2>
      {description === undefined ? null : (
        <div className="ec-page-state__description">{description}</div>
      )}
      {action === undefined ? null : <div className="ec-page-state__action">{action}</div>}
    </div>
  );
});

type NamedPageStateProps = Omit<PageStateProps, 'kind' | 'title'> & {
  readonly title?: ReactNode;
};

export function LoadingState({ title = '正在加载', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="loading" title={title} />;
}

export function EmptyState({ title = '暂无内容', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="empty" title={title} />;
}

export function ErrorState({ title = '加载失败', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="error" title={title} />;
}

export function OfflineState({ title = '当前处于离线状态', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="offline" title={title} />;
}

export function ForbiddenState({ title = '无权访问', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="forbidden" title={title} />;
}

export function StaleState({ title = '信息已过期', ...props }: NamedPageStateProps) {
  return <PageState {...props} kind="stale" title={title} />;
}
