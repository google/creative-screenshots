/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Datastore} from '@google-cloud/datastore';
import {File, Storage} from '@google-cloud/storage';
import {Request, Response} from 'express';

import {StoreImageAttributes} from './common/interfaces';

/**
 * @type {array!}
 * Required PubSub attributes
 */
const REQUIRED_ATTRIBUTES =
    ['accountId', 'advertiserId', 'campaignId', 'placementId', 'screenshot'];

const OPTIONAL_ATTRIBUTES = ['index'];

interface StorageGcsSettings {
  storage: Storage;
  cloudBucket: string;
  filePathPattern: string;
  cloudProject: string;
}

/**
 * This class exposes a store function to save a screenshot to GCS
 */
class StorageGcs {
  settings: StorageGcsSettings;

  /**
   * Constructor function
   * @param {?object=} settings
   */
  constructor(settings: StorageGcsSettings = null) {
    if (settings != null) {
      this.settings = settings;
    } else {
      /**
       * @type {object!}
       * Settings object for function configuration.
       */
      this.settings = {
        storage: undefined,

        /**
         * @type {string}
         * Name of the Cloud Bucket to store the screenshot in.
         */
        cloudBucket: process.env.CLOUD_BUCKET,

        /**
         * @type {string}
         * Pattern to be used as filepath when saving files.
         * Brackets denote placeholders.
         * ie. {account_id} will be replaced with account_id attribute
         */
        filePathPattern: process.env.FILE_PATH_PATTERN ||
            '{accountId}/{advertiserId}/{campaignId}/{placementId}.jpg',

        cloudProject: process.env.CLOUD_PROJECT_ID
      };
    }

    // Instantiate storage
    if (!this.settings.storage) {
      const storageParams = {
        projectId: this.settings.cloudProject,
      };
      this.settings.storage = new Storage(storageParams);
    }
  }
  /**
   * Stores the image buffer to a Google Cloud Storage bucket.
   *
   * @param {object!} file The Google Cloud Storage file to use.
   * @param {object!} imageBuffer The image buffer to write to the file.
   * @return {Promise!} Promise that resolves when file is written to the
   *     bucket.
   */
  async storeScreenshot(file: File, imageBuffer: Buffer) {
    return new Promise((resolve, reject) => {
      const stream = file.createWriteStream(
          {metadata: {contentType: 'image/jpg'}, resumable: false});
      stream.on('error', (error) => {
        console.log('Write stream failure');
        reject(error);
      });
      stream.on('finish', resolve);
      stream.end(imageBuffer);
    });
  }

  /**
   * Returns if the PubSub attributes contain the required keys.
   *
   * @param {StoreImageAttributes!} attributes Object with req attributes.
   * @return {boolean} True if all required keys are present, otherwise False.
   */
  validateAttributes(attributes: StoreImageAttributes): boolean {
    if (typeof attributes !== 'object') {
      console.log('No attributes provided in the PubSub message.');
      return false;
    }

    for (const attribute of REQUIRED_ATTRIBUTES) {
      if (!attributes.hasOwnProperty(attribute)) {
        console.log(
            `${attribute} is a required attribute in the PubSub message.`);
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the file path for the image to be stored.
   *
   * @param {object!} attributes Object with the PubSub event attributes.
   * @return {string} file path
   */
  getFilePath(attributes: StoreImageAttributes) {
    let filePath = this.settings.filePathPattern;
    for (const attribute of REQUIRED_ATTRIBUTES) {
      filePath = filePath.replace(`{${attribute}}`, attributes[attribute]);
    }
    for (const attribute of OPTIONAL_ATTRIBUTES) {
      filePath = filePath.replace(`{${attribute}}`, attributes[attribute]);
    }
    return filePath;
  }

  /**
   * Returns Promise of file exists.
   *
   * @param {object!} file
   * @return {Promise!}
   *
   */
  async fileExists(file: File) {
    return file.exists();
  }

  /**
   * Handler function for storage to Google Cloud Storage.
   *
   * @param {Request!} req Express Request object.
   * @param {Response!} res Express Response object.
   */
  async store(attributes: StoreImageAttributes) {
    if (!this.validateAttributes(attributes)) {
      throw new Error('Required attributes are not available.');
    }
    const screenshot = Buffer.from(attributes.screenshot, 'base64');
    const bucket = this.settings.storage.bucket(this.settings.cloudBucket);
    const filePath = this.getFilePath(attributes);
    const file = bucket.file(filePath);

    const [exists] = await this.fileExists(file);

    if (!exists) {
      await this.storeScreenshot(file, screenshot);
      console.log(`${filePath} stored to Bucket.`);
      await this.logToDatastore(attributes);
      console.log(`${filePath} logged to Datastore.`);
    } else {
      console.log(`File already exists: ${filePath}`);
    }
  }

  async logToDatastore(attributes: StoreImageAttributes) {
    const datastore = new Datastore();
    const screenshotKey = datastore.key('Screenshot');
    const entity = {
      key: screenshotKey,
      data: [
        {name: 'accountId', value: attributes.accountId},
        {name: 'advertiserId', value: attributes.advertiserId},
        {name: 'campaignId', value: attributes.campaignId},
        {name: 'placementId', value: attributes.placementId}, {
          name: 'attributes',
          value: JSON.stringify(attributes),
          excludeFromIndexes: true
        },
        {name: 'created', value: new Date().toJSON()}
      ]
    };
    return datastore.save(entity);
  }
}

exports.StorageGcs = StorageGcs;

/**
 * Express route handler to Store to Google Cloud Storage.
 */
export async function storeToGcsHandler(attributes: StoreImageAttributes) {
  const storageGcs = new StorageGcs();
  return storageGcs.store(attributes);
}
