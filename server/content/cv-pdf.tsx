import "server-only";
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { cv } from "@/content/cv";
import { site } from "@/content/site";
import { work } from "@/content/work";
import { registerPdfFonts } from "@/server/pdf/fonts";

// The CV as a PDF, generated from the same data as the /cv page.
registerPdfFonts();

const INK = "#111317";
const MUTED = "#5b606b";
const LINE = "#e3e5e8";
const ACCENT = "#0b6a80";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10,
    color: INK,
    paddingVertical: 42,
    paddingHorizontal: 48,
    lineHeight: 1.45,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  name: { fontSize: 24, fontWeight: 600, letterSpacing: -0.4 },
  headline: { fontSize: 12, color: MUTED, marginTop: 2 },
  contact: { textAlign: "right", color: MUTED, fontSize: 9.5 },
  link: { color: ACCENT, textDecoration: "none" },
  section: { flexDirection: "row", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, marginTop: 10 },
  label: {
    width: 96,
    fontSize: 8,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingTop: 2,
  },
  body: { flex: 1 },
  strong: { fontWeight: 600 },
  muted: { color: MUTED },
  bullet: { flexDirection: "row", marginTop: 2 },
  dot: { width: 10, color: MUTED },
});

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function CvDocument() {
  const featured = work.filter((item) => item.featured);
  return (
    <Document title={`${site.name} – CV`} author={site.name} subject={cv.headline}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.name}>{site.name}</Text>
            <Text style={styles.headline}>{cv.headline}</Text>
          </View>
          <View style={styles.contact}>
            <Link src={`mailto:${site.email}`} style={styles.link}>
              {site.email}
            </Link>
            <Link src={site.github} style={styles.link}>
              github.com/{site.handle}
            </Link>
            <Link src={site.origin} style={styles.link}>
              {site.origin.replace("https://", "")}
            </Link>
            <Text>{site.location} · remote</Text>
          </View>
        </View>

        <Section label="Summary">
          <Text>{cv.summary}</Text>
        </Section>

        <Section label="Experience">
          {cv.experience.map((job) => (
            <View key={job.role}>
              <Text>
                <Text style={styles.strong}>{job.role}</Text>
                <Text style={styles.muted}>
                  {"  "}
                  {job.place} · {job.period}
                </Text>
              </Text>
              {job.points.map((point) => (
                <View key={point} style={styles.bullet}>
                  <Text style={styles.dot}>•</Text>
                  <Text style={styles.body}>{point}</Text>
                </View>
              ))}
            </View>
          ))}
        </Section>

        <Section label="Projects">
          {featured.map((item) => (
            <View key={item.slug} style={{ marginBottom: 4 }}>
              <Text>
                <Link src={`${site.origin}/work/${item.slug}`} style={[styles.link, styles.strong]}>
                  {item.title}
                </Link>
                <Text style={styles.muted}> · {item.year}</Text>
              </Text>
              <Text style={styles.muted}>{item.tagline}</Text>
            </View>
          ))}
        </Section>

        <Section label="Skills">
          {cv.skills.map((skill) => (
            <Text key={skill.group}>
              <Text style={styles.strong}>{skill.group}: </Text>
              {skill.items.join(", ")}
            </Text>
          ))}
        </Section>

        <Section label="Education">
          {cv.education.map((entry) => (
            <Text key={entry.place}>
              <Text style={styles.strong}>{entry.place}</Text>
              <Text style={styles.muted}> · {entry.detail}</Text>
            </Text>
          ))}
        </Section>

        <Section label="Languages">
          <Text>
            {cv.languages.map((language) => `${language.name} (${language.level.toLowerCase()})`).join(" · ")}
          </Text>
        </Section>
      </Page>
    </Document>
  );
}

export function renderCvPdf(): Promise<Buffer> {
  return renderToBuffer(<CvDocument />);
}
