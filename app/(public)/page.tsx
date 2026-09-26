export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="font-mono text-xs tracking-[0.08em] text-muted uppercase">leffloard.xyz · v2</p>
      <h1 className="text-5xl leading-[0.95] font-semibold tracking-tight sm:text-7xl">
        A new site is being built here.
      </h1>
      <p className="max-w-xl text-lg text-muted">
        Websites, web apps, Discord bots, authentication systems and desktop software — by Mert Kaan Koparan,
        independent developer since 2018.
      </p>
      <p className="font-mono text-sm text-accent">
        <a className="underline-offset-4 hover:underline" href="mailto:erzincanligotik@gmail.com">
          erzincanligotik@gmail.com
        </a>
      </p>
    </main>
  );
}
