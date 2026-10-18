// Configuration-only integration with an official PCSX2 executable. No BIOS/game needed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { PCSX2Service } = require('../dist-electron/electron/services/pcsx2');
const { run } = require('../dist-electron/electron/services/process');
const { readIni } = require('../dist-electron/electron/services/ini');

(async () => {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-profile.cjs <official-pcsx2-executable>');
  const binary = path.resolve(process.argv[2]);
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'real-profile-'));
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  await store.save({ ...store.value, pcsx2Path: binary });
  const service = new PCSX2Service(store, () => {});
  await service.prepare();
  const file = path.join(store.value.dataDirectory, 'PCSX2', 'inis', 'PCSX2.ini');
  let ini = await fs.readFile(file, 'utf8');
  assert.equal(readIni(ini, 'UI', 'SetupWizardIncomplete'), 'false');
  assert.equal(readIni(ini, 'UI', 'ConfirmShutdown'), 'false');
  assert.equal(readIni(ini, 'AutoUpdater', 'CheckAtStartup'), 'false');
  assert.equal(readIni(ini, 'Folders', 'MemoryCards'), store.value.memcardsDirectory.replace(/\\/g, '/'));
  assert.ok(readIni(ini, 'Pad1', 'Cross'));
  // Re-read through PCSX2 itself: a valid SettingsVersion must not trigger reset/setup.
  await run(binary, ['-testconfig', '-datapath', store.value.dataDirectory], {
    timeout: 20000,
    cwd: path.dirname(binary),
  });
  ini = await fs.readFile(file, 'utf8');
  assert.equal(readIni(ini, 'UI', 'SetupWizardIncomplete'), 'false');
  const game = path.join(root, 'not-a-playable-disc.iso');
  await fs.writeFile(game, 'not a playable game');
  await assert.rejects(service.launch(game), /No valid PS2 BIOS/);
  assert.equal(service.running, false);
  console.log(
    'Official PCSX2 profile initialization/reload passed: actual data path, no setup wizard, defaults populated, missing BIOS blocked before gameplay.',
  );
  console.log(`Artifacts: ${root}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
