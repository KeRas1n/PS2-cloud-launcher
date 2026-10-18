// Real official downloads with the reported directory-rename failure enforced.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { PCSX2Service } = require('../dist-electron/electron/services/pcsx2');

(async () => {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'installer-real-'));
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const preserved = [
    path.join(store.value.biosDirectory, 'bios.test'),
    path.join(store.value.memcardsDirectory, 'card.ps2'),
    path.join(store.value.saveStatesDirectory, 'save.p2s'),
    path.join(store.value.dataDirectory, 'inis', 'PCSX2.ini'),
  ];
  for (const file of preserved) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'user data preservation fixture');
  }
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if ((await fs.stat(source)).isDirectory()) {
      throw Object.assign(new Error('EPERM: directory rename blocked by regression guard'), {
        code: 'EPERM',
      });
    }
    return originalRename(source, destination);
  };
  try {
    const service = new PCSX2Service(store, (event) => {
      if (event.percent === 100) console.log(event.message);
    });
    const installed = await service.install();
    const updated = await service.install();
    assert.equal(installed.managed, true);
    assert.equal(updated.managed, true);
    assert.notEqual(installed.path, updated.path);
    await fs.access(installed.path);
    await fs.access(updated.path);
    for (const file of preserved)
      assert.equal(await fs.readFile(file, 'utf8'), 'user data preservation fixture');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(store.value.emulatorRoot, 'installed.json'), 'utf8')).path,
      updated.path,
    );
    console.log(
      'Official PCSX2 install/update passed with directory renames blocked; BIOS, settings, cards and states preserved.',
    );
    console.log(`Artifacts: ${root}`);
  } finally {
    fs.rename = originalRename;
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
