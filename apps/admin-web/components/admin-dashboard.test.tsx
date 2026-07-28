import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppProviders } from '../app/providers';
import { authSessionFixture } from '../test/fixtures';
import { AdminShell } from './admin-shell';
import { AdminDashboard } from './admin-dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => '/'
}));

function renderDashboard() {
  return render(
    <AppProviders>
      <AdminShell session={authSessionFixture}>
        <AdminDashboard />
      </AdminShell>
    </AppProviders>
  );
}

afterEach(() => cleanup());

describe('AdminDashboard', () => {
  it('renders the risk-first fixture dashboard and clearly labels demo data', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: '风险与待办' })).toBeInTheDocument();
    expect(screen.getAllByText('本地演示数据').length).toBeGreaterThan(0);
    expect(screen.getByText('未确认紧急事件')).toBeInTheDocument();
    expect(screen.getByText('待人工复核')).toBeInTheDocument();
    expect(screen.getByText('1–4 / 4 项演示队列')).toBeInTheDocument();
    expect(screen.getByText(/身份、会话和访问范围已由后端校验/)).toBeInTheDocument();
  });

  it('links the dashboard to meaningful M02 filtered directory views', () => {
    renderDashboard();

    expect(screen.getByRole('link', { name: /在院老人/ })).toHaveAttribute('href', '/elders?status=ACTIVE');
    expect(screen.getByRole('link', { name: /可用床位/ })).toHaveAttribute(
      'href',
      '/facility/rooms?status=ACTIVE&occupancy=AVAILABLE'
    );
    expect(screen.getByRole('link', { name: /在职员工/ })).toHaveAttribute('href', '/staff?status=ACTIVE');
    expect(screen.getByRole('link', { name: /待开始班次/ })).toHaveAttribute(
      'href',
      '/shifts?status=SCHEDULED&view=week'
    );
  });

  it('supports an accessible collapsible navigation rail', () => {
    renderDashboard();

    const collapseButton = screen.getByRole('button', { name: '折叠侧栏' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(collapseButton);

    const expandButton = screen.getByRole('button', { name: '展开侧栏' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: '工单管理' })).toHaveAttribute('href', '/work-orders');
  });

  it('filters queue fixtures through global search', () => {
    renderDashboard();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页面' }), {
      target: { value: 'A-12' }
    });

    expect(screen.getByText('生命体征监测仪 #A-12')).toBeInTheDocument();
    expect(screen.queryByText('房间 B204 · 呼叫异常')).not.toBeInTheDocument();
  });

  it('turns queue actions into a focused queue view', () => {
    renderDashboard();

    const emergencyRow = screen.getByText('房间 B204 · 呼叫异常').closest('tr');
    expect(emergencyRow).not.toBeNull();

    fireEvent.click(within(emergencyRow as HTMLTableRowElement).getByRole('button', { name: '查看队列' }));

    expect(screen.getByText('房间 B204 · 呼叫异常')).toBeInTheDocument();
    expect(screen.queryByText('夜间照护记录异常提醒')).not.toBeInTheDocument();
  });

  it('sorts fixture queues and exposes compact pagination controls', () => {
    const { container } = renderDashboard();

    fireEvent.click(screen.getAllByText('队列概览')[0] as HTMLElement);

    const rows = container.querySelectorAll<HTMLTableRowElement>('.ant-table-tbody tr.ant-table-row');
    expect(within(rows[0] as HTMLTableRowElement).getByText('待人工复核')).toBeInTheDocument();
    expect(within(rows[1] as HTMLTableRowElement).getByText('超时工单')).toBeInTheDocument();
    expect(within(rows[2] as HTMLTableRowElement).getByText('未确认紧急事件')).toBeInTheDocument();
    expect(within(rows[3] as HTMLTableRowElement).getByText('关键设备离线')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '每页显示队列数' }));
    expect(screen.getByRole('option', { name: '2 条/页' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '4 条/页' })).toBeInTheDocument();

  });

  it('allows optional table columns to be hidden', () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: '设置表格可见列' }));
    const latestColumnToggle = screen.getByRole('checkbox', { name: '最新项目' });
    expect(latestColumnToggle).toBeChecked();

    fireEvent.click(latestColumnToggle);

    expect(screen.queryByRole('columnheader', { name: /最新项目/ })).not.toBeInTheDocument();
    expect(screen.queryByText('房间 B204 · 呼叫异常')).not.toBeInTheDocument();
  });

  it('keeps the table mounted and uses its loading indicator', async () => {
    const { container } = renderDashboard();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '演示页面状态' }));
    const loadingOptions = screen.getAllByText('加载中');
    fireEvent.click(loadingOptions[loadingOptions.length - 1] as HTMLElement);

    expect(container.querySelector('table')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.ant-spin-spinning')).toBeInTheDocument();
      expect(screen.getByText('正在加载演示队列')).toBeInTheDocument();
    });
  });
});
