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
const {v2beta3} = require('@google-cloud/tasks');
import {Request, Response} from 'express';
import {GaxiosResponse} from 'gaxios';
import {auth, OAuth2Client} from 'google-auth-library';
import {dfareporting_v3_3, google} from 'googleapis';
import {CLOUD_TASK_QUEUES, CM_TRAFFICKING_SCOPES} from './common/constants';
import {ListPlacementsAttributes, CampaignPlacement, PlacementsList} from './common/interfaces';

/**
 * Returns date in YEAR-MONTH-DAY format.
 * @param {!Date} date DateObject to format.
 * @param {string=} separator String to separate date parts, defaults to -.
 * @return {string} Formatted date.
 */
function formatDate(date: Date, separator = '-') {
  return `${date.getFullYear()}${separator}` +
      `${(date.getMonth() + 1).toString().padStart(2, '0')}${separator}` +
      `${date.getDate().toString().padStart(2, '0')}`;
}

/**
 * Uses the CM API to list placements associated with a given advertiserId.
 *
 * @param {!dfareporting_v3_3.Dfareporting} client The DCM authenticated client.
 * @param {!ListPlacementsAttributes} attributes Attributes sent via Pub/Sub.
 * @return {!Promise<Array<dfareporting_v3_3.Schema$Placement>>} Array of DCM
 *     Placements.
 */
async function listPlacements(
    dfaClient: dfareporting_v3_3.Dfareporting,
    attributes: ListPlacementsAttributes):
    Promise<dfareporting_v3_3.Schema$Placement[]> {
  let placements: dfareporting_v3_3.Schema$Placement[] = [];
  let counter = 0;
  let nextPageToken: string = undefined;
  const date = new Date();
  date.setDate(date.getDate() - 1);  // Yesterday

  do {
    const placementsRequest:
        dfareporting_v3_3.Params$Resource$Placements$List = {
      profileId: attributes.profileId,
      advertiserIds: [attributes.advertiserId],
      archived: false,
      compatibilities: ['DISPLAY', 'IN_STREAM_VIDEO'],
      minEndDate: formatDate(date),
      pageToken: nextPageToken,
      fields:
          'nextPageToken,placements/id,placements/accountId,placements/advertiserId,placements/campaignId,placements/size/width,placements/size/height',
    };

    if (!nextPageToken) {
      delete placementsRequest.pageToken;
    }

    const placementsResponse:
        GaxiosResponse<dfareporting_v3_3.Schema$PlacementsListResponse> =
            await dfaClient.placements.list(placementsRequest);
    placements = placements.concat(placementsResponse.data.placements);
    nextPageToken = placementsResponse.data.nextPageToken;

    console.log(
        `${placements.length} - Placements on ` +
        `page ${++counter} with token: ${nextPageToken}`);

  } while (nextPageToken !== undefined);

  return placements;
}

/**
 * Groups all placement ID and Size by campaign ID into a Map.
 * @param {!Array<dfareporting_v3_3.Schema$Placement>} placements Array with
 *     placements.
 * @return {!Map<string, CampaignPlacements>} Map with campaignId, placements.
 */
function groupPlacementsByCampaign(
    placements: dfareporting_v3_3.Schema$Placement[]):
    Map<string, PlacementsList> {
  const placementByCampaign = new Map();
  for (const placement of placements) {
    if (!placementByCampaign.has(placement.campaignId)) {
      placementByCampaign.set(placement.campaignId, {});
    }

    const campaignPlacements: CampaignPlacement = {
      compatibility: placement.compatibility,
      size: `${placement.size.width}x${placement.size.height}`,
    };

    placementByCampaign.get(placement.campaignId)[placement.id] =
        campaignPlacements;
  }
  return placementByCampaign;
}

/**
 * Filters out any placement with size 1x1.
 * @param {dfareporting_v3_3.Schema$Placement} placement Placement to verify.
 * @return {boolean} false if placement size is 1x1.
 */
function filterOutTrackingPlacements(
    placement: dfareporting_v3_3.Schema$Placement) {
  return placement.size.width !== 1 && placement.size.height !== 1;
}

/**
 * Publishes a message to the generate tags channel for a campaign and its
 * placements.
 * @param {string} accountId CM Account ID.
 * @param {string} campaignId CM Campaign ID.
 * @param {Array<dfareporting_v3_3.Schema$Placement>} placements Array of all
 *     placements for this campaign ID.
 * @param {ListPlacementsAttributes} attributes Event attributes from the Cloud
 *     Function.
 */
async function publishToPubSub(
    accountId: string, campaignId: string, placements: PlacementsList,
    attributes: ListPlacementsAttributes,
    serviceHostname: string): Promise<void> {
  if (Object.keys(placements).length === 0) {
    console.log(`No placements for campaign ${campaignId}`);
    return;
  }

  const client = new v2beta3.CloudTasksClient();
  const parent = client.queuePath(
      process.env.CLOUD_PROJECT_ID, process.env.CLOUD_RUN_REGION,
      CLOUD_TASK_QUEUES.generateTags);

  const generateTagsAttributes = {
    ...attributes,
    campaignId,
    accountId,
    placements,
  };

  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${serviceHostname}/generate-tags`,
      body: Buffer.from(JSON.stringify(generateTagsAttributes))
                .toString('base64'),
      headers: {'Content-Type': 'application/json'},
    },
  };

  const request = {
    parent,
    task,
  };

  // Send create task request.
  const [response] = await client.createTask(request);
  const name = response.name;

  console.log(
      `Created generate-tags task: ${JSON.stringify(generateTagsAttributes)}`);
}

/**
 * Splits the PlacementsList object into an array of PlacementsLists each with
 * a maximum number of properties(placements).
 *
 * @param placementList {PlacementsList} PlacementsList to split.
 * @param chunkSize {number} Maximum size of the placement list.
 * @return Array<PlacementList>
 */
function chunkPlacementList(
    placementList: PlacementsList, chunkSize: number): PlacementsList[] {
  const results: PlacementsList[] = [];
  let index = 0;
  let chunk: PlacementsList = {};
  for (const [key, value] of Object.entries(placementList)) {
    chunk[key] = value;
    if (++index % chunkSize === 0) {
      results.push(chunk);
      chunk = {};
    }
  }
  if (index % chunkSize !== 0) {
    results.push(chunk);
  }
  return results;
}


/**
 * Handler for list-placements route.
 *
 * @param {!Request} req Express HTTP Request.
 * @param {!Response} res Express HTTP Response.
 */
export async function listPlacementsHandler(
    req: Request, res: Response, next: Function): Promise<void> {
  const attributes: ListPlacementsAttributes = req.body;

  console.log(`LIST PLACEMENTS: ${JSON.stringify(attributes)}`);

  try {
    const client: OAuth2Client =
        await auth.getClient({scopes: [...CM_TRAFFICKING_SCOPES]});

    google.options({
      timeout: 60000,
      auth: client,
    });

    const dfaClient: dfareporting_v3_3.Dfareporting =
        google.dfareporting('v3.3');

    let allPlacements = await listPlacements(dfaClient, attributes);
    allPlacements = allPlacements.filter(filterOutTrackingPlacements);

    if (allPlacements.length === 0) {
      console.log(
          `No placements returned for advertiser ${attributes.advertiserId}`);
      res.status(204).end();
      return;
    }

    const accountId: string = allPlacements[0].accountId;
    const groupedPlacements = groupPlacementsByCampaign(allPlacements);

    for (const [campaignId, placements] of groupedPlacements) {
      if (Object.keys(placements).length > 0) {
        const placementChunks = chunkPlacementList(placements, 50);
        console.log(
            `[campaignId ${campaignId}] - ` +
            `Sending ${Object.keys(placements).length} placements ` +
            `in ${placementChunks.length} chunk(s).`);
        for (const placementChunk of placementChunks) {
          await publishToPubSub(
              accountId, campaignId, placementChunk, attributes,
              `${req.protocol}://${req.hostname}`);
        }
      }
    }

  } catch (error) {
    console.error(error);
    next();
  }

  res.status(204).end();
}
