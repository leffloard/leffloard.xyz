import React from 'react';
import { Briefcase, Calendar, MapPin, CheckCircle2 } from 'lucide-react';
import { experience } from '../data/mock';

const Experience = () => {
  return (
    <section id="experience" className="py-32 bg-[#0f0f10]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Career Journey
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Work Experience
          </h2>
        </div>

        <div className="relative">
          <div className="hidden md:block absolute left-1/2 transform -translate-x-1/2 h-full w-0.5 bg-gradient-to-b from-cyan-400 via-blue-500 to-transparent" />

          <div className="space-y-12">
            {experience.map((job, index) => (
              <div
                key={job.id}
                className={`relative grid md:grid-cols-2 gap-8 items-start ${
                  index % 2 === 0 ? 'md:text-right' : 'md:flex-row-reverse'
                }`}
              >
                <div
                  className={`${
                    index % 2 === 0 ? 'md:col-start-1' : 'md:col-start-2'
                  }`}
                >
                  <div className="bg-[#0a0a0a] rounded-xl p-6 border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 hover:transform hover:scale-105">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="p-2 bg-cyan-400/10 rounded-lg flex-shrink-0">
                        <Briefcase size={20} className="text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white mb-1">
                          {job.title}
                        </h3>
                        <p className="text-cyan-400 font-semibold mb-2">
                          {job.company}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-cyan-400" />
                        <span>
                          {job.startDate} - {job.endDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={16} className="text-cyan-400" />
                        <span>{job.location}</span>
                      </div>
                    </div>

                    <p className="text-gray-400 mb-4">{job.description}</p>

                    <div className="space-y-2">
                      {job.achievements.map((achievement, i) => (
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
                </div>

                <div className="hidden md:block absolute left-1/2 transform -translate-x-1/2 top-8">
                  <div className="w-4 h-4 bg-cyan-400 rounded-full border-4 border-[#0f0f10]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Experience;