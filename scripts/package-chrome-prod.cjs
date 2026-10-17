const fs = require('fs');
const path = require('path');
// archiver 8 сменил API: вместо фабрики archiver('zip', opts) — именованные классы.
const { ZipArchive } = require('archiver');

// Системный `zip` есть не везде — на Windows его нет вовсе, поэтому упаковка
// раньше падала там всегда. `tar` кроссплатформенной заменой не является:
// bsdtar на Windows zip умеет, GNU tar на Linux — нет.
const rootDir = path.resolve(__dirname, '..');
const { name, version } = require(path.join(rootDir, 'package.json'));
const { outDirOf, assertProdChannel } = require('./build-channel.cjs');
const { assertKeyMatchesId, withManifestKey } = require('./chrome-keys.cjs');

const distDir = path.join(rootDir, outDirOf({ prod: true }));
const artifactsDir = path.join(rootDir, 'artifacts');

if (!fs.existsSync(distDir)) {
  throw new Error(`Missing build output: ${distDir}`);
}

// В артефакт для Chrome Web Store не должна попасть сборка со staging-бэкендом.
assertProdChannel(distDir);

fs.mkdirSync(artifactsDir, { recursive: true });

const storeArchivePath = path.join(artifactsDir, `${name}-chrome-v${version}.zip`);
// Для установки из релиза на GitHub: ключ стора даёт тот же ID, что у версии
// из Chrome Web Store, а значит и уже зарегистрированный redirect URI.
const unpackedArchivePath = path.join(artifactsDir, `${name}-chrome-unpacked-v${version}.zip`);

function createArchive(archivePath, manifestOverride) {
  fs.rmSync(archivePath, { force: true });
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('warning', reject);
    archive.on('error', reject);

    archive.pipe(output);
    if (manifestOverride) {
      // false — содержимое кладётся в корень архива, без префикса каталога.
      archive.directory(distDir, false, (entry) => (entry.name === 'manifest.json' ? false : entry));
      archive.append(manifestOverride, { name: 'manifest.json' });
    } else {
      archive.directory(distDir, false);
    }
    archive.finalize();
  });
}

async function main() {
  const storeKey = assertKeyMatchesId('store').key;
  const manifest = fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8');

  for (const [archivePath, manifestOverride] of [
    [storeArchivePath, null],
    [unpackedArchivePath, withManifestKey(manifest, storeKey)],
  ]) {
    const bytes = await createArchive(archivePath, manifestOverride);
    console.log(`Created ${path.relative(rootDir, archivePath)} (${bytes} bytes)`);
  }
}

main().catch((err) => {
  // Без явного кода выхода npm счёл бы упавшую упаковку успешной.
  console.error(`Failed to package Chrome archives: ${err.message}`);
  process.exitCode = 1;
});
