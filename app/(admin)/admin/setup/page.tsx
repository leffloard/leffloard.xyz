import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/admin/auth-frame";
import { cookieName } from "@/server/auth/cookies";
import { currentAdmin, requireAccess } from "@/server/auth/dal";
import { pendingSetup } from "@/server/auth/login";
import { getDb } from "@/server/db/client";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up two-step sign-in" };

export default async function SetupPage() {
  await requireAccess();
  // Finishing the setup signs in, and Next.js then renders this page again. It must not redirect at that
  // moment: the form is still showing the recovery codes, which exist nowhere else.
  const admin = await currentAdmin();
  const setup = admin
    ? null
    : await pendingSetup(await getDb(), (await cookies()).get(cookieName("pending"))?.value);
  if (!admin && !setup) redirect("/admin/login");
  return (
    <AuthFrame
      title="Set up two-step sign-in"
      description="Every sign-in needs a code from an authenticator app (Google Authenticator, 1Password, Aegis…)."
    >
      <SetupForm
        setup={setup ? { qrCode: setup.qrCode, secret: setup.secret } : null}
        email={admin?.user.email ?? setup!.email}
      />
    </AuthFrame>
  );
}
