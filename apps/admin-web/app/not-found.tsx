import { SafeStatusPage } from '../components/safe-status-page';

export default function NotFoundPage() {
  return (
    <SafeStatusPage
      kind="not-found"
      title="页面不存在或不可访问"
      description="我们无法确认该页面是否存在，也不会透露其他机构或院区的资源信息。"
    />
  );
}
