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

import {Request, Response} from 'express';
import puppeteer from 'puppeteer';
import {Browser, Page} from 'puppeteer';

import {BrowserState} from './common/constants';
import {RenderImageAttributes, StoreImageAttributes} from './common/interfaces';
import {storeToGcsHandler} from './storeToGcs';

const PADDING: number = Number(process.env.SCREENSHOT_PADDING);
const MS_BEFORE_SCREENSHOT: number = Number(process.env.MS_BEFORE_SCREENSHOT);
const MS_BEFORE_SCREENSHOT_INSTREAM: number = Number(process.env.MS_BEFORE_SCREENSHOT_INSTREAM);
const SCREENSHOT_QUALITY: number = Number(process.env.SCREENSHOT_QUALITY);
const NUMBER_OF_SCREENSHOTS: number = Number(process.env.NUMBER_OF_SCREENSHOTS);
const DEFAULT_ANIMATION_LENGTH: number = 15;
const BUFFER_DELAY: number = 8000;
const BUFFER_DELAY_BEFORE_SCREENSHOT: number = 500;

let browser: Browser = undefined;
let browserState: BrowserState = BrowserState.NOT_STARTED;
const sizeRegex = new RegExp(/(?<width>\d+)x(?<height>\d+)/);

interface ViewPortSize {
  width: number;
  height: number;
}

/**
 * Store image to Cloud Storage Bucket.
 *
 * @param {Buffer!} imageBuffer The image buffer to write to the file.
 * @param {RenderImageAttributes} attributes The task attributes.
 * @return {Promise!} Promise that resolves when file is written to the bucket.
 */
async function storeScreenshot(
    imageBuffer: Buffer, attributes: RenderImageAttributes, index: number = 0) {
  const storeImageAttributes: StoreImageAttributes = {
    ...attributes,
    index: index.toString(),
    screenshot: imageBuffer.toString('base64'),
  };
  return storeToGcsHandler(storeImageAttributes);
}

/**
 * Takes a screenshot from a Puppeteer page using the configured settings.
 * @param {Page} page Puppeteer page.
 * @return {Buffer} Image buffer.
 */
async function takeScreenshot(page: Page, size: ViewPortSize) {
  return page.screenshot({
    type: 'jpeg',
    quality: SCREENSHOT_QUALITY,
    clip: {
      x: 0,
      y: 0,
      ...size,
    }
  });
}

/**
 * Resolves promise after given milliseconds, used to pause with async/await.
 * @param {number} milliseconds Number of milliseconds to wait.
 * @return {Promise}
 */
async function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Handles requests for screenshots.
 * @param req {Request} HTTP Request Object.
 * @param res {Response} HTTP Response Object.
 */
export async function screenshotHandler(req: Request, res: Response) {
  const attributes: RenderImageAttributes = req.body;

  if (browserState === BrowserState.READY) {
    console.log(`RENDER SCREENSHOT: ${JSON.stringify(attributes)}`);

    const {groups} = sizeRegex.exec(attributes.size);
    const size: ViewPortSize = {
      width: Number(groups.width) + PADDING,
      height: Number(groups.height) + PADDING,
    };
    const page: Page = await browser.newPage();
    await page.setViewport(size);
    await page.setBypassCSP(true);
    await page.setContent(attributes.tag);

    // Delay before the screenshot.
    const timeout = attributes.tagFormat ===
            'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4' ?
        MS_BEFORE_SCREENSHOT_INSTREAM :
        MS_BEFORE_SCREENSHOT;

    if (NUMBER_OF_SCREENSHOTS > 1) {
      const animationLength: number = attributes.tagFormat ===
              'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4' ?
          Number(attributes.duration) :
          DEFAULT_ANIMATION_LENGTH;

      console.log(
          `[${attributes.placementId}] - Continues screenshot mode: ` +
          `${animationLength}/${NUMBER_OF_SCREENSHOTS}`);

      let interval = Math.round(animationLength / NUMBER_OF_SCREENSHOTS) * 1000;

      if (isNaN(interval)) {
        console.log(
            `[${attributes.placementId}] - ` +
            `Interval calculation resulted in NaN`);
        interval = 1000;
      }

      const screenshots: Buffer[] = [];

      if (attributes.tagFormat ===
          'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4') {
        // Add some time to load the video.
        await sleep(BUFFER_DELAY);
      }

      for (let i = 0; i < NUMBER_OF_SCREENSHOTS; i++) {
        console.log(
            `[${attributes.placementId}] - ` +
            `screenshot ${i + 1} of ${NUMBER_OF_SCREENSHOTS}`);
        const imageBuffer: Buffer = await takeScreenshot(page, size);
        screenshots.push(imageBuffer);
        if (attributes.tagFormat ===
            'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4') {
          const videoElement = await page.$('video');
          await page.evaluate((video, interval) => {
            video.autoplay = true;
            video.controls = false;
            video.currentTime = video.currentTime + interval;
          }, videoElement, interval / 1000);
          await sleep(BUFFER_DELAY_BEFORE_SCREENSHOT);
        } else {
          await sleep(interval);
        }
      }

      page.close();

      console.log(`[${attributes.placementId}] - All screenshots taken.`);
      for (const [index, screenshot] of screenshots.entries()) {
        await storeScreenshot(screenshot, attributes, index);
      }

    } else {
      console.log('Single Screenshot Mode.');
      await sleep(timeout);
      const imageBuffer: Buffer = await takeScreenshot(page, size);
      page.close();
      await storeScreenshot(imageBuffer, attributes);
    }
    res.status(204).end();

  } else if (
      browserState === BrowserState.NOT_STARTED ||
      browserState === BrowserState.ERROR) {
    console.log(`Browser state ${browserState}, starting now.`);
    browserState = BrowserState.STARTING;
    puppeteer
        .launch({
          headless: true,
          executablePath: process.env.CHROME_BIN,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        .then(async (newBrowser: Browser) => {
          browser = newBrowser;
          browserState = BrowserState.READY;
          console.log(`BROWSER STARTED - VERSION: ${await browser.version()}`);
          screenshotHandler(req, res);
        })
        .catch((error: Error) => {
          browserState = BrowserState.ERROR;
          console.error(error);
          res.status(425).end();
        });
  } else {
    res.status(425).end();
  }
}
