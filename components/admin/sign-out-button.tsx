import { logoutAction } from "@/app/(admin)/admin/(shell)/actions";
import { buttonClasses } from "@/components/ui/button";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={buttonClasses("ghost", "sm", className)}>
        Sign out
      </button>
    </form>
  );
}
