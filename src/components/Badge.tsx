import type { ReactNode } from 'react';

export function Badge({ children, good = false }: { children: ReactNode; good?: boolean }) {
  return (
    <span className={`badge ${good ? 'good' : ''}`}>
      <span />
      {children}
    </span>
  );
}
