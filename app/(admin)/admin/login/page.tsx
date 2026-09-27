import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/admin/auth-frame";
import { currentAdmin, requireAccess } from "@/server/auth/dal";
import { getEnv } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await requireAccess();
  if (await currentAdmin()) redirect("/admin");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <AuthFrame title="Sign in" description="Password and authenticator code, or a passkey.">
      <LoginForm turnstileSiteKey={getEnv().TURNSTILE_SITE_KEY} nonce={nonce} />
    </AuthFrame>
  );
}
