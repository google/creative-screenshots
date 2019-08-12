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

import bodyParser from 'body-parser';
import express from 'express';

import {generateTagsHandler} from './generateTags';
import {listAdvertisersHandler} from './listAdvertisers';
import {listPlacementsHandler} from './listPlacements';
import {screenshotHandler} from './screenshot';

const app = express();
app.set('port', process.env.PORT || 8080);

app.use(bodyParser.json());

app.post('/render-screenshot', screenshotHandler);
app.post('/list-placements', listPlacementsHandler);
app.post('/generate-tags', generateTagsHandler);
app.post('/list-advertisers', listAdvertisersHandler);

app.listen(app.get('port'), () => {
  console.log(`App is listening on port ${app.get('port')}`);
});
