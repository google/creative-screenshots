# Creative Screenshots

**Please note: this is not an officially supported Google product.**

This is a solution to render screenshots for placements from GMP Campaign
Manager. It can take screenshots of an entire Campaign Manager Network. The
application can be deployed on Google Cloud Run. It can be configured to
generate n number of screenshots per placement.

Captured placements are stored in Datastore, so it can run daily without
re-rendering already covered placements.

Supported tags: * Display * VAST

The application will run through the following steps:<br />
* **List Advertisers**: Lists all advertisers available to the Profile
 (User Account) this solution is using.
* **List Placements**: Lists all placements per Advertiser
* **Generate Tags**: Generates a JS or VAST tag for each placement found.
 VAST tags are unwrapped and only the media file is processed.
* **Render Screenshot**: Loads the tag/media and takes n screenshots.
 Images are stored to Google Cloud Storage.

## Setup

### Cloud

#### Datastore

**Enable Google Cloud Datastore Service:** \
$ `gcloud services enable datastore.googleapis.com`

#### Cloud Tasks

The application makes use of different task queues:

Queue Name        | Maximum Rate | Maximum Concurrent
----------------- | ------------ | ------------------
list-advertisers  | 1/s          | 1
list-placements   | 5/s          | 5
generate-tags     | 5/s          | 25
render-screenshot | 5/s          | 40

To set up the queues as per above settings you can run the following commands:

**Enable Google Cloud Tasks Service:** $ `gcloud services enable
cloudtasks.googleapis.com`

**Create Queues:**
\$ `gcloud tasks queues create list-advertisers --max-dispatches-per-second=1 --max-concurrent-dispatches=1`<br />
\$ `gcloud tasks queues create list-placements --max-dispatches-per-second=5 --max-concurrent-dispatches=5`<br />
\$ `gcloud tasks queues create generate-tags --max-dispatches-per-second=5 --max-concurrent-dispatches=25`<br />
\$ `gcloud tasks queues create render-screenshot --max-dispatches-per-second=5 --max-concurrent-dispatches=40`

[Additional documentation on creating Google Cloud Task Queues.](https://cloud.google.com/tasks/docs/creating-queues)

#### Cloud Run

**Enable Google Cloud Datastore Service:** \
$ `gcloud services enable run.googleapis.com`

#### Cloud Storage

**Enable Google Cloud Storage Service:** \
$ `gcloud services enable storage-component.googleapis.com`

**Cloud Bucket** \
Create a Google Cloud Bucket where all images will be stored. \
$ `gsutil mb gs://[BUCKET_NAME]/` \
[Additional documentation on creating Google Cloud Buckets.](https://cloud.google.com/storage/docs/creating-buckets#storage-create-bucket-gsutil)

### Google Marketing Platform

Create a Campaign Manager User Profile with the service account's email address
with the respective role: * Agency Trafficker

Use the service account's email address you are using for the Cloud Run service.
By default this is the Compute Engine default service account.

## Deploy

There's two ways to deploy this solution, directly from the built image on
Google Cloud Container Registry or build and deploy from source.

By default, Cloud Run revisions are using the Compute Engine default service
account `(PROJECT_NUMBER-compute@developer.gserviceaccount.com)`. You can change
this identity. \
If you change it, make sure a Campaign Manager User Profile is created with this
service account email address.

### From GCR:

\$ `gcloud alpha run deploy [SERVICE_NAME] --image gcr.io/$(gcloud config
get-value project)/$npm_package_config_service_name --memory 2G
--update-env-vars CLOUD_PROJECT_ID=$(gcloud config get-value
project),CLOUD_RUN_REGION=us-central1,CLOUD_BUCKET=[CLOUD_BUCKET],FILE_PATH_PATTERN="{accountId}/{advertiserId}/{campaignId}/{placementId}_{index}.jpg",SCREENSHOT_PADDING=16,SCREENSHOT_QUALITY=100,MS_BEFORE_SCREENSHOT=1000,MS_BEFORE_SCREENSHOT_INSTREAM=8000,NUMBER_OF_SCREENSHOTS=1`

### From Source:

To build the image use: \$ `npm run cloud-run-build` To deploy the built image:
\$ `npm run cloud-run-deploy-only`

To build and deploy: \$ `npm run cloud-run-deploy`

## Configuration

When deploying the application from NPM you can update the configuration in
package.json under config, otherwise add it to the --update-env-vars of the
gcloud deploy command.

Property                      | Description                                                                                                                                                                                                                                                                                | Default Value
----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------
CLOUD_BUCKET                  | Name of the Cloud Bucket all files are saved to. Files are saved in the structure defined by file path pattern.                                                                                                                                                                            | N/A
FILE_PATH_PATTERN             | All images are saved using this file pattern, bracketed values are replaced with actual ids.                                                                                                                                                                                               | {accountId}/{advertiserId}/{campaignId}/{placementId}\_{index}.jpg
SCREENSHOT_PADDING            | Total number of padding pixels around the screenshot, 16 results in 8 on each side.                                                                                                                                                                                                        | 16
SCREENSHOT_QUALITY            | JPG Quality setting.                                                                                                                                                                                                                                                                       | 100
MS_BEFORE_SCREENSHOT          | Milliseconds before taking a screenshot, this allows for a bit of the animation to start before taking a screenshot. This value is ignored if NUMBER_OF_SCREENSHOTS > 1.                                                                                                                   | 1000
MS_BEFORE_SCREENSHOT_INSTREAM | Milliseconds before taking a screenshot of a Video INSTREAM tag. This value is ignored if NUMBER_OF_SCREENSHOTS > 1.                                                                                                                                                                       | 8000
NUMBER_OF_SCREENSHOTS         | Number of screenshots to take for each placement. Display Ads will use a default of 15 second animation devided by NUMBER_OF_SCREENSHOTS. INSTREAM/VAST tags will use media duration devided by NUMBER_OF_SCREENSHOTS. Screenshot index can be captured in the file path by using {index}. | 1

## Run

For all Advertisers the service account has access to:<br />
**POST**<br />
`https://SERVICE_ENDPOINT/list-advertisers`<br />
```
{
  "profileId": 000000
}
```


For a specific advertiser:<br />
**POST**<br />
`https://SERVICE_ENDPOINT/list-placements`<br />
```
{
  "profileId": 000000,
  "advertiserId": 000000
}
```
