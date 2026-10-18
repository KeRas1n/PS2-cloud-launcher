import { Cloud } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { api } from '../../lib/launcher-api';
import type { useCloudConnection } from './useCloudConnection';
export function MegaConnectionForm({ connection }: { connection: ReturnType<typeof useCloudConnection> }) {
  const { disabled, emulator, snapshot, connected, act } = useLauncher();
  const { megaEmail, setMegaEmail, megaPassword, setMegaPassword, megaCode, setMegaCode, connectMega } =
    connection;
  return (
    <form
      className="panel settings-panel mega-sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        void connectMega();
      }}
    >
      <h3>Connect MEGA</h3>
      <div className="field-grid">
        <label className="field">
          <span>MEGA email</span>
          <input
            type="email"
            className="profile-select"
            autoComplete="username"
            required
            value={megaEmail}
            disabled={disabled || emulator?.running}
            onChange={(e) => setMegaEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>MEGA password</span>
          <input
            type="password"
            className="profile-select"
            autoComplete="off"
            required
            value={megaPassword}
            disabled={disabled || emulator?.running}
            onChange={(e) => setMegaPassword(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>MEGA two-factor code (optional)</span>
        <input
          className="profile-select"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={megaCode}
          disabled={disabled || emulator?.running}
          onChange={(e) => setMegaCode(e.target.value)}
        />
        <small>
          For two-factor accounts, enter a fresh code. A new launcher session may require sign-in again.
        </small>
      </label>
      <p>Account access is stored locally. A new MEGA account must first be opened at mega.nz.</p>
      <Button
        disabled={
          disabled ||
          emulator?.running ||
          !megaEmail.trim() ||
          !megaPassword ||
          (!!megaCode && !/^\d{6}$/.test(megaCode))
        }
      >
        <Cloud size={16} /> Connect MEGA
      </Button>
      {!!snapshot?.cloud.remotes.includes(snapshot.settings.remote) && !connected && (
        <button
          type="button"
          className="text-button"
          disabled={disabled || emulator?.running}
          onClick={() => void act('Reconnecting MEGA', () => api!.connectCloud(), 'MEGA connected')}
        >
          Retry saved MEGA connection
        </button>
      )}
    </form>
  );
}
