import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Zap, Code, Rocket, Globe, MessageCircle, Shield, Box } from 'lucide-react';

const pricingPlans = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for small projects and MVPs',
    price: 499,
    period: 'project',
    icon: Code,
    features: [
      'Up to 5 pages',
      'Responsive design',
      'Contact form',
      '1 revision round',
      '2 weeks delivery'
    ],
    highlighted: false
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'Ideal for businesses and web apps',
    price: 1299,
    period: 'project',
    icon: Zap,
    features: [
      'Up to 15 pages',
      'Custom design & UX',
      'CMS integration',
      'API development',
      '3 revision rounds',
      '4 weeks delivery',
      '1 month support'
    ],
    highlighted: true
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Full-scale solutions and ongoing partnership',
    price: 3499,
    period: 'project',
    icon: Rocket,
    features: [
      'Unlimited pages',
      'Full-stack application',
      'Database design',
      'Authentication & security',
      'Unlimited revisions',
      'Custom timeline',
      '3 months support',
      'Priority communication'
    ],
    highlighted: false
  }
];

const servicesWithTiers = [
  {
    id: 'website',
    name: 'Website',
    description: 'Landing pages, portfolios, business sites, and full web apps. React, Next.js, responsive.',
    icon: Globe,
    tiers: [
      { name: 'Landing Page', price: 299, features: ['1–2 pages', 'Responsive design', 'Contact form', '1 revision round', '~1 week delivery'] },
      { name: 'Multi-page', price: 599, features: ['Up to 5 pages', 'Custom layout', 'SEO basics', '2 revision rounds', '~2 weeks delivery'] },
      { name: 'Business / CMS', price: 1299, features: ['Up to 15 pages', 'CMS integration', 'Blog or news', 'Analytics', '3 revision rounds', '~4 weeks'] },
      { name: 'Full Web App', price: 2499, features: ['Full-stack app', 'Database & API', 'Auth optional', 'Admin panel', 'Unlimited revisions', 'Custom timeline'] }
    ]
  },
  {
    id: 'discord-bot',
    name: 'Discord Bot',
    description: 'Custom Discord bots: moderation, automation, tickets, economy, games, and integrations.',
    icon: MessageCircle,
    tiers: [
      { name: 'Basic Bot', price: 199, features: ['Slash commands (up to 5)', 'Basic moderation', 'Welcome/goodbye', 'Hosting guide', '~1 week delivery'] },
      { name: 'Standard Bot', price: 449, features: ['10+ commands', 'Moderation & logging', 'Ticket system', 'Custom commands', '2 revision rounds', '~2 weeks'] },
      { name: 'Advanced Bot', price: 799, features: ['Economy / leveling', 'Mini-games', 'Dashboard (optional)', 'Database setup', '3 revision rounds', '~3–4 weeks'] },
      { name: 'Premium Bot', price: 999, features: ['Fully custom scope', 'Multiple integrations', 'API connections', 'Hosting setup', '1 month support', 'Priority updates'] }
    ]
  },
  {
    id: 'auth-systems',
    name: 'Auth Systems',
    description: 'Login, registration, OAuth, 2FA, session handling, and role-based access control.',
    icon: Shield,
    tiers: [
      { name: 'Basic Auth', price: 349, features: ['Email & password', 'JWT or session', 'Register / login', 'Password reset', '~1 week delivery'] },
      { name: 'Social Login', price: 599, features: ['Everything in Basic', 'OAuth (Google, Discord, etc.)', 'Account linking', '2 revision rounds', '~2 weeks'] },
      { name: 'Full Auth', price: 899, features: ['Everything in Social', '2FA (TOTP)', 'RBAC (roles)', 'Email verification', '~3 weeks'] },
      { name: 'Enterprise Auth', price: 1299, features: ['SSO / SAML', 'Audit logs', 'Custom flows', 'Unlimited revisions', 'Documentation', 'Custom timeline'] }
    ]
  },
  {
    id: 'protected-loaders',
    name: 'Protected Loaders',
    description: 'Custom loaders and overlay UIs: injectors, config panels, internal menus, game tools.',
    icon: Box,
    tiers: [
      { name: 'Simple Loader', price: 499, features: ['Basic injection', 'Config file (JSON/ini)', 'Simple UI', 'Updates (1 month)', '~2 weeks delivery'] },
      { name: 'Standard Loader', price: 999, features: ['ImGui menu', 'Config system', 'Multiple features', 'Updates (2 months)', '2 revision rounds', '~3–4 weeks'] },
      { name: 'Advanced', price: 1499, features: ['Custom ImGui UI', 'Anti-debug / protection', 'Auto-updater', 'Updates (3 months)', 'Priority support', '~4–6 weeks'] },
      { name: 'Premium', price: 1999, features: ['Full custom scope', 'Ongoing updates', '6 months support', 'Unlimited revisions', 'Documentation', 'Custom timeline'] }
    ]
  }
];

const Pricing = () => {
  return (
    <main className="min-h-screen bg-[#0a0a0a] pt-24 pb-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Pricing
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-white mt-2">
            Simple, Transparent Pricing
          </h1>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto">
            Detailed pricing by service. All prices are one-time per project. Need something custom? Get in touch.
          </p>
        </div>

        <div className="space-y-20">
          {servicesWithTiers.map((service) => {
            const Icon = service.icon;
            return (
              <section key={service.id} className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-8">
                  <div className="p-3 bg-cyan-400/10 rounded-lg">
                    <Icon className="text-cyan-400" size={28} />
                  </div>
                  <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white">{service.name}</h2>
                    <p className="text-gray-500 mt-1">{service.description}</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {service.tiers.map((tier) => (
                    <div
                      key={tier.name}
                      className="rounded-xl border border-gray-800 bg-[#0f0f10] p-6 hover:border-cyan-400/40 transition-all duration-300 flex flex-col"
                    >
                      <h3 className="text-lg font-bold text-white mb-2">{tier.name}</h3>
                      <div className="mb-4">
                        <span className="text-3xl font-bold text-white">${tier.price}</span>
                        <span className="text-gray-500 text-sm ml-1">/ project</span>
                      </div>
                      <ul className="space-y-2 mb-6 flex-1">
                        {tier.features.map((f) => (
                          <li key={f} className="flex items-start gap-2 text-gray-400 text-sm">
                            <Check className="text-cyan-400 flex-shrink-0 mt-0.5" size={16} />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        to="/#contact"
                        className="block w-full py-3 rounded-lg border border-gray-700 text-center text-sm font-medium text-white hover:border-cyan-400 hover:text-cyan-400 transition-colors"
                      >
                        Get a quote
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-24">
          <div className="text-center mb-12">
            <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
              General Plans
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-white mt-2">
              Full Project Bundles
            </h2>
            <p className="text-gray-400 mt-2 max-w-xl mx-auto">
              End-to-end project tiers when you need a full package.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {pricingPlans.map((plan) => {
              const Icon = plan.icon;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-8 transition-all duration-300 ${
                    plan.highlighted
                      ? 'bg-gradient-to-b from-cyan-400/10 to-transparent border-cyan-400/50 scale-105 shadow-lg shadow-cyan-400/10'
                      : 'bg-[#0f0f10] border-gray-800 hover:border-gray-700'
                  }`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-cyan-400 text-black text-xs font-bold px-4 py-1 rounded-full">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-cyan-400/10 rounded-lg">
                      <Icon className="text-cyan-400" size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                      <p className="text-gray-500 text-sm">{plan.description}</p>
                    </div>
                  </div>

                  <div className="mb-8">
                    <span className="text-4xl font-bold text-white">${plan.price}</span>
                    <span className="text-gray-500 ml-1">/ {plan.period}</span>
                  </div>

                  <ul className="space-y-4 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3 text-gray-400">
                        <Check className="text-cyan-400 flex-shrink-0" size={20} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    to="/#contact"
                    className={`block w-full py-4 rounded-lg font-semibold text-center transition-all duration-300 ${
                      plan.highlighted
                        ? 'bg-cyan-400 text-black hover:bg-cyan-300 hover:shadow-lg hover:shadow-cyan-400/30'
                        : 'bg-[#0a0a0a] border border-gray-700 text-white hover:border-cyan-400 hover:text-cyan-400'
                    }`}
                  >
                    Get Started
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-16 text-center">
          <p className="text-gray-500 mb-4">
            Hourly rate available for ongoing work or maintenance.
          </p>
          <Link
            to="/#contact"
            className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
          >
            Contact me for a custom quote →
          </Link>
        </div>
      </div>
    </main>
  );
};

export default Pricing;
