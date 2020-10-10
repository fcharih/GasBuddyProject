// @flow
import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Line, Circle } from 'rc-progress';
import routes from '../constants/routes.json';
import styles from './Home.css';
const { dialog } = require('electron').remote;
const { clipboard } = require('electron');
const ipc = require('electron').ipcRenderer;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Props = {};

export default class Home extends Component<Props> {
  props: Props;

  state = {
    file: '',
    directory: '',
    data: [],
    index: 0,
    stationIndex: 0
  };

  getPercentDone() {
    return (100 * this.getAnnotatedImages()) / this.getTotalImageNum();
  }

  getTotalImageNum() {
    let imgs = 0;
    for (let i = 0; i < this.state.data.length; i++) {
      if (!this.stationsAvailableForSeed(i)) {
        continue;
      }
      for (
        let j = 0;
        j < this.state.data[i].nearbyStations.results.length;
        j++
      ) {
        imgs += 1;
      }
    }
    return imgs;
  }

  getAnnotatedImages() {
    let imgs = 0;
    for (let i = 0; i < this.state.data.length; i++) {
      if (!this.stationsAvailableForSeed(i)) {
        continue;
      }
      for (
        let j = 0;
        j < this.state.data[i].nearbyStations.results.length;
        j++
      ) {
        if (this.state.data[i].nearbyStations.results[j].isvLink) {
          imgs += 1;
        }
      }
    }
    return imgs;
  }

  dataIsAvailable() {
    return this.state.data.length > 0;
  }

  noImagesFetchedForSeed(index) {
    return this.state.data[index].nearbyStations.results.every(
      station => !station.gmapsLink
    );
  }

  seekFirstNewSeed() {
    for (let i = 0; i < this.state.data.length; i++) {
      if (this.noImagesFetchedForSeed(i) && this.stationsAvailableForSeed(i)) {
        this.setState({ index: i });
        break;
      }
    }
  }

  stationsAvailableForSeed(index) {
    return (
      this.state.data[index].nearbyStations.status === 'OK' &&
      this.state.data[index].nearbyStations.results.length > 0
    );
  }

  seekNextSeed() {
    let index;
    for (let i = this.state.index + 1; i < this.state.data.length; i++) {
      if (this.stationsAvailableForSeed(i)) {
        index = i;
        break;
      }
    }
    this.setState({ index, stationIndex: 0 });
  }

  seekPreviousSeed() {
    let index;
    for (let i = this.state.index - 1; i >= 0; i--) {
      if (this.stationsAvailableForSeed(i)) {
        index = i;
        break;
      }
    }
    this.setState({ index, stationIndex: 0 });
  }

  seekNextStation() {
    if (this.isLastStationForSeed()) {
      return this.seekNextSeed();
    }

    this.setState({ stationIndex: this.state.stationIndex + 1 });
  }

  seekPreviousStation() {
    if (this.state.stationIndex === 0) {
      return this.seekPreviousSeed();
    }

    this.setState({ stationIndex: this.state.stationIndex - 1 });
  }

  isLastStationForSeed() {
    return (
      this.state.stationIndex ===
      this.state.data[this.state.index].nearbyStations.results.length - 1
    );
  }

  async saveLink() {
    const navigator = document.querySelector('webview');
    const contents = await navigator.getWebContents();
    await contents.executeJavaScript(
      "document.querySelector('#share-button').click()"
    );
    const gmapsLink = await contents.executeJavaScript(
      "document.querySelector('#img-link').value"
    );
    const isvLink = contents.getURL();

    const max_iters = 5;
    let imageLink = null;
    for (let i = 0; i < max_iters; i++) {
      imageLink = await contents.executeJavaScript(
        "document.querySelector('#share-img').src"
      );
      if (imageLink && !imageLink.includes('.svg')) break;
      await sleep(2000);
    }
    this.state.data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].isvLink = isvLink;
    this.state.data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].gmapsLink = gmapsLink;
    this.state.data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].imageLink = imageLink;
    let newData = await ipc.invoke(
      'save-data',
      this.state.data,
      true,
      this.state.index,
      this.state.stationIndex
    );
    this.setState({ data: [...newData] });
    this.seekNextStation();
  }

  async badLink() {
    const data = JSON.parse(JSON.stringify(this.state.data));
    data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].isvLink = 'NA';
    data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].gmapsLink = 'NA';
    let newData = await ipc.invoke('save-data', data, false);
    this.setState({ data: [...newData] });
    this.seekNextStation();
  }

  async setFile() {
    const filepath = dialog.showOpenDialogSync({ properties: ['openFile'] });
    await ipc.invoke('select-file', filepath[0]);
    this.setState({ file: filepath });
    const data = await ipc.invoke('get-data', null);
    this.setState({ data });
    this.seekFirstNewSeed();
  }

  async setDirectory() {
    const filepath = dialog.showOpenDialogSync({
      properties: ['openDirectory']
    });
    await ipc.invoke('select-directory', filepath[0]);
    this.setState({ directory: filepath });
  }

  getInstantViewUrl() {
    if (this.state.data.length === 0) return null;
    const lat = this.state.data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].geometry.location.lat;
    const lng = this.state.data[this.state.index].nearbyStations.results[
      this.state.stationIndex
    ].geometry.location.lng;
    const url = `https://www.instantstreetview.com/@${lat},${lng},0h,0p,0z`;
    return url;
  }

  imageAvailableForLink(linkIndex) {
    return this.state.data[this.state.index].nearbyStations.results[linkIndex]
      .gmapsLink;
  }

  isReadyToCollect() {
    return this.state.file !== '' && this.state.directory !== '';
  }

  render() {
    if (!this.isReadyToCollect()) {
      return (
        <div data-tid="container">
          <h1>GSVImageryCollector</h1>
          <div>
            Please select the JSON file where the links are to be stored.
          </div>
          <button onClick={this.setFile.bind(this)}>Select file</button>
          <div>
            Please select the directory where the images are to be stored.
          </div>
          <button onClick={this.setDirectory.bind(this)}>
            Select directory
          </button>
        </div>
      );
    }

    return (
      <div data-tid="container">
        <h1>GSVImageryCollector</h1>
        <div className="big">Data stored in: {this.state.file}</div>
        <div className="big">Images stored in: {this.state.directory}</div>
        {this.dataIsAvailable() && (
          <div class="big">
            Link {this.dataIsAvailable() && this.getAnnotatedImages()} out of{' '}
            {this.dataIsAvailable() && this.getTotalImageNum()}
            {this.dataIsAvailable() && <div>Seed {this.state.index}</div>}
            <Line
              percent={this.getPercentDone()}
              strokeWidth="2"
              strokeColor="#FF7F00"
            />
          </div>
        )}
        <webview
          onClick={e => e.preventDefault()}
          style={{ height: '500px', width: '800px', margin: '0 auto' }}
          src={this.getInstantViewUrl()}
        />
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {this.dataIsAvailable() &&
            this.state.data[this.state.index].nearbyStations.results.map(
              (result, i) => (
                <div
                  key={`link-${i}`}
                  style={{
                    color: `${this.imageAvailableForLink(i) ? 'green' : 'red'}`,
                    textDecoration: `${
                      i === this.state.stationIndex ? 'underline' : ''
                    }`
                  }}
                  onClick={() => this.setState({ stationIndex: i })}
                >
                  Link {i}
                </div>
              )
            )}
        </div>
        <div className="btt">
          <button onClick={this.seekPreviousSeed.bind(this)}>Prev</button>
          <button onClick={this.saveLink.bind(this)}>Save link</button>
          <button onClick={this.badLink.bind(this)}>Bad link</button>
          <button onClick={this.seekNextSeed.bind(this)}>Next</button>
        </div>
      </div>
    );
  }
}
