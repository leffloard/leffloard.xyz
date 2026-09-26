import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/admin/auth-frame";
import { cookieName } from "@/server/auth/cookies";
import { currentAdmin, requireAccess } from "@/server/auth/dal";
import { findAuthToken } from "@/server/auth/tokens";
import { getDb } from "@/server/db/client";
import { SecondFactorForm } from "./second-factor-form";

export const metadata = { title: "Authenticator code" };

export default async function VerifyPage() {
  await requireAccess();
  if (await currentAdmin()) redirect("/admin");
  const token = (await cookies()).get(cookieName("pending"))?.value;
  if (!(await findAuthToken(await getDb(), token, "login-2fa"))) redirect("/admin/login");
  return (
    <AuthFrame title="Two-step check" description="Enter the 6-digit code from your authenticator app.">
      <SecondFactorForm />
    </AuthFrame>
  );
}
