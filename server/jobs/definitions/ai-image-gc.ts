import { Job } from "sidequest";
import * as path from "path";
import { MediaGallery } from "../../media-gallery";
import {
  unregisterAiImageAndEmit,
  type AiImageGcPayload,
} from "../ai-image-gc-shared";
import { child } from "../../logger";

const log = child({ module: "job:ai-image-gc" });

export class AiImageGcJob extends Job {
  async run(payload: AiImageGcPayload): Promise<{ ok: boolean; deleted?: boolean; reason?: string }> {
    const { site, contentRoot, imageId } = payload;
    if (!site || !contentRoot || !imageId) {
      return { ok: true, deleted: false, reason: "invalid_payload" };
    }

    const contentRootName = path.isAbsolute(contentRoot)
      ? path.relative(process.cwd(), contentRoot)
      : contentRoot;
    const gallery = new MediaGallery(contentRootName);
    const folderName = path.basename(contentRootName);
    const result = await unregisterAiImageAndEmit({
      gallery,
      site,
      imageId,
      registryRelativePath: `${folderName}/image-registry.json`,
    });

    log.info(
      { site, imageId, deleted: result.deleted, reason: result.reason },
      "[AiImageGcJob] finished",
    );
    return { ok: true, ...result };
  }
}
