import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Github, Linkedin, Mail } from 'lucide-react';
import { personalInfo } from '../data/mock';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setIsMobileMenuOpen(false);
    }
  };

  const navLinks = [
    { name: 'About', id: 'about' },
    { name: 'Pricing', path: '/pricing' },
    { name: 'Skills', id: 'skills' },
    { name: 'Experience', id: 'experience' },
    { name: 'Projects', id: 'projects' },
    { name: 'Education', id: 'education' },
    { name: 'Blog', id: 'blog' },
    { name: 'Contact', id: 'contact' }
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#0a0a0a]/95 backdrop-blur-md border-b border-gray-800'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="text-xl font-bold text-white hover:text-cyan-400 transition-colors"
          >
            &lt;LeffLoard&gt;
          </Link>

          <nav className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) =>
              link.path ? (
                <Link
                  key={link.path}
                  to={link.path}
                  className="text-gray-300 hover:text-cyan-400 transition-colors text-sm font-medium"
                >
                  {link.name}
                </Link>
              ) : (
                <button
                  key={link.id}
                  onClick={() => scrollToSection(link.id)}
                  className="text-gray-300 hover:text-cyan-400 transition-colors text-sm font-medium"
                >
                  {link.name}
                </button>
              )
            )}
          </nav>

          <div className="hidden md:flex items-center space-x-4">
            <a
              href={personalInfo.social.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <Github size={20} />
            </a>
            <a
              href={personalInfo.social.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <Linkedin size={20} />
            </a>
            <a
              href={`mailto:${personalInfo.email}`}
              className="text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <Mail size={20} />
            </a>
          </div>

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-white"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-gray-800 pt-4">
            <nav className="flex flex-col space-y-4">
              {navLinks.map((link) =>
                link.path ? (
                  <Link
                    key={link.path}
                    to={link.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="text-gray-300 hover:text-cyan-400 transition-colors text-left"
                  >
                    {link.name}
                  </Link>
                ) : (
                  <button
                    key={link.id}
                    onClick={() => scrollToSection(link.id)}
                    className="text-gray-300 hover:text-cyan-400 transition-colors text-left"
                  >
                    {link.name}
                  </button>
                )
              )}
            </nav>
            <div className="flex items-center space-x-4 mt-6 pt-4 border-t border-gray-800">
              <a
                href={personalInfo.social.github}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-cyan-400 transition-colors"
              >
                <Github size={20} />
              </a>
              <a
                href={personalInfo.social.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-cyan-400 transition-colors"
              >
                <Linkedin size={20} />
              </a>
              <a
                href={`mailto:${personalInfo.email}`}
                className="text-gray-400 hover:text-cyan-400 transition-colors"
              >
                <Mail size={20} />
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;