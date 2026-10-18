import { LoaderCircle } from 'lucide-react';
import { useLauncher } from '../app/useLauncher';
export function Loading() {
  const { booting } = useLauncher();

  return (
    booting && (
      <div className="loading">
        <LoaderCircle className="spin" size={20} /> Checking emulator and cloud connection…
      </div>
    )
  );
}
