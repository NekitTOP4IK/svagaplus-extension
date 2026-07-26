'use strict';

// Единственный источник правды о канале сборки.
//
// Проблема, которую этот модуль закрывает: без `--env prod` webpack вшивает
// staging-бэкенд, а dev и prod писали в одни и те же dist_chrome / dist_firefox.
// Скрипты подписи и упаковки брали содержимое папки не глядя, какой внутрь зашит
// URL. Прогнал тесты, запустил подпись — и пользователи Firefox автообновились
// на staging.
//
// Теперь у каждого канала своя папка, в неё пишется маркер, а публикующие
// скрипты обязаны маркер прочитать и проверить.

const fs = require('fs');
const path = require('path');

const BUILD_INFO_FILE = 'build-info.json';

/** @param {{prod?: boolean, firefox?: boolean}} env */
function channelOf(env = {}) {
  return env.prod ? 'prod' : 'staging';
}

/** @param {{prod?: boolean, firefox?: boolean}} env */
function outDirOf(env = {}) {
  const browser = env.firefox ? 'firefox' : 'chrome';
  const suffix = env.prod ? 'prod' : 'dev';
  return path.join('dist', `${browser}-${suffix}`);
}

/**
 * @param {string} dir
 * @returns {{channel: string, backendUrl: string, version: string, builtAt: string}}
 */
function readBuildInfo(dir) {
  const file = path.join(dir, BUILD_INFO_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} не найден. Папка не является выходом сборки webpack — ` +
      'отказываюсь работать с ней вслепую.'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Бросает, если каталог собран не в канале prod. @param {string} dir */
function assertProdChannel(dir) {
  const info = readBuildInfo(dir);
  if (info.channel !== 'prod') {
    throw new Error(
      `Канал сборки в ${dir} — "${info.channel}", бэкенд ${info.backendUrl}. ` +
      'Публикация разрешена только для канала "prod". Пересоберите с `--env prod`.'
    );
  }
}

module.exports = { BUILD_INFO_FILE, channelOf, outDirOf, readBuildInfo, assertProdChannel };
