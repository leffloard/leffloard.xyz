import React, { useState, useEffect, useRef } from 'react';
import './App.css';

import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";

import LoadingScreen from './components/LoadingScreen';
import Header from './components/Header';
import Hero from './components/Hero';
import About from './components/About';
import Skills from './components/Skills';
import Experience from './components/Experience';
import Projects from './components/Projects';
import Education from './components/Education';
import Blog from './components/Blog';
import BlogDetails from "./components/BlogDetails";
import Contact from './components/Contact';
import Pricing from './components/Pricing';
import Footer from './components/Footer';
import { Toaster } from './components/ui/toaster';

function ScrollManager() {
  const { pathname, hash, key } = useLocation();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    const pathChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;

    if (!hash) {
      if (pathChanged) window.scrollTo(0, 0);
      return undefined;
    }

    const id = decodeURIComponent(hash.slice(1));
    let frame;
    let attempts = 0;
    const scrollToTarget = () => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      } else if (attempts < 60) {
        attempts += 1;
        frame = requestAnimationFrame(scrollToTarget);
      }
    };
    scrollToTarget();
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, key]);

  return null;
}

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 10000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Router>
      <ScrollManager />
      <div className="App bg-[#0a0a0a] min-h-screen">
        {isLoading && <LoadingScreen onComplete={() => setIsLoading(false)} />}

        <Header />

        <Routes>
          <Route
            path="/"
            element={
              <main>
                <Hero />
                <About />
                <Skills />
                <Experience />
                <Projects />
                <Education />
                <Blog />
                <Contact />
              </main>
            }
          />

          <Route path="/pricing" element={<Pricing />} />
          <Route path="/blog/:id" element={<BlogDetails />} />
        </Routes>

        <Footer />
        <Toaster />
      </div>
    </Router>
  );
}

export default App;
