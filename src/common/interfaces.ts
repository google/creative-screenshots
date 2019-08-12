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
 * Lists the required PubSub attribute properties for
 * the listAdvertisers route.
 */
export interface ListAdvertisersAttributes {
  profileId: string;
}

/**
 * Lists the required PubSub attribute properties for
 * the listPlacements route.
 */
export interface ListPlacementsAttributes extends ListAdvertisersAttributes {
  advertiserId: string;
}

/**
 * Lists the required PubSub attribute properties for
 * the generateTags route.
 */
export interface GenerateTagsAttributes extends ListPlacementsAttributes {
  campaignId: string;
  accountId: string;
  placements: PlacementsList;
}

/**
 * Lists the required PubSub attribute properties for
 * the renderImage route.
 */
export interface RenderImageAttributes extends ListPlacementsAttributes {
  campaignId: string;
  accountId: string;
  placementId: string;
  tagFormat: string;
  size: string;
  tag: string;
  duration?: string;
}

/**
 * Lists the required properties for the screenshot storage route.
 */
export interface StoreImageAttributes extends ListPlacementsAttributes {
  [propName: string]: string;
  campaignId: string;
  accountId: string;
  placementId: string;
  screenshot: string;
  index: string;
}

/**
 * Placement objects passed from listPlacements to generateTags per Campaign.
 */
export interface CampaignPlacement {
  compatibility: string;
  size: string;
}

/**
 * Map object containing placement ID as key and campain placement object as
 * value.
 */
export interface PlacementsList {
  [key: string]: CampaignPlacement;
}
