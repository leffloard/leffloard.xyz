import React from 'react';
import { Code2, Database, Layout, Server, Wrench } from 'lucide-react';
import { skills } from '../data/mock';

const Skills = () => {
  const categories = {
    Languages: { icon: Code2, color: 'cyan' },
    Frontend: { icon: Layout, color: 'blue' },
    Backend: { icon: Server, color: 'purple' },
    Database: { icon: Database, color: 'green' },
    DevOps: { icon: Server, color: 'orange' },
    Tools: { icon: Wrench, color: 'pink' }
  };

  const groupedSkills = skills.reduce((acc, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {});

  return (
    <section id="skills" className="py-32 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            My Expertise
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Skills & Technologies
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {Object.entries(groupedSkills).map(([category, categorySkills]) => {
            const CategoryIcon = categories[category]?.icon || Code2;
            return (
              <div
                key={category}
                className="bg-[#0f0f10] rounded-xl p-6 border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 hover:transform hover:scale-105"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-cyan-400/10 rounded-lg">
                    <CategoryIcon size={24} className="text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">{category}</h3>
                </div>

                <div className="space-y-4">
                  {categorySkills.map((skill) => (
                    <div key={skill.name}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-gray-300 text-sm">{skill.name}</span>
                        <span className="text-cyan-400 text-xs font-mono">
                          {skill.level}%
                        </span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-1000 ease-out"
                          style={{ width: `${skill.level}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Skills;