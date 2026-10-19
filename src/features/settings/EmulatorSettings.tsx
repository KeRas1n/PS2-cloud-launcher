import { MonitorDown } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { SettingsPathField } from './SettingsPathField';
export function EmulatorSettings() {
  const { draft, disabled, update } = useLauncher();

  return (
    <section
      className="panel settings-panel"
      role="tabpanel"
      id="settings-panel-Emulator"
      aria-labelledby="settings-tab-Emulator"
      tabIndex={0}
    >
      <div className="settings-section-title">
        <MonitorDown size={20} />
        <div>
          <h3>PCSX2 & local data</h3>
          <p>Paths must be absolute. PCSX2 stores its profile in the PCSX2 subfolder of this data parent.</p>
        </div>
      </div>
      <SettingsPathField
        label={'PCSX2 executable'}
        setting={'pcsx2Path'}
        help={
          'Leave empty to use the managed installation. Select .exe on Windows or AppImage / executable on Linux.'
        }
        kind={'executable'}
      />
      <SettingsPathField
        label={'Emulator installation directory'}
        setting={'emulatorRoot'}
        help={'New managed versions install here. Changing this path does not move existing data.'}
        kind={'directory'}
      />
      <SettingsPathField
        label={'PCSX2 data parent directory'}
        setting={'dataDirectory'}
        help={
          'PCSX2 creates a PCSX2 subfolder here. Existing settings and save folders are preserved; folders below remain independent.'
        }
        kind={'directory'}
      />
      <div className="field-grid">
        <SettingsPathField
          label={'BIOS directory'}
          setting={'biosDirectory'}
          help={
            'BIOS lookup folder. Import BIOS always copies into the launcher’s own emulator/data/bios folder.'
          }
          kind={'directory'}
        />
        <SettingsPathField
          label={'Memory card directory'}
          setting={'memcardsDirectory'}
          help={'PCSX2 memory cards and cloud Memcards source.'}
          kind={'directory'}
        />
        <SettingsPathField
          label={'Save state directory'}
          setting={'saveStatesDirectory'}
          help={'PCSX2 save states and cloud SaveStates source.'}
          kind={'directory'}
        />
      </div>
      <label className="toggle-field">
        <div>
          <strong>Launch games in fullscreen</strong>
          <small>Open PCSX2 directly into the game.</small>
        </div>
        <input
          type="checkbox"
          checked={draft?.fullscreen ?? true}
          disabled={disabled}
          onChange={(e) => update('fullscreen', e.target.checked)}
        />
      </label>
    </section>
  );
}
