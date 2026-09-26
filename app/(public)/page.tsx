export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-muted font-mono text-xs tracking-[0.08em] uppercase">leffloard.xyz · v2</p>
      <h1 className="text-5xl leading-[0.95] font-semibold tracking-tight sm:text-7xl">
        A new site is being built here.
      </h1>
      <p className="text-muted max-w-xl text-lg">
        Websites, web apps, Discord bots, authentication systems and desktop software — by Mert Kaan Koparan,
        independent developer since 2018.
      </p>
      <p className="text-accent font-mono text-sm">
        <a className="underline-offset-4 hover:underline" href="mailto:erzincanligotik@gmail.com">
          erzincanligotik@gmail.com
        </a>
      </p>
    </main>
  );
}
