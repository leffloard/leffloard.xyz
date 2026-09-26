// Plain-English names for audit log actions, shown on the admin's activity list.
const LABELS: Record<string, string> = {
  "auth.login.failed": "Failed sign-in",
  "auth.login.succeeded": "Signed in",
  "auth.login.locked": "Password sign-in locked",
  "auth.second_factor.failed": "Wrong authenticator code",
  "auth.passkey.failed": "Passkey check failed",
  "auth.logout": "Signed out",
  "auth.session.revoked": "Session signed out remotely",
  "auth.sudo.confirmed": "Confirmed identity",
  "auth.sudo.failed": "Identity check failed",
  "auth.password.changed": "Password changed",
  "auth.totp.enabled": "Authenticator app set up",
  "auth.totp.replaced": "Authenticator app replaced",
  "auth.recovery_codes.generated": "New recovery codes created",
  "auth.recovery_code.used": "Recovery code used",
  "auth.passkey.added": "Passkey added",
  "auth.passkey.renamed": "Passkey renamed",
  "auth.passkey.removed": "Passkey removed",
  "auth.lockout.cleared": "Sign-in lock cleared",
  "auth.access.denied": "Blocked by Cloudflare Access check",
  "admin.owner.created": "Owner account created",
  "admin.owner.password_reset": "Password reset from the server",
  "admin.owner.second_factors_reset": "Two-step sign-in reset from the server",
};

const WARNINGS = new Set([
  "auth.login.failed",
  "auth.login.locked",
  "auth.second_factor.failed",
  "auth.passkey.failed",
  "auth.sudo.failed",
  "auth.access.denied",
]);

export function auditLabel(action: string): string {
  return LABELS[action] ?? action;
}

export function isWarningAction(action: string): boolean {
  return WARNINGS.has(action);
}
