// Facts about the owner shown across the public site. Until the CMS (M9) these live in code.
export const site = {
  name: "Mert Kaan Koparan",
  firstName: "Mert",
  handle: "leffloard",
  role: "Independent software developer",
  location: "Denizli, Turkey",
  timeZone: "Europe/Istanbul",
  timeZoneLabel: "UTC+3",
  email: "erzincanligotik@gmail.com",
  github: "https://github.com/leffloard",
  origin: "https://leffloard.xyz",
  since: 2018,
  availability: { open: true, label: "Taking new projects" },
  // One sentence used for descriptions and social previews.
  pitch:
    "Websites, web apps, Discord bots, authentication systems and desktop software, built carefully by an independent developer.",
} as const;

export const navigation = [
  { href: "/work", label: "Work" },
  { href: "/services", label: "Services" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
] as const;

export const process = [
  {
    title: "Brief",
    text: "You describe the problem in your own words. I ask the questions that change the estimate, and say early if something is not a good fit.",
  },
  {
    title: "Proposal",
    text: "A written scope, fixed price and timeline, split into milestones you can check. Nothing starts before you agree to it.",
  },
  {
    title: "Build",
    text: "Work happens in milestones with a preview after each one. You always know what is done, what is next and what is waiting on you.",
  },
  {
    title: "Launch and care",
    text: "Deployment, handover and documentation. The code is yours. An optional care plan keeps it updated and monitored.",
  },
] as const;
