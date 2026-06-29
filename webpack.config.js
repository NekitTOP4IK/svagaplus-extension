const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { version } = require('./package.json');

const DEFAULTS = {
  BACKEND_URL_PROD: 'https://tributealerts.nekittop4ik.space',
  BACKEND_URL_DEV: 'http://localhost:5000',
};

function backendUrl(isProd) {
  const key = isProd ? 'BACKEND_URL_PROD' : 'BACKEND_URL_DEV';
  return (process.env[key] || DEFAULTS[key]).replace(/\/+$/, '');
}

module.exports = (env = {}) => {
  const isFirefox = !!env.firefox;
  const isProd = !!env.prod;
  const backend = backendUrl(isProd);
  const backendHost = new URL(backend).host;
  const updateUrl = backend + '/api/extension/firefox-updates.json';
  const wsBackend = backend.replace(/^http/, 'ws').replace(/^https/, 'wss');

  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? false : 'cheap-source-map',
    entry: {
      'src/app/content': './src/app/content.ts',
      'src/app/popup': './src/app/popup.ts',
      'src/app/background': './src/app/background.ts',
    },
    output: {
      path: path.resolve(__dirname, isFirefox ? 'dist_firefox' : 'dist_chrome'),
      filename: '[name].js',
      clean: true,
    },
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
    module: {
      rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    optimization: { minimize: false },
    plugins: [
      new webpack.DefinePlugin({
        __BACKEND_URL__: JSON.stringify(backend),
        __WS_BACKEND_URL__: JSON.stringify(wsBackend),
        __FRONTEND_URL__: JSON.stringify(backend),
      }),
      new CopyPlugin({
        patterns: [
          {
            from: isFirefox ? 'manifest.firefox.json' : 'manifest.json',
            to: 'manifest.json',
            transform(content) {
              return content.toString()
                .replace(/__VERSION__/g, version)
                .replace(/__BACKEND_URL__/g, backend)
                .replace(/__BACKEND_HOST__/g, backendHost)
                .replace(/__UPDATE_URL__/g, updateUrl);
            },
          },
          {
            from: 'src',
            to: 'src',
            globOptions: { ignore: ['**/*.ts', '**/*.tsx'] },
            transform(content) {
              return content.toString()
                .replace(/__BACKEND_URL__/g, backend)
                .replace(/__BACKEND_HOST__/g, backendHost)
                .replace(/__UPDATE_URL__/g, updateUrl);
            },
          },
          { from: 'icons', to: 'icons' },
        ],
      }),
    ],
  };
};
