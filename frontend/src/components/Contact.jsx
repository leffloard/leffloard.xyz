import React, { lazy, Suspense } from 'react';
import { Mail, MapPin, Phone, Github, Linkedin, Twitter, Loader2 } from 'lucide-react';
import { personalInfo } from '../data/mock';

const RequestForm = lazy(() => import('./RequestForm'));

const FormFallback = () => (
  <div className="flex min-h-[640px] items-center justify-center" role="status">
    <Loader2 className="animate-spin text-cyan-400" size={28} aria-hidden="true" />
    <span className="sr-only">Loading the contact form...</span>
  </div>
);

const Contact = () => {
  return (
    <section id="contact" className="py-32 bg-[#0f0f10]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Get In Touch
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Let's Work Together
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto">
            Book a call, request a revision on delivered work, or just say hi. I usually reply within 24 hours.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-12">
          <div className="lg:col-span-2 space-y-8">
            <div>
              <h3 className="text-2xl font-bold text-white mb-6">Contact Information</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-cyan-400/10 rounded-lg flex-shrink-0">
                    <Mail className="text-cyan-400" size={24} />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm mb-1">Email</p>
                    <a
                      href={`mailto:${personalInfo.email}`}
                      className="text-white hover:text-cyan-400 transition-colors"
                    >
                      {personalInfo.email}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="p-3 bg-cyan-400/10 rounded-lg flex-shrink-0">
                    <Phone className="text-cyan-400" size={24} />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm mb-1">Phone</p>
                    <p className="text-white">{personalInfo.phone}</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="p-3 bg-cyan-400/10 rounded-lg flex-shrink-0">
                    <MapPin className="text-cyan-400" size={24} />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm mb-1">Location</p>
                    <p className="text-white">{personalInfo.location}</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold text-white mb-4">Follow Me</h3>
              <div className="flex items-center gap-4">
                <a
                  href={personalInfo.social.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className="p-3 bg-[#0a0a0a] rounded-lg border border-gray-800 hover:border-cyan-400 transition-all duration-300 hover:transform hover:scale-110"
                >
                  <Github className="text-gray-400 hover:text-cyan-400 transition-colors" size={24} />
                </a>
                <a
                  href={personalInfo.social.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="p-3 bg-[#0a0a0a] rounded-lg border border-gray-800 hover:border-cyan-400 transition-all duration-300 hover:transform hover:scale-110"
                >
                  <Linkedin className="text-gray-400 hover:text-cyan-400 transition-colors" size={24} />
                </a>
                <a
                  href={personalInfo.social.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="X (Twitter)"
                  className="p-3 bg-[#0a0a0a] rounded-lg border border-gray-800 hover:border-cyan-400 transition-all duration-300 hover:transform hover:scale-110"
                >
                  <Twitter className="text-gray-400 hover:text-cyan-400 transition-colors" size={24} />
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 bg-[#0a0a0a] rounded-xl p-5 sm:p-8 border border-gray-800">
            <Suspense fallback={<FormFallback />}>
              <RequestForm />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;