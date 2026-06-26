import React from 'react';
import { GraduationCap, Calendar, MapPin, Award, CheckCircle2 } from 'lucide-react';
import { education, certifications } from '../data/mock';

const Education = () => {
  return (
    <section id="education" className="py-32 bg-[#0f0f10]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Academic Background
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Education & Certifications
          </h2>
        </div>

        <div className="mb-16">
          <h3 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
            <GraduationCap className="text-cyan-400" />
            Education
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            {education.map((edu) => (
              <div
                key={edu.id}
                className="bg-[#0a0a0a] rounded-xl p-6 border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 hover:transform hover:scale-105"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-cyan-400/10 rounded-lg flex-shrink-0">
                    <GraduationCap size={24} className="text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-white mb-1">
                      {edu.degree}
                    </h4>
                    <p className="text-cyan-400 font-semibold mb-2">
                      {edu.school}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-cyan-400" />
                    <span>
                      {edu.startDate} - {edu.endDate}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-cyan-400" />
                    <span>{edu.location}</span>
                  </div>
                </div>

                <p className="text-gray-400 mb-4">{edu.description}</p>

                <div className="space-y-2">
                  {edu.achievements.map((achievement, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <CheckCircle2
                        size={16}
                        className="text-cyan-400 mt-1 flex-shrink-0"
                      />
                      <span className="text-gray-400 text-sm">
                        {achievement}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
            <Award className="text-cyan-400" />
            Certifications
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {certifications.map((cert) => (
              <div
                key={cert.id}
                className="bg-[#0a0a0a] rounded-xl p-6 border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 hover:transform hover:scale-105"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 bg-cyan-400/10 rounded-lg flex-shrink-0">
                    <Award size={20} className="text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold text-white mb-1">
                      {cert.name}
                    </h4>
                    <p className="text-cyan-400 text-sm mb-2">{cert.issuer}</p>
                    <p className="text-gray-500 text-sm">{cert.date}</p>
                  </div>
                </div>
                <a
                  href={cert.credentialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-400 hover:text-cyan-400 transition-colors inline-flex items-center gap-1 mt-2"
                >
                  View Credential →
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Education;