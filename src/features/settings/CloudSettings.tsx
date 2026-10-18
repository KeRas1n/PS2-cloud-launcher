import { Cloud } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { SettingsPathField } from './SettingsPathField';
export function CloudSettings() {
  const { providerName, draft, disabled, update, snapshot } = useLauncher();

  return (
    <section
      className="panel settings-panel"
      role="tabpanel"
      id="settings-panel-Cloud"
      aria-labelledby="settings-tab-Cloud"
      tabIndex={0}
    >
      <div className="settings-section-title">
        <Cloud size={20} />
        <div>
          <h3>{providerName}</h3>
          <p>Connect your account from Cloud. The launcher includes the cloud component.</p>
        </div>
      </div>
      <label className="toggle-field">
        <span>Automatically sync saves before and after playing</span>
        <input
          type="checkbox"
          checked={draft?.autoSyncSaves ?? true}
          disabled={disabled}
          onChange={(e) => update('autoSyncSaves', e.target.checked)}
        />
      </label>
      <SettingsPathField
        label={`${providerName} root folder`}
        setting={'cloudRoot'}
        help={`Folder for games and saves inside your ${providerName}.`}
      />
      <details>
        <summary>Advanced cloud settings</summary>
        <SettingsPathField
          label={'Rclone executable'}
          setting={'rclonePath'}
          help={'Use rclone for PATH detection, or choose its absolute executable path.'}
          kind={'executable'}
        />
        <SettingsPathField
          label={'Rclone configuration file'}
          setting={'rcloneConfig'}
          help={
            'Use a dedicated configuration, or enter the path to your existing rclone.conf. Tokens are never shown here.'
          }
        />
        <div className="field-grid">
          <SettingsPathField
            label={`${providerName} remote name`}
            setting={'remote'}
            help={`An existing ${providerName} remote or a new name for the connection.`}
          />
        </div>
        {!!snapshot?.cloud.remotes.length && (
          <div className="remote-list">Available remotes: {snapshot.cloud.remotes.join(', ')}</div>
        )}
      </details>
    </section>
  );
}
