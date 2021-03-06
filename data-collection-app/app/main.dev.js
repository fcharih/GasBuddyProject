/* eslint global-require: off */

/**
 * This module executes inside of electron's main process. You can start
 * s
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 *
 * @flow
 */
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
const ipc = require('electron').ipcMain;
const fs = require('fs');
const axios = require('axios');
const contextMenu = require('electron-context-menu');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

contextMenu({
  showCopyImageAddress: true,
  prepend: (defaultActions, params, browserWindow) => []
});

let dataFile = null;
let directory = null;
let mainWindow = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map(name => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

const createWindow = async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    webPreferences: {
      nodeIntegration: true,
      webviewTag: true
    }
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      Object.keys(details.responseHeaders)
        .filter(x => x.toLowerCase() === 'x-frame-options')
        .map(x => delete details.responseHeaders[x]);

      callback({
        cancel: false,
        responseHeaders: details.responseHeaders
      });
    }
  );

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('ready', createWindow);

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});

ipc.handle('select-file', async (event, filepath) => {
  dataFile = filepath;
});

ipc.handle('select-directory', async (event, filepath) => {
  directory = filepath;
});

ipc.handle('get-data', async event => {
  let data = JSON.parse(fs.readFileSync(dataFile));
  return data;
});

ipc.handle(
  'save-data',
  async (event, data, imageAvailable, index, stationIndex) => {
    fs.writeFileSync(dataFile, JSON.stringify(data));
    let newData = JSON.parse(fs.readFileSync(dataFile));
    if (imageAvailable) {
      try {
        const batchFileName = dataFile
          .split(/(\\|\/)/g)
          .pop()
          .replace(/\.[^/.]+$/, '');
        const imageFilename = `${directory}/${batchFileName}_${index}_${stationIndex}.jpg`;
        const response = await axios.get(
          data[index].nearbyStations.results[stationIndex].imageLink,
          {
            responseType: 'arraybuffer'
          }
        );
        const buffer = Buffer.from(response.data, 'binary');
        fs.writeFileSync(imageFilename, buffer);
      } catch (e) {
        console.log(e);
      }
    }
    return newData;
  }
);
