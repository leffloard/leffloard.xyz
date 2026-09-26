import Link from "next/link";
import { BookingTypeEditor } from "@/components/admin/calendar/booking-type-editor";
import { PageHeader } from "@/components/admin/shell";
import { requireAdmin } from "@/server/auth/dal";
import { bookingPath, listBookingTypes, meetingCountsByType } from "@/server/calendar/booking-types";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

export const metadata = { title: "Booking types" };

export default async function BookingTypesPage() {
  await requireAdmin();
  const db = await getDb();
  const [types, counts] = await Promise.all([listBookingTypes(db), meetingCountsByType(db)]);
  const siteUrl = getEnv().SITE_URL;
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/calendar"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Calendar
        </Link>
      </div>
      <PageHeader
        title="Booking types"
        description="The calls people can book. Changes apply to new bookings; booked meetings keep their details."
      />
      <div className="grid gap-6">
        {types.map((type) => {
          const id = type._id.toHexString();
          return (
            <BookingTypeEditor
              key={id}
              id={id}
              siteUrl={siteUrl}
              link={`${siteUrl}${bookingPath(type)}`}
              meetings={counts.get(id) ?? 0}
              initial={{
                slug: type.slug,
                title: type.title,
                description: type.description,
                durationMinutes: type.durationMinutes,
                visibility: type.visibility,
                requiresApproval: type.requiresApproval,
                location: type.location.kind,
                locationDetails: type.location.details,
                questions: type.questions.map((question) => ({
                  label: question.label,
                  required: question.required,
                })),
                active: type.active,
              }}
            />
          );
        })}
        <BookingTypeEditor siteUrl={siteUrl} />
      </div>
    </>
  );
}
