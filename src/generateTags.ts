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

// tslint:disable-next-line:no-require-imports No ts declaration available.
import {CloudTasksClient} from '@google-cloud/tasks';
import {Datastore} from '@google-cloud/datastore';
import cheerio from 'cheerio';
import {Request, Response} from 'express';
import {Gaxios} from 'gaxios';
import {auth} from 'google-auth-library';
import {dfareporting_v3_3, google} from 'googleapis';
import {CLOUD_TASK_QUEUES, CM_TRAFFICKING_SCOPES} from './common/constants';
import {PlacementsList, GenerateTagsAttributes, RenderImageAttributes} from './common/interfaces';

import * as protos from '@google-cloud/tasks/build/protos/protos';

interface ScreenshotDatastoreEntry {
  campaignId: string;
  placementId: string;
}
/**
 * Removes all placement IDs already present in Datastore.
 * @param {string} campaignId Datastore query will filter placements based on this campaign ID.
 * @param {!Map<string, CampaignPlacements>} placements Object with placements.
 * @return {!Array<number>}
 */
async function filterUnprocessedPlacements(campaignId: string, placements: PlacementsList): Promise<PlacementsList> {
  const datastore = new Datastore();
  const query = datastore.createQuery('Screenshot').filter('campaignId', '=', campaignId.toString());

  const [processedPlacements] = await datastore.runQuery(query);
  const processedPlacementIds = new Set(processedPlacements.map((p: ScreenshotDatastoreEntry) => p.placementId));

  Object.keys(placements).forEach((placementId) => {
    if (processedPlacementIds.has(placementId)) {
      delete placements[placementId];
    }
  });

  return placements;
}

/**
 * Response object returned by the getVastTag method.
 */
interface VastTagUnwrapResponse {
  size: string;
  duration: number;
  mediaFileRedirect?: string;
  tag?: string;
}

/**
 * Calls VAST prefetch URL and parses the first MP4 media file. Media file url
 * is wrapped in a script updating window location href.
 * @param {string} tag VAST tag prefetch URL.
 * @return {!object} size and tag.
 */
async function getVastTag(tag: string): Promise<VastTagUnwrapResponse> {
  const gaxios = new Gaxios();
  const {data} = await gaxios.request({url: tag});

  const vastTag = cheerio.load(data, {
    normalizeWhitespace: true,
    xmlMode: true,
    recognizeCDATA: true,
  });

  const mp4MediaFile = vastTag('MediaFiles').find('[type="video/mp4"]').first();
  const [hh, mm, ss] = vastTag('Duration').text().split(':').map(Number);
  const duration = hh * 60 * 60 + mm * 60 + ss;

  if (mp4MediaFile.length === 0) {
    console.log('No valid MediaFile found in VAST tag.');
    return {size: '0x0', duration, tag};
  }

  return {
    size: '640x480',
    duration,
    mediaFileRedirect: `<script>window.location.href='${mp4MediaFile.text()}';</script>`,
  };
}

/**
 * Uses the DCM API to handle requests and prepares HTML code or URL to render
 * and screenshot.
 *
 * @param {!OAuth2Client} client DCM authenticated client.
 * @param {!object} placements DCM placements list.
 * @param {!object} attributes Attributes received via Cloud Tasks.
 */
async function generateTags(
    dfaClient: dfareporting_v3_3.Dfareporting, placements: PlacementsList,
    attributes: GenerateTagsAttributes, serviceHostname: string) {

  placements = await filterUnprocessedPlacements(attributes.campaignId, placements);
  if (Object.keys(placements).length === 0) {
    console.log(`No placements to process for campaign ${attributes.campaignId}`);
    return;
  }

  const tagsRequest: dfareporting_v3_3.Params$Resource$Placements$Generatetags = {
    profileId: attributes.profileId,
    campaignId: attributes.campaignId,
    placementIds: Object.keys(placements),
    tagFormats: [
      'PLACEMENT_TAG_JAVASCRIPT',
      'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4',
    ],
    fields: 'placementTags/placementId, placementTags/tagDatas/impressionTag, placementTags/tagDatas/format',
  };

  const tagsResponse = await dfaClient.placements.generatetags(tagsRequest);

  const client = new CloudTasksClient();
  const parent = client.queuePath(process.env.CLOUD_PROJECT_ID, process.env.CLOUD_RUN_REGION, CLOUD_TASK_QUEUES.renderScreenshot);

  if (!tagsResponse.data.hasOwnProperty('placementTags')) {
    console.log(
        `No tags generated for campaign ${attributes.campaignId} ` +
        `with placements ${Object.keys(placements)}`);
    return;
  }

  for (const placementTag of tagsResponse.data.placementTags) {
    const placementId = placementTag.placementId;
    if (placementTag.hasOwnProperty('tagDatas')) {
      const tagData = placementTag.tagDatas[0];
      if (tagData.hasOwnProperty('impressionTag')) {
        let data = tagData.impressionTag;
        const placement = placements[placementId];
        const customAttributes: RenderImageAttributes = {
          ...attributes,
          placementId,
          tagFormat: tagData.format,
          size: placement.size,
          tag: '',
        };

        if (tagData.format === 'PLACEMENT_TAG_INSTREAM_VIDEO_PREFETCH_VAST_4') {
          const {mediaFileRedirect, size, duration} = await getVastTag(data);
          customAttributes.size = size;
          customAttributes.duration = duration.toString();
          data = mediaFileRedirect;
        }

        if (customAttributes.size !== '0x0') {
          customAttributes.tag = `<html><body>${data}</body></html>`;

          const task = {
            httpRequest: {
              httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
              url: `${serviceHostname}/render-screenshot`,
              body: Buffer.from(JSON.stringify(customAttributes)).toString('base64'),
              headers: {'Content-Type': 'application/json'},
            },
          };

          const request = {parent, task};
          await client.createTask(request);
          console.log(`Created render-screenshot task: ${JSON.stringify(customAttributes)}`);
        }

      } else {
        console.log(
            `NO IMPRESSION TAG: Advertiser: ` +
            `${attributes.advertiserId}, campaign: ` +
            `${attributes.campaignId}, placement: ${placementId}`);
      }
    } else {
      // TODO: Store to datastore, so it will be removed before calling generate tags next time?
      console.log( 
        `NO TAG DATA: Advertiser: ${attributes.advertiserId}, ` +
        `campaign: ${attributes.campaignId}, placement: ${placementId}`);
    }
  }
}

/**
 * Handler for Generate Tags route.
 *
 * @param {!Request} req Express HTTP Request.
 * @param {!Response} res Express HTTP Response.
 */
export async function generateTagsHandler(req: Request, res: Response, next: Function) {
  const attributes: GenerateTagsAttributes = req.body;
  console.log(`GENERATE TAGS: ${JSON.stringify(attributes)}`);

  try {
    const client = await auth.getClient({scopes: [...CM_TRAFFICKING_SCOPES]});
    google.options({timeout: 60000, auth: client});

    const dfaClient = google.dfareporting('v3.3');
    await generateTags(dfaClient, attributes.placements, attributes, `${req.protocol}://${req.hostname}`);

  } catch (error) {
    console.error(error);
    next();
  }
  res.status(204).end();
}
