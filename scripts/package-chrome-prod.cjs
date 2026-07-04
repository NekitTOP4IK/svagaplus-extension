const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const distDir = path.join(rootDir, 'dist_chrome');
const artifactsDir = path.join(rootDir, 'artifacts');
const { name, version } = require(path.join(rootDir, 'package.json'));

if (!fs.existsSync(distDir)) {
  throw new Error(`Missing build output: ${distDir}`);
}

fs.mkdirSync(artifactsDir, { recursive: true });

const archiveName = `${name}-chrome-v${version}.zip`;
const archivePath = path.join(artifactsDir, archiveName);

fs.rmSync(archivePath, { force: true });

execFileSync('zip', ['-rq', archivePath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
});

console.log(`Created ${path.relative(rootDir, archivePath)}`);
