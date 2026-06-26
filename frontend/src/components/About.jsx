import React from 'react';
import { MapPin, Mail, Phone } from 'lucide-react';
import { personalInfo } from '../data/mock';

const About = () => {
  return (
    <section id="about" className="py-32 bg-[#0f0f10]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div>
              <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
                About Me
              </span>
              <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
                Who I Am
              </h2>
            </div>

            <p className="text-gray-400 text-lg leading-relaxed">
              {personalInfo.bio}
            </p>

            <div className="space-y-3 pt-4">
              <div className="flex items-center gap-3 text-gray-400">
                <MapPin size={20} className="text-cyan-400" />
                <span>{personalInfo.location}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-400">
                <Mail size={20} className="text-cyan-400" />
                <a
                  href={`mailto:${personalInfo.email}`}
                  className="hover:text-cyan-400 transition-colors"
                >
                  {personalInfo.email}
                </a>
              </div>
              <div className="flex items-center gap-3 text-gray-400">
                <Phone size={20} className="text-cyan-400" />
                <span>{personalInfo.phone}</span>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-400/20 to-blue-500/20 p-1">
              <div className="w-full h-full rounded-2xl overflow-hidden bg-[#0a0a0a]">
                <img
                  src={personalInfo.avatar}
                  alt={personalInfo.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-cyan-400/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;