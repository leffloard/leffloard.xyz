import React from 'react';
import { Calendar, Clock, ArrowRight } from 'lucide-react';
import { blogPosts } from '../data/mock';
import { Link } from 'react-router-dom';

const Blog = () => {
  return (
    <section id="blog" className="py-32 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">
            Latest Writings
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-2">
            Blog & Articles
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {blogPosts.map((post) => (
            <Link 
              to={`/blog/${post.id}`} 
              key={post.id}
              className="group bg-[#0f0f10] rounded-xl overflow-hidden border border-gray-800 hover:border-cyan-400/50 transition-all duration-300 cursor-pointer hover:scale-105"
            >
              <article>
                <div className="aspect-video overflow-hidden relative">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f10] to-transparent opacity-60" />
                </div>

                <div className="p-6">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs bg-gray-800 text-cyan-400 px-3 py-1 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <h3 className="text-xl font-bold text-white mb-3 group-hover:text-cyan-400 transition-colors line-clamp-2">
                    {post.title}
                  </h3>

                  <p className="text-gray-400 mb-4 line-clamp-3">
                    {post.excerpt}
                  </p>

                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-cyan-400" />
                        <span>{new Date(post.date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-cyan-400" />
                        <span>{post.readTime}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <span className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-2 text-sm font-semibold group-hover:gap-3">
                      Read More
                      <ArrowRight size={16} />
                    </span>
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>

        <div className="text-center mt-12">
          <button className="px-8 py-4 bg-transparent border-2 border-gray-700 text-white font-semibold rounded-lg hover:border-cyan-400 hover:text-cyan-400 transition-all duration-300">
            View All Articles
          </button>
        </div>
      </div>
    </section>
  );
};

export default Blog;
