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

import {CloudTasksClient} from '@google-cloud/tasks';
import {Request, Response} from 'express';
import {auth} from 'google-auth-library';
import {dfareporting_v3_3, google} from 'googleapis';

import {CM_TRAFFICKING_SCOPES, CLOUD_TASK_QUEUES} from './common/constants';
import {ListAdvertisersAttributes, ListPlacementsAttributes} from './common/interfaces';

import * as protos from '@google-cloud/tasks/build/protos/protos';


/**
 * Uses the DCM API to list advertisers associated with a given profileId.
 *
 * @param {!dfareporting_v3_3.Dfareporting} client The DCM authenticated client.
 * @param {!ListAdvertisersAttributes} attributes Attributes received via Cloud Task.
 */
async function listAdvertisers(
    dfaClient: dfareporting_v3_3.Dfareporting,
    attributes: ListAdvertisersAttributes,
    serviceHostname: string): Promise<void> {

  let nextPageToken: string = undefined;
  let advertisers: dfareporting_v3_3.Schema$Advertiser[] = [];
  let counter = 0;

  do {
    const advertisersRequest = {
      profileId: attributes.profileId,
      pageToken: nextPageToken,
      fields: 'nextPageToken,advertisers/id',
    };

    if (!nextPageToken) {
      delete advertisersRequest.pageToken;
    }

    const advertisersResponse = await dfaClient.advertisers.list(advertisersRequest);
    advertisers = advertisers.concat(advertisersResponse.data.advertisers);
    nextPageToken = advertisersResponse.data.nextPageToken;
    console.log(`${advertisers.length} - Advertisers on page ${++counter} with token: ${nextPageToken}`);
  } while (nextPageToken !== undefined);

  const client = new CloudTasksClient();
  const parent = client.queuePath(process.env.CLOUD_PROJECT_ID, process.env.CLOUD_RUN_REGION, CLOUD_TASK_QUEUES.listPlacements);

  for (const [index, advertiser] of advertisers.entries()) {
    const customAttributes: ListPlacementsAttributes = {
      profileId: attributes.profileId,
      advertiserId: advertiser.id,
    };

    const task = {
      httpRequest: {
        httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
        url: `${serviceHostname}/list-placements`,
        body: Buffer.from(JSON.stringify(customAttributes)).toString('base64'),
        headers: {'Content-Type': 'application/json'},
      },
    };

    const request = {parent, task};
    await client.createTask(request);
    console.log(`${
        Math.round((index / advertisers.length) * 100)
            .toString()
            .padStart(2, '0')}% - Created list-placements task: ${
        JSON.stringify(customAttributes)}`);
  }
}

/**
 * Handler for list-advertisers route.
 *
 * @param {!Request} req Express HTTP Request.
 * @param {!Response} res Express HTTP Response.
 */
export async function listAdvertisersHandler(req: Request, res: Response, next: Function): Promise<void> {
  const attributes: ListAdvertisersAttributes = req.body;
  console.log(`LIST ADVERTISERS: ${JSON.stringify(attributes)}`);

  try {
    const client = await auth.getClient({scopes: [...CM_TRAFFICKING_SCOPES]});
    google.options({timeout: 60000, auth: client});
    
    const dfaClient = google.dfareporting('v3.3');
    await listAdvertisers(dfaClient, attributes, `${req.protocol}://${req.hostname}`);
  } catch (error) {
    console.error(error);
    next();
  }
  res.status(204).end();
}
