# Media Storage (Google Cloud Storage)

The platform supports a pluggable media storage system. By default, images are stored locally in `site_*/images/` (per-site content folder). You can optionally configure Google Cloud Storage (GCS) for cloud-based hosting.

## Prerequisites

1. A Google Cloud project with the Cloud Storage API enabled.
2. A GCS bucket (e.g. `my-project-images`).
3. A service account with **Storage Object Admin** (`roles/storage.objectAdmin`) permission on the bucket.
4. The service account key exported as JSON.

## Setting Up the Bucket

1. **Create a bucket** in the Google Cloud Console (or via `gsutil`):

   ```bash
   gsutil mb -p YOUR_PROJECT_ID gs://YOUR_BUCKET_NAME
   ```

2. **Make the bucket publicly readable** so images can be served directly:

   ```bash
   gsutil iam ch allUsers:objectViewer gs://YOUR_BUCKET_NAME
   ```

3. **Create a service account** and download its key:

   ```bash
   gcloud iam service-accounts create media-uploader \
     --display-name="Media Uploader"

   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:media-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/storage.objectAdmin"

   gcloud iam service-accounts keys create key.json \
     --iam-account=media-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com
   ```

4. **Copy the contents** of `key.json` -- you will paste the entire JSON into the `GCS_CREDENTIALS_JSON` environment variable.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GCS_BUCKET_NAME` | Yes | -- | Name of the GCS bucket |
| `GCS_PROJECT_ID` | Yes | -- | Google Cloud project ID |
| `GCS_CREDENTIALS_JSON` | Yes | -- | Full JSON contents of the service account key file |
| `GCS_BASE_PATH` | No | `media` | Folder prefix inside the bucket (all uploads go under this path) |
| `MEDIA_DEFAULT_PROVIDER` | No | `local` | Set to `gcs` to make cloud storage the default for new uploads |

## How It Works

- When `GCS_BUCKET_NAME` is set, the GCS provider is automatically registered alongside the local provider.
- All files uploaded to GCS are stored under the `media/` folder by default (configurable via `GCS_BASE_PATH`). For example: `https://storage.googleapis.com/YOUR_BUCKET_NAME/media/your-image.png`.
- The system auto-detects which provider owns an image based on its URL prefix, so local and cloud images can coexist in the same registry.
- The default storage provider remains `local` unless you set `MEDIA_DEFAULT_PROVIDER=gcs`.

## Migrating Existing Images to GCS

You can migrate local images to GCS using the API endpoint:

```bash
# Dry run (preview what would be migrated)
curl -X POST http://localhost:5000/api/image-registry/migrate \
  -H "Content-Type: application/json" \
  -d '{"from": "local", "to": "gcs", "dryRun": true}'

# Actual migration
curl -X POST http://localhost:5000/api/image-registry/migrate \
  -H "Content-Type: application/json" \
  -d '{"from": "local", "to": "gcs"}'
```

The migration preserves directory structure, updates the image registry, and replaces all references in YAML content files automatically.

## Image Optimization Backfill

Generate optimized WebP/AVIF variants and populate `srcset`, `width`, `height`, and `format` metadata for all registry images:

```bash
# Authenticate with Google Cloud (if not using service account key)
gcloud auth application-default login

# Dry run (preview changes, no uploads)
npx tsx scripts/backfill-images.ts --dry-run

# Process all images
npx tsx scripts/backfill-images.ts

# Process a limited batch
npx tsx scripts/backfill-images.ts --limit=50

# Re-process already-processed entries
npx tsx scripts/backfill-images.ts --force
```

Requires `GCS_BUCKET_NAME` and GCS credentials configured in the environment.

## Extensibility

The storage provider system is designed for future expansion. Additional providers (AWS S3, Azure Blob, Cloudflare R2) can be added by implementing the `StorageProvider` interface in `server/media/types.ts`.
