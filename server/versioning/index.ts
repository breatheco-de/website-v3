export {
  VersioningManager,
  getVersioningManager,
} from "./VersioningManager";
export type {
  VariantContentResult,
  VariantContentSuccess,
  VariantContentFailure,
} from "./VersioningManager";
export {
  readUserId,
  getVersioningCookie,
  setVersioningCookie,
  buildUserContext,
  hashUserId,
} from "./cookie-utils";
export type { VersioningAssignment, VersioningCookie } from "./cookie-utils";
