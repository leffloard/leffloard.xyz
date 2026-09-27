export const personalInfo = {
  name: "Mert Kaan Koparan",
  title: "Full Stack Developer",
  tagline: "Building elegant solutions to complex problems",
  email: "erzincanligotik@gmail.com",
  phone: "+90 (541) 644-6234",
  location: "Denizli, TR",
  avatar: "https://i.imgur.com/nnjhGTt.png",
  bio: "Passionate software engineer with 5+ years of experience in building scalable web applications. I specialize in modern JavaScript frameworks and love creating intuitive user experiences. When I'm not coding, you'll find me exploring new technologies or contributing to open-source projects.",
  resumeUrl: "#",
  social: {
    github: "https://github.com/leffloard",
    linkedin: "https://linkedin.com/leffloard",
    twitter: "https://x.com/leffloard",
    portfolio: "https://sense.sellhub.cx"
  }
};

export const skills = [
  { name: "JavaScript", category: "Languages", level: 80 },
  { name: "TypeScript", category: "Languages", level: 55 },
  { name: "Python", category: "Languages", level: 80 },
  { name: "React", category: "Frontend", level: 95 },
  { name: "Next.js", category: "Frontend", level: 85 },
  { name: "Tailwind CSS", category: "Frontend", level: 90 },
  { name: "Node.js", category: "Backend", level: 88 },
  { name: "FastAPI", category: "Backend", level: 80 },
      { name: "C++", category: "Backend", level: 85 },
          { name: "C", category: "Backend", level: 76 },
              { name: "C#", category: "Backend", level: 45 },
    { name: "PHP", category: "Backend", level: 65 },
  { name: "MongoDB", category: "Database", level: 97 },
  { name: "PostgreSQL", category: "Database", level: 82 },
  { name: "Docker", category: "DevOps", level: 80 },
  { name: "AWS", category: "DevOps", level: 75 },
  { name: "Git", category: "Tools", level: 95 },
  { name: "Figma", category: "Tools", level: 70 }
];

export const experience = [
  {
    id: 1,
    title: "Senior Full Stack Developer",
    company: "Sense Software Inc.",
    location: "Remote",
    startDate: "Jan 2022",
    endDate: "Present",
    description: "Leading development of cloud-native applications using React and Node.js. Architected microservices infrastructure serving 1M+ users.",
    achievements: [
      "Reduced application load time by 60% through optimization",
      "Mentored 5 junior developers",
      "Implemented CI/CD pipelines reducing deployment time by 80%"
    ]
  },
  {
    id: 2,
    title: "Full Stack Developer",
    company: "GoITeens",
    location: "Remote",
    startDate: "Jun 2020",
    endDate: "Dec 2023",
    description: "Built scalable web applications from ground up. Worked closely with design team to create pixel-perfect interfaces.",
    achievements: [
      "Developed 3 major features that increased user engagement by 40%",
      "Integrated payment systems processing $2M+ annually",
      "Maintained 99.9% uptime for production services"
    ]
  },
  {
    id: 3,
    title: "Discord Bot Automation",
    company: "Freelance",
    location: "Remote",
    startDate: "Aug 2018",
    endDate: "Present",
    description: "Developed advanced Discord bots with automated systems, moderation tools, and scalable architectures. Built features using modern JavaScript and Python ecosystems, focusing on performance, reliability, and ease of use.",
    achievements: [
      "Created 25+ custom Discord bots for community management, gaming servers, and business automation",
      "Integrated APIs, database systems, and real-time event handlers to support high-activity servers",
      "Designed modular and reusable command/event structures for long-term maintainability",
      "Implemented auto-moderation, ticketing, logging, and role-management systems used by 10k+ users"
    ]
  }

];

export const projects = [
  {
    id: 1,
    title: "AI Task Manager",
    description: "Smart task management app with AI-powered prioritization and scheduling.",
    longDescription: "A comprehensive task management solution that uses machine learning to predict task completion times and automatically prioritize your workload. Built with React, Node.js, and OpenAI API.",
    image: "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=800&q=80",
    tags: ["React", "Node.js", "AI", "MongoDB"],
    liveUrl: "https://example.com",
    githubUrl: "https://github.com",
    featured: true
  },
  {
    id: 2,
    title: "Real-time Flask Invoice Analytics Dashboard",
    description: "Analytics platform with real-time data visualization and reporting.",
    longDescription: "Enterprise-grade analytics dashboard featuring real-time data streaming, interactive charts, and customizable reports. Handles millions of events per day with sub-second latency.",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80",
    tags: ["Flask", "Python", "HTML", "SQLite"],
    liveUrl: "https://github.com/leffloard/flask-invoice",
    githubUrl: "https://github.com/leffloard/flask-invoice",
    featured: true
  },
  {
    id: 3,
    title: "E-commerce Platform",
    description: "Full-featured online store with payment integration and inventory management.",
    longDescription: "Modern e-commerce solution with features including product catalog, shopping cart, payment processing, order tracking, and admin dashboard. Supports multiple payment gateways.",
    image: "https://images.unsplash.com/photo-1557821552-17105176677c?w=800&q=80",
    tags: ["Next.js", "Stripe", "Tailwind", "MongoDB"],
    liveUrl: "https://sense.sellhub.cx",
    githubUrl: "https://sense.sellhub.cx",
    featured: true
  },
  {
    id: 4,
    title: "Social Media App (unfinished)",
    description: "Social networking platform with real-time messaging and content sharing.",
    longDescription: "Full-stack social media application featuring user profiles, posts, likes, comments, real-time chat, and notification system. Built for scalability and performance.",
    image: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80",
    tags: ["React", "Socket.io", "Express", "Redis"],
    liveUrl: "https://example.com",
    githubUrl: "https://github.com",
    featured: false
  }
];

export const education = [
  {
    id: 1,
    degree: "Bachelor of Science in Computer Science",
    school: "University of California",
    location: "Berkeley, CA",
    startDate: "2027",
    endDate: "2031",
    description: "Graduated with honors. Focused on software engineering and algorithms.",
    achievements: [
      "GPA: 3.8/4.0",
      "Dean's List all semesters",
      "President of Computer Science Club"
    ]
  },
  {
    id: 2,
    degree: "Full Stack Web Development Bootcamp",
    school: "GoITeens",
    location: "Online",
    startDate: "2023",
    endDate: "2024",
    description: "Intensive 12-week program covering modern web development technologies.",
    achievements: [
      "Top 5% of cohort",
      "Built 10+ full-stack projects",
      "Received job placement assistance"
    ]
  }
];

export const certifications = [
  {
    id: 1,
    name: "World-Wide Valid Python Expertisement",
    issuer: "GoITeens",
    date: "2024",
    credentialUrl: "#"
  },
  {
    id: 2,
    name: "Professional C++ Kernel Developing I",
    issuer: "learncpp.com",
    date: "2025",
    credentialUrl: "#"
  }
];

export const blogPosts = [
  {
    id: 1,
    title: "Building High-Performance Discord Bots in 2025",
    excerpt: "A practical look at structuring Discord bots for speed, scalability, and clean maintainability.",
    content: `
    # Building High-Performance Discord Bots in 2025

    Discord bots are more popular than ever, and with new advancements in both the Discord API and available frameworks, bot developers in 2025 face a unique set of choices and challenges. In this article, I'll cover my approach to building Discord bots that are not just powerful, but scalable and maintainable for the long haul.

    ## Why Performance Matters

    As communities grow, the number of concurrent messages, reactions, and commands bots must process increases dramatically. A laggy moderation response or slow command feedback can cause frustration. In professional settings (education, commerce, support), reliable bot speed is not optional.

    ## Core Strategies for High-Performance Bots

    1. **Architecting With Scale in Mind**  
    Use a modular structure. Separate command handling, event listening, and background jobs. Define clear interfaces for each module. Don’t jam everything into one file.

    2. **Offload Heavy Work**  
    Long-running or expensive tasks, such as fetching external API data or generating reports, should be handled asynchronously. Leverage worker threads, use message queues (like RabbitMQ, if needed), and respond to users with instant feedback (like a loading reaction) while processing in the background.

    3. **Optimize for Events, Not Just Commands**  
    Modern bots respond to far more than commands—they monitor edits, reacts, role changes, and other activity. Prioritize efficient filtering and early exits in your event listeners. Only process what’s needed!

    4. **Cache Everything You Can, but Wisely**  
    The Discord Gateway delivers a torrent of data, but not all of it needs to be kept in memory. Cache active guild/member/channel data, but implement cache sweeping to keep memory usage manageable.

    5. **Utilize Sharding for Massive Scale**  
    Discord bots serving many servers must use sharding. In 2025, libraries like discord.js and Sapphire make this easy. Shard intelligently based on guild load.

    ## Technology Stack

    - **Language:** JavaScript (Node.js 20+ by 2025), with some modules in TypeScript.
    - **Libraries:** discord.js v16+, Sapphire, optional modules for music, moderation, AI, etc.
    - **Databases:** MongoDB for guild/user preferences, Redis for caching and job queues.
    - **Deployment:** Docker containers, managed with Kubernetes or Docker Swarm.
    - **CI/CD:** GitHub Actions deploy on push, with automated testing using Jest.

    ## Example: A Fast Reaction Role System

    In 2025, Discord’s API allows even more efficient reaction collection. Here’s how I structure a performant reaction role handler:

    \`\`\`js
    client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      const config = await ReactionRoleConfig.findOne({ messageId: reaction.message.id });
      if (!config) return;
      // ... assign role
    });
    \`\`\`

    Optimize by keeping a set of message IDs requiring reaction role handling in memory, and only querying the database if the message ID is in that set.

    ## Monitoring Performance

    - Use Prometheus or New Relic to monitor latency and error rates.
    - Add internal logging for command execution times, event processing lag, and queue depths.

    ## Deployment Tips

    - **Horizontal Scaling:** With sharding and containers, you can run multiple instances for high availability.
    - **Configuration and Secrets:** Store sensitive credentials in Kubernetes secrets or equivalent.

    ## The Future

    Discord bots will only become more powerful as API capabilities expand. Focus on maintainability as much as raw speed—solid, modular codebases will last through Discord’s inevitable future updates.

    *Happy building!*
    `,
    image: "https://images.unsplash.com/photo-1551033406-611cf9a28f67?w=800&q=80",
    date: "2025-01-04",
    readTime: "7 min read",
    tags: ["Discord", "Automation", "JavaScript"]
  },
  {
    id: 2,
    title: "Why Unreal Engine 5 Optimization Still Matters",
    excerpt: "From game development to tool creation, UE5 optimization techniques can drastically improve runtime performance.",
    content: `
    # Why Unreal Engine 5 Optimization Still Matters

    The introduction of Unreal Engine 5 brought revolutionary rendering with Nanite and Lumen, and a host of new productivity tools. Yet even in 2025, optimization remains critical for both AAA gaming and smaller studio or solo dev projects.

    ## The "Myth" of Infinite Power

    Developers often believe that modern engines and hardware can brute-force their way through performance issues. However, the reality is that bottlenecks in memory, bandwidth, or CPU cycles will still tank frame rates or inflate build sizes, especially on lower-end devices and consoles.

    ## Key Areas for Optimization

    1. **Asset Management**  
    With Nanite, it's tempting to import millions of triangles everywhere. But overusing detailed assets for background objects wastes resources. Use LODs and culling carefully—don't lean on defaults.

    2. **Lighting**  
    Lumen enables real-time global illumination, but improperly placed light sources or maxed-out settings can cause severe performance drops. Profile your maps regularly and leverage baked lighting when possible.

    3. **Blueprints vs. C++**  
    Blueprints are fast for prototyping, but core gameplay systems and performance-critical logic should be migrated to C++. In 2025, hybrid approaches (heavy Blueprint front-end, C++ backend) dominate.

    4. **Animation & Physics**  
    Physics constraints add realism, but too many simulate bodies or unnecessary tick updates are a silent drain. Profile and optimize physics sub-steps and tick intervals as part of your regular workflow.

    ## Tools for the Job

    - **Unreal Insights**: Record and analyze performance sessions easily.
    - **Stat Commands**: \`stat unit\`, \`stat gpu\`, etc. to identify where time is spent.
    - **Material Complexity Views**: Ensure you aren’t overloading the GPU on every pixel.

    ## Optimizing for Platforms

    Cross-platform builds are the norm. Mobile, PC, and next-gen consoles all have different sweet spots for draw calls, texture streaming, and shader complexity. Test on all targets and create platform-specific settings when needed.

    ## Best Practices in Pipeline

    - Use Perforce or Git LFS for fast, reliable version control.
    - Automate builds and asset checks via CI/CD to catch performance regressions before QA.
    - Educate your team about profiling early—not just at the end!

    ## The Human Side

    Optimization isn't just technical—it’s a collaboration between artists, programmers, and designers. Build a shared vocabulary about bottlenecks and what “good” performance looks like for your project.

    ## The Bottom Line

    Unreal Engine 5 gives us more power than ever, but optimization is still just as essential. Smart resource management, regular profiling, and team discipline separate great experiences from sluggish ones.

    *Keep creating, and never stop profiling!*
    `,
    image: "https://images.unsplash.com/photo-1527443154391-507e9dc6c5cc?w=800&q=80",
    date: "2024-12-22",
    readTime: "9 min read",
    tags: ["Unreal Engine 5", "Performance", "Tools"]
  },
  {
    id: 3,
    title: "Modern Web Architecture for Small Projects",
    excerpt: "Not every project needs microservices. Sometimes a well-structured monolith is all you need.",
    content: `
    # Modern Web Architecture for Small Projects

    With buzzwords like 'microservices' and 'serverless' dominating headlines, it's easy to forget that small projects have different needs. A well-architected monolith or simple hybrid can outperform overengineered service meshes! Here’s how I approach modern web architecture for projects that just need to ship—and stay maintainable.

    ## Start With The Requirements

    The first question: how big is your audience? Will you have thousands of users, or hundreds at launch? How complex is the business logic, and how much do you expect it to change? For most MVPs and “long-tail” SaaS, simplicity wins.

    ## The Case For Monoliths

    - **Easy to Develop & Deploy:** One codebase, one build, one deploy.
    - **Integrated Testing:** Far simpler to write integration/UI tests.
    - **Performance:** No network overhead between services.
    - **Faster Onboarding:** New developers only need to understand the monolith, not multiple codebases.

    ## When To Go Modular

    That said, don’t write giant spaghetti code! Modularize using folders, libraries, or plugins. Use clear interfaces between modules (e.g. user, billing, notifications) and keep domain boundaries explicit.

    ## Tech Stack Recommendations

    1. **Backend**:  
       - **Express.js + TypeScript** for APIs  
       - **Prisma** or **TypeORM** for database
       - **JWT/OAuth2** for auth  
    2. **Frontend**:  
       - **React** or **Next.js** for speed and SSR/SPA  
    3. **Database**:  
       - **PostgreSQL** or **MongoDB**  
    4. **DevOps**:  
       - Docker for local development and simple deployments
       - GitHub Actions for CI/CD

    ## Example Folder Structure

    \`\`\`
    /src
      /modules
        /user
        /billing
        /notifications
      /shared
      /config
      /index.js
    \`\`\`

    ## Addressing Common Concerns

    - **What if my project explodes and gains millions of users?**  
      Smart monoliths can be split later: build clean APIs/interfaces now.
    - **Security & Scaling**  
      Monorepos and monoliths are not less secure by default. Use middleware, rate-limiting, and environment configs.

    ## From Monolith to Microservices (When Needed)

    Sometimes, features such as real-time chat or heavy data crunching require separation. That’s the time to peel off a service, not before.

    ## Conclusion

    Modern web development doesn’t require recreating Netflix’s architecture for a portfolio or early SaaS. Start with a maintainable monolith, modularize internally, and split services only when scaling or organizational demands truly require it.

    *Happy building (and keep it simple)!*
    `,
    image: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80",
    date: "2024-12-10",
    readTime: "6 min read",
    tags: ["Architecture", "Backend", "Best Practices"]
  },
  {
    id: 4,
    title: "How I Automate Community Systems Using Discord Bots",
    excerpt: "A breakdown of real-world workflows: auto-mod, ticketing, logging, role sync, and quality-of-life features.",
    contentTitle: "Automating Community Systems with Discord Bots: My Journey & Real-World Examples",
    content: `
    Automating Community Systems with Discord Bots: My Journey & Real-World Examples

    Discord has become the go-to platform for online communities, from gaming clans to developer hubs, art collectives, and personal friend groups. As these communities grow, so do the demands on moderation, engagement, and smooth day-to-day operations. That's where bots come in — and why over the past few years, I've built and refined a suite of Discord bots to automate critical community systems. In this post, I’ll detail not just how I built them, but also the unique problems they solved and the lessons I learned along the way.

    ## Why Automate with Bots?

    Managing a community — even a small one — can quickly become overwhelming. Moderators can burn out tracking bad actors, answering repeated questions, or keeping channels tidy and relevant. Automation handles repetitive work, allowing humans to focus on decision-making and engagement.

    For my own communities (ranging from a few dozen to a few thousand users), I identified five recurring needs:

    1. **Auto-Moderation**
    2. **Ticketing and Support**
    3. **Logging and Auditing**
    4. **Role Synchronization**
    5. **Quality-of-Life Features**

    Let’s take a closer look at each.

    ---

    ## Auto-Moderation

    Spammers, trolls, and scammers are a constant threat in open communities. My bots’ auto-moderation system watches messages in real time, using both keyword matching and more advanced ML models to spot:

    - Profanity
    - Excessive mentions or spam
    - Harmful links or known scam sites
    - Unauthorized file types or large attachments

    I leveraged Discord's gateway API for event-driven message listening, then integrated powerful tools like \`bad-words\` for simple filtering and custom trained classifiers for nuanced situations. When violations are found, the bot can delete offending messages, mute offenders, or escalate to moderators.

    **Lesson Learned:** Relying solely on keyword matches leads to false positives and negatives. Combining basic filtering with machine learning (and tuning thresholds for your community’s culture) yields a much better result.

    ---

    ## Ticketing and Support Automation

    No matter the community’s focus, support queries will pile up: “How do I get this role?” “Where are the rules?” “I have an issue with another member.” Handling these ad-hoc in chat gets messy.

    I built a ticketing system via bot-initiated private channel creation. When a user reacts with a 📩 or types \`!ticket\`, the bot opens a private thread between the user and support/moderators. The bot logs all correspondence, closes tickets on command, and can send autogenerated solutions for common issues.

    **Lesson Learned:** Clear, automatic transcripts of ticket conversations proved invaluable, especially if disputes needed moderator reviews later.

    ---

    ## Logging and Auditing

    Transparency is key — both for moderators and for bot debugging. The logging system I built tracks:

    - Message edits and deletions
    - Member joins/leaves
    - Role and nickname changes
    - Command usage, errors, and permission denials

    All logs get written to a dedicated channel and, for larger communities, an external database (I use MongoDB + simple dashboard). This helped surface problems early, like a misconfigured role or a buggy new feature.

    ---

    ## Role Sync and Automation

    Role management can be tedious, especially as community quirks grow: special roles for event winners, contributors, or boosters. My bots sync roles based on emoji reactions, time in server, or custom achievements (tracked through user actions). For example:

    - React to a message to self-assign pronouns or interests.
    - Earn a role after a week’s membership.
    - Sync Patreon/Ko-fi status automatically via API.

    **Lesson Learned:** Letting users self-assign roles empowers them and cuts back on moderator busywork — but you’ll want clear permissions and monitoring to prevent abuse.

    ---

    ## Quality-of-Life Features

    The “little things” go a long way toward community happiness:

    - Automatic welcome messages and onboarding guides in DMs.
    - Daily or weekly polls and reminders.
    - Custom slash commands linking to FAQs or resources.
    - Fun utilities: countdown timers, random quotes, birthday reminders.

    These features are often requested the most and keep members engaged.

    ---

    ## Tech Stack & Deployment

    Most of my bots are built in JavaScript using the \`discord.js\` library, with select performance-critical parts in Python (for advanced AI moderation).

    For hosting, I transitioned from cheap VPS solutions to Dockerized microservices on AWS EC2 with process monitors (PM2). I use GitHub Actions for CI/CD — pushing new bot builds triggers automated deployments in minutes.

    ---

    ## The Real Impact

    Since deploying these systems, my communities have seen:

    - Dramatic drop in spam and toxic behavior
    - Faster, traceable support thanks to ticket logs
    - Happier, more involved members able to personalize their experience
    - Reduced burnout among moderators

    Bots can’t (and shouldn’t) replace real, human engagement or decision-making. But they *do* supercharge community health by handling the mundane, so human admins can focus on what matters: growing and enjoying the community.

    If you’re interested in trying these systems for your own group, or contributing to my open-sourced bot projects, find me on GitHub or get in touch!

    Happy automating!
    `,
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?w=800&q=80",
    date: "2024-11-30",
    readTime: "8 min read",
    tags: ["Discord", "Automation", "Community Tools"]
  }
];
