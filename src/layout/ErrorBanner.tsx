import { CloudOff, X } from 'lucide-react';
import { useLauncher } from '../app/useLauncher';
export function ErrorBanner() {
  const { error, setError } = useLauncher();

  return (
    error && (
      <div role="alert" className="message error">
        <CloudOff size={19} />
        <span>{error}</span>
        <button aria-label="Dismiss error" onClick={() => setError('')}>
          <X size={17} />
        </button>
      </div>
    )
  );
}
