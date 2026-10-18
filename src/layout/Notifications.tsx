import { CheckCircle2, X } from 'lucide-react';
import { useLauncher } from '../app/useLauncher';
export function Notifications() {
  const { notice, setNotice } = useLauncher();

  return (
    notice && (
      <div className="toast" role="status">
        <CheckCircle2 size={18} />
        {notice}
        <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
          <X size={16} />
        </button>
      </div>
    )
  );
}
