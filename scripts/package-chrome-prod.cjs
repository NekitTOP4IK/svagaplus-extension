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

const distDir = path.join(rootDir, outDirOf({ prod: true }));
const artifactsDir = path.join(rootDir, 'artifacts');

if (!fs.existsSync(distDir)) {
  throw new Error(`Missing build output: ${distDir}`);
}

// В артефакт для Chrome Web Store не должна попасть сборка со staging-бэкендом.
assertProdChannel(distDir);

fs.mkdirSync(artifactsDir, { recursive: true });

const archivePath = path.join(artifactsDir, `${name}-chrome-v${version}.zip`);
fs.rmSync(archivePath, { force: true });

function createArchive() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('warning', reject);
    archive.on('error', reject);

    archive.pipe(output);
    // false — содержимое кладётся в корень архива, без префикса каталога.
    archive.directory(distDir, false);
    archive.finalize();
  });
}

createArchive()
  .then((bytes) => {
    console.log(`Created ${path.relative(rootDir, archivePath)} (${bytes} bytes)`);
  })
  .catch((err) => {
    // Без явного кода выхода npm счёл бы упавшую упаковку успешной.
    console.error(`Failed to create ${path.relative(rootDir, archivePath)}: ${err.message}`);
    process.exitCode = 1;
  });
