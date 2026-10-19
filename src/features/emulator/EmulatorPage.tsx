import { ArrowDownToLine, ArrowRight, ExternalLink, Plus, ShieldCheck } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeading } from '../../components/PageHeading';
import { api } from '../../lib/launcher-api';
export function EmulatorPage() {
  const { emulator, disabled, act, setNotice, goToSettings } = useLauncher();

  return (
    <>
      <PageHeading title="Emulator" />
      <section className="panel emulator-panel">
        <div className="emulator-detail">
          <div className="row">
            <h2>PCSX2</h2>
            <Badge good={!!emulator?.installed}>{emulator?.installed ? 'Installed' : 'Not installed'}</Badge>
          </div>
          <div className="emulator-version">
            {emulator?.version || 'Latest stable release from the official GitHub repository'}
          </div>
          {emulator?.path && <code>{emulator.path}</code>}
          {emulator?.profile?.directory && (
            <div className="profile-directory">
              Profile directory<code>{emulator.profile.directory}</code>
            </div>
          )}
          <div className="button-row">
            <Button
              disabled={disabled || emulator?.running}
              onClick={() =>
                void act(
                  emulator?.installed ? 'Updating PCSX2' : 'Installing PCSX2',
                  () => api!.installEmulator(),
                  'PCSX2 ready. Existing data preserved.',
                  false,
                )
              }
            >
              <ArrowDownToLine size={16} />
              {emulator?.installed ? 'Update PCSX2' : 'Install PCSX2'}
            </Button>
            <Button
              secondary
              disabled={disabled || !emulator?.installed || emulator?.running}
              onClick={() =>
                void act(
                  'Preparing emulator',
                  () => api!.prepareEmulator(),
                  'Emulator profile prepared. Import your own BIOS before playing.',
                  false,
                )
              }
            >
              <ShieldCheck size={16} /> Prepare emulator
            </Button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-symbol">
          <ShieldCheck />
        </div>
        <h3>BIOS</h3>
        <p>
          Import an uncompressed BIOS from your PlayStation 2. The launcher copies it into its own BIOS
          folder. MEGA backs it up and restores missing BIOS files after sign-in. Transfers appear in
          Downloads.
        </p>
        <Button
          secondary
          disabled={disabled || emulator?.running}
          onClick={() =>
            void act(
              'Importing BIOS',
              async () => {
                const count = await api!.importBios();
                if (count) setNotice('BIOS imported. The launcher selects it automatically.');
              },
              undefined,
              false,
            )
          }
        >
          <Plus size={16} /> Import BIOS
        </Button>
        {!!emulator?.profile?.bios.length && (
          <label className="field">
            <span>Selected BIOS</span>
            <select
              className="profile-select"
              value={emulator.profile.selectedBios ?? ''}
              disabled={disabled || emulator.running || !emulator.installed}
              onChange={(event) =>
                void act('Selecting BIOS', () => api!.selectBios(event.target.value), 'BIOS selected', false)
              }
            >
              {emulator.profile.bios.map((image) => (
                <option key={image.name} value={image.name}>
                  {image.name} · {image.region} {image.version}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="profile-readiness">
          <Badge good={!!emulator?.profile?.ready}>
            {emulator?.profile?.ready
              ? 'Ready to play'
              : emulator?.profile?.bios.length
                ? 'Prepared automatically on first launch'
                : 'Import a valid BIOS to play'}
          </Badge>
        </div>
      </section>
      <div className="page-links">
        <button className="text-button" onClick={() => goToSettings('Emulator')}>
          Configure paths <ArrowRight size={16} />
        </button>
        <button className="text-button muted" onClick={() => void api?.openLink('pcsx2')}>
          PCSX2 documentation <ExternalLink size={14} />
        </button>
      </div>
    </>
  );
}
