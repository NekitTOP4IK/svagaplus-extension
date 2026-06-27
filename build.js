const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Environment configs ───────────────────────────────────────────────────────
// Values are read from environment variables or a local .env file.
// See .env.example for the full list. Prod defaults are baked in (they're public);
// dev values must be provided via .env (never committed).

// Load .env if present (simple parser, no external dependencies)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const DEFAULTS = {
  BACKEND_URL_PROD:  'https://tributealerts.nekittop4ik.space',
  BOT_USERNAME_PROD: 'tributealertsbot',
};

const e = k => {
  const v = process.env[k] || DEFAULTS[k];
  if (!v) { console.error(`❌ Missing required variable: ${k}. Set it in .env or environment.`); process.exit(1); }
  return v;
};

const ENVS = {
  dev: () => { const u = e('BACKEND_URL_DEV').replace(/\/+$/, ''); return { backendUrl: u, backendHost: new URL(u).host, zip: false }; },
  prod: () => { const u = e('BACKEND_URL_PROD').replace(/\/+$/, ''); return { backendUrl: u, backendHost: new URL(u).host, zip: true }; },
  firefox_dev: () => { const u = e('BACKEND_URL_DEV').replace(/\/+$/, ''); return { backendUrl: u, backendHost: new URL(u).host, updateUrl: `${u}/api/extension/firefox-updates.json`, manifest: 'manifest.firefox.json', zip: false }; },
  firefox_prod: () => { const u = e('BACKEND_URL_PROD').replace(/\/+$/, ''); return { backendUrl: u, backendHost: new URL(u).host, updateUrl: `${u}/api/extension/firefox-updates.json`, manifest: 'manifest.firefox.json', zip: true }; },
};

// Extension files/folders (relative to project root) included in the build
const EXTENSION_ENTRIES = [
  'manifest.json',
  'src',
  'icons',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyPlaceholders(content, filePath, { backendUrl, backendHost, updateUrl }) {
  const replacements = {
    '__BACKEND_URL__': backendUrl,
    '__BACKEND_HOST__': backendHost,
    '__UPDATE_URL__': updateUrl || '',
  };
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (content.includes(placeholder)) {
      console.log(`  [placeholder] ${path.relative(__dirname, filePath)}: ${placeholder} → ${value}`);
      content = content.replaceAll(placeholder, value);
    }
  }
  return content;
}

function processFile(srcPath, destPath, cfg) {
  const ext = path.extname(srcPath);
  if (['.js', '.json', '.html', '.css', '.svg'].includes(ext)) {
    let content = fs.readFileSync(srcPath, 'utf-8');
    content = applyPlaceholders(content, srcPath, cfg);
    fs.writeFileSync(destPath, content, 'utf-8');
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

function copyDir(srcDir, destDir, cfg) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath, cfg);
    } else {
      processFile(srcPath, destPath, cfg);
    }
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function createZip(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}'"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(`zip -r "${zipPath}" .`, { cwd: srcDir, stdio: 'pipe' });
  }

  const size = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`  [zip] ${path.basename(zipPath)} (${size} KB)`);
}

// ─── Build ────────────────────────────────────────────────────────────────────

function build(env) {
  if (!ENVS[env]) {
    console.error(`❌ Unknown environment: ${env}. Available: ${Object.keys(ENVS).join(', ')}`);
    process.exit(1);
  }
  const cfg = ENVS[env]();

  const outDir = path.join(__dirname, `dist_${env}`);

  const manifestSrc = cfg.manifest || 'manifest.json';
  const isFirefox = !!cfg.manifest;

  console.log(`\n╔══ Building [${env}] ════════════════════════════════════╗`);
  console.log(`  Backend URL  : ${cfg.backendUrl}`);
  console.log(`  Browser      : ${isFirefox ? '🦊 Firefox' : '🟡 Chrome'}`);
  console.log(`  Manifest     : ${manifestSrc}`);
  console.log(`  ZIP          : ${cfg.zip ? '✅ YES' : '❌ NO'}`);
  console.log(`  Output       : ${outDir}`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  cleanDir(outDir);

  // Manifest — always written as manifest.json, source depends on environment
  const manifestDestPath = path.join(outDir, 'manifest.json');
  const manifestSrcPath = path.join(__dirname, manifestSrc);
  if (fs.existsSync(manifestSrcPath)) {
    fs.mkdirSync(path.dirname(manifestDestPath), { recursive: true });
    processFile(manifestSrcPath, manifestDestPath, cfg);
  } else {
    console.error(`❌ Manifest not found: ${manifestSrc}`);
    process.exit(1);
  }

  // Remaining files (manifest.json skipped — already processed above)
  for (const entry of EXTENSION_ENTRIES.filter(e => e !== 'manifest.json')) {
    const srcPath = path.join(__dirname, entry);
    const destPath = path.join(outDir, entry);

    if (!fs.existsSync(srcPath)) {
      console.warn(`  ⚠️  Not found: ${entry} — skipping`);
      continue;
    }

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath, cfg);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      processFile(srcPath, destPath, cfg);
    }
  }

  if (cfg.zip) {
    const zipPath = path.join(__dirname, `dist_${env}.zip`);
    createZip(outDir, zipPath);
    const storeHint = isFirefox ? 'addons.mozilla.org' : 'Chrome Web Store';
    console.log(`\n✅ [${env}] done! ZIP for ${storeHint} → dist_${env}.zip`);
  } else {
    const loadHint = isFirefox
      ? 'about:debugging → Load Temporary Add-on → select manifest.json'
      : 'chrome://extensions → Load unpacked';
    console.log(`\n✅ [${env}] done! Load dist_${env}/ via ${loadHint}`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const target = process.argv[2];
if (target) {
  build(target);
} else {
  for (const env of Object.keys(ENVS)) {
    build(env);
  }
}
