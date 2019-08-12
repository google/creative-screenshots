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

/**
 * List of cloud task queues used by this application
 */
export const CLOUD_TASK_QUEUES = {
  listAdvertisers: 'list-advertisers',
  listPlacements: 'list-placements',
  generateTags: 'generate-tags',
  renderScreenshot: 'render-screenshot',
};

/**
 * OAuth 2.0 scope for Google Cloud PubSub.
 */
export const PUBSUB_SCOPE: string[] =
    ['https://www.googleapis.com/auth/pubsub'];

/**
 * OAuth 2.0 scope for Campaign Manager Trafficking API.
 */
export const CM_TRAFFICKING_SCOPES: string[] =
    ['https://www.googleapis.com/auth/dfatrafficking'];

/**
 * State of the browser used by Puppeteer.
 */
export enum BrowserState {
  NOT_STARTED = 0,
  STARTING,
  READY,
  ERROR,
}
