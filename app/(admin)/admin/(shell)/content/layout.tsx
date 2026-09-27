import { TabNav } from "@/components/admin/tab-nav";

// The content section's tabs. Each page below still checks the session itself.
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabNav
        label="Content"
        tabs={[
          { href: "/admin/content", label: "Overview" },
          { href: "/admin/content/work", label: "Work" },
          { href: "/admin/content/post", label: "Blog" },
          { href: "/admin/content/service", label: "Services" },
          { href: "/admin/content/testimonial", label: "Testimonials" },
          { href: "/admin/content/profile", label: "Profile" },
          { href: "/admin/content/cv", label: "CV" },
          { href: "/admin/content/pricing", label: "Pricing terms" },
          { href: "/admin/content/media", label: "Media" },
          { href: "/admin/content/github", label: "GitHub" },
          { href: "/admin/content/settings", label: "Leak check" },
        ]}
      />
      {children}
    </>
  );
}
