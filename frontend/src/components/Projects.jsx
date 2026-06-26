import React, { useState } from 'react';
import { ExternalLink, Github, X } from 'lucide-react';
import { projects } from '../data/mock';

const Projects = () => {
  const [selectedProject, setSelectedProject] = useState(null);

  return (
    <section id="projects" className="py-32 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Portfolio
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Featured Projects
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group relative bg-[#0f0f10] rounded-xl overflow-hidden border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 cursor-pointer"
              onClick={() => setSelectedProject(project)}
            >
              <div className="aspect-video overflow-hidden relative">
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f10] to-transparent opacity-60" />
                {project.featured && (
                  <div className="absolute top-4 right-4">
                    <span className="bg-cyan-400 text-black text-xs font-bold px-3 py-1 rounded-full">
                      Featured
                    </span>
                  </div>
                )}
              </div>

              <div className="p-6">
                <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-cyan-400 transition-colors">
                  {project.title}
                </h3>
                <p className="text-gray-400 mb-4 line-clamp-2">
                  {project.description}
                </p>

                <div className="flex flex-wrap gap-2 mb-4">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-gray-800 text-cyan-400 px-3 py-1 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-4">
                  <a
                    href={project.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-2 text-sm"
                  >
                    <ExternalLink size={16} />
                    Live Demo
                  </a>
                  <a
                    href={project.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-2 text-sm"
                  >
                    <Github size={16} />
                    Source Code
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setSelectedProject(null)}
        >
          <div
            className="bg-[#0f0f10] rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <img
                src={selectedProject.image}
                alt={selectedProject.title}
                className="w-full h-64 object-cover"
              />
              <button
                onClick={() => setSelectedProject(null)}
                className="absolute top-4 right-4 p-2 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-8">
              <h3 className="text-3xl font-bold text-white mb-4">
                {selectedProject.title}
              </h3>

              <div className="flex flex-wrap gap-2 mb-6">
                {selectedProject.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-sm bg-gray-800 text-cyan-400 px-4 py-2 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-gray-400 text-lg leading-relaxed mb-8">
                {selectedProject.longDescription}
              </p>

              <div className="flex flex-wrap gap-4">
                <a
                  href={selectedProject.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-cyan-400 text-black font-semibold rounded-lg hover:bg-cyan-300 transition-all duration-300 flex items-center gap-2"
                >
                  <ExternalLink size={20} />
                  View Live Demo
                </a>
                <a
                  href={selectedProject.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-transparent border-2 border-gray-700 text-white font-semibold rounded-lg hover:border-cyan-400 hover:text-cyan-400 transition-all duration-300 flex items-center gap-2"
                >
                  <Github size={20} />
                  View Source
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Projects;