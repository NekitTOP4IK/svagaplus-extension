'use strict';

// tsc оставляет глобалы webpack DefinePlugin неразрешёнными, поэтому в node-тестах
// их надо выставить руками. Раньше этот блок был скопирован в пяти тестовых файлах:
// добавление шестого глобала означало пять одинаковых правок, а удаление —
// пять шансов забыть. Теперь список один.
//
// Значения намеренно нереальные: тест, случайно ушедший в сеть, должен падать
// на example.test, а не стучаться в настоящий бэкенд.
function defineBuildGlobals() {
  global.__BACKEND_URL__ = 'https://example.test';
  global.__FRONTEND_URL__ = 'https://example.test';
  global.__BUILD_CHANNEL__ = 'staging';
}

module.exports = { defineBuildGlobals };
