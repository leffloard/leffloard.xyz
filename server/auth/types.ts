import type { Binary, ObjectId } from "mongodb";
import type { StoredRecoveryCode } from "@/server/security/recovery-codes";

export type AuthMethod = "password" | "totp" | "recovery" | "passkey";

export type UserDoc = {
  _id: ObjectId;
  email: string; // lower case
  name: string;
  role: "owner";
  passwordHash: string;
  passwordChangedAt: Date;
  // The secret is encrypted with the context "totp:<user id>".
  totp: { secret: string; enabledAt: Date; lastUsedStep: number } | null;
  recoveryCodes: StoredRecoveryCode[];
  createdAt: Date;
  updatedAt: Date;
};

// What pages and actions may see of the signed-in user: never hashes or secrets.
export type PublicUser = {
  id: string;
  email: string;
  name: string;
  hasTotp: boolean;
  recoveryCodesLeft: number;
  passwordChangedAt: Date;
};

export type SessionDoc = {
  _id: string; // SHA-256 of the cookie token; the token itself is never stored
  userId: ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  sudoUntil: Date | null;
  ip: string;
  userAgent: string;
  methods: AuthMethod[];
};

export type AuthTokenPurpose =
  "login-2fa" | "setup-2fa" | "webauthn-login" | "webauthn-register" | "totp-replace";

export type AuthTokenDoc = {
  _id: string; // SHA-256 of the token
  purpose: AuthTokenPurpose;
  userId: ObjectId | null;
  sessionId: string | null; // for tokens that belong to a signed-in session
  data: { secret?: string; challenge?: string };
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
};

export type PasskeyDoc = {
  _id: string; // credential id (base64url)
  userId: ObjectId;
  publicKey: Binary;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type AuditAction =
  | "auth.login.failed"
  | "auth.login.succeeded"
  | "auth.login.locked"
  | "auth.second_factor.failed"
  | "auth.passkey.failed"
  | "auth.logout"
  | "auth.session.revoked"
  | "auth.sudo.confirmed"
  | "auth.sudo.failed"
  | "auth.password.changed"
  | "auth.totp.enabled"
  | "auth.totp.replaced"
  | "auth.recovery_codes.generated"
  | "auth.recovery_code.used"
  | "auth.passkey.added"
  | "auth.passkey.renamed"
  | "auth.passkey.removed"
  | "auth.lockout.cleared"
  | "auth.access.denied"
  | "admin.owner.created"
  | "admin.owner.password_reset"
  | "admin.owner.second_factors_reset"
  | "inbox.inquiry.deleted"
  | "inbox.sender.blocked"
  | "inbox.sender.unblocked"
  | "inbox.legacy.migrated"
  | "clients.client.exported"
  | "clients.client.deleted"
  | "projects.project.deleted"
  | "billing.bank.changed"
  | "billing.invoice.voided"
  | "billing.payment.recorded"
  | "billing.payment.refunded"
  | "finance.exported"
  | "content.published"
  | "content.deleted"
  | "ai.settings.changed";

export type AuditDoc = {
  _id: ObjectId;
  at: Date;
  action: AuditAction;
  actorId: ObjectId | null;
  ip: string;
  userAgent: string;
  details: Record<string, string | number | boolean | null>;
};
