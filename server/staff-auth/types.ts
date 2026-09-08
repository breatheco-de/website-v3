export type AuthProviderId = "github";

export interface AuthIdentity {
  provider: AuthProviderId | string;
  /** Immutable id from the provider (GitHub numeric user id as string). */
  providerUserId: string;
  verifiedEmails: string[];
  displayName?: string;
  /** Current handle (@login) for display and commits. */
  handle?: string;
  primaryEmail?: string;
}

export interface AuthConnectorPublic {
  id: string;
  label: string;
}

export interface AuthConnector extends AuthConnectorPublic {
  isConfigured: () => boolean;
}

export type AdmissionErrorCode =
  | "auth_email_unverified"
  | "staff_identity_ambiguous"
  | "staff_not_pre_registered"
  | "staff_no_role";

export interface AdmissionOk {
  ok: true;
  username: string;
  staffId: string;
}

export interface AdmissionFail {
  ok: false;
  code: AdmissionErrorCode;
  error: string;
}

export type AdmissionResult = AdmissionOk | AdmissionFail;
