import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Download, ShoppingCart } from 'lucide-react';
import { personalInfo } from '../data/mock';

const Hero = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const scrollToAbout = () => {
    const aboutSection = document.getElementById('about');
    if (aboutSection) {
      aboutSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section
      id="hero"
      className="min-h-screen flex items-center justify-center bg-[#0a0a0a] relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

      <div className="max-w-7xl mx-auto px-6 py-32 relative z-10">
        <div
          className={`text-center transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          <div className="mb-6 inline-block">
            <span className="text-cyan-400 text-sm font-mono bg-cyan-400/10 px-4 py-2 rounded-full border border-cyan-400/20">
              Available for opportunities
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-white mb-6">
            Hi, I'm{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 text-transparent bg-clip-text">
              {personalInfo.name.split(' ')[0]}
            </span>
          </h1>

          <h2 className="text-2xl md:text-4xl text-gray-400 mb-8 font-light">
            {personalInfo.title}
          </h2>

          <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-12">
            {personalInfo.tagline}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
            <button
              onClick={scrollToAbout}
              className="px-8 py-4 bg-cyan-400 text-black font-semibold rounded-lg hover:bg-cyan-300 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-cyan-400/50"
            >
              View My Work
            </button>
            <Link
              to="/pricing"
              className="px-8 py-4 bg-transparent border-2 border-cyan-400/50 text-cyan-400 font-semibold rounded-lg hover:bg-cyan-400/10 hover:border-cyan-400 transition-all duration-300 flex items-center gap-2"
            >
              <ShoppingCart size={20} />
              Purchase
            </Link>
            <a
              href={personalInfo.resumeUrl}
              download
              className="px-8 py-4 bg-transparent border-2 border-gray-700 text-white font-semibold rounded-lg hover:border-cyan-400 hover:text-cyan-400 transition-all duration-300 flex items-center gap-2"
            >
              <Download size={20} />
              Download CV
            </a>
          </div>
        </div>
      </div>

      <button
        onClick={scrollToAbout}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-500 hover:text-cyan-400 transition-colors animate-bounce"
      >
        <ArrowDown size={32} />
      </button>
    </section>
  );
};

export default Hero;