import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import './App.css';

import { BrowserRouter as Router, Routes, Route, Outlet, Link, useLocation } from "react-router-dom";
import { Loader2 } from 'lucide-react';

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

const AdminPage = lazy(() => import('./components/admin/AdminPage'));

function jumpInstantly(scroll) {
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  // Chrome only applies the new scroll-behavior after a style recalculation.
  root.getClientRects();
  scroll();
  root.style.scrollBehavior = previous;
}

function ScrollManager() {
  const { pathname, hash, key } = useLocation();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    const pathChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;

    if (!hash) {
      if (pathChanged) jumpInstantly(() => window.scrollTo(0, 0));
      return undefined;
    }

    const id = decodeURIComponent(hash.slice(1));
    let frame;
    let attempts = 0;
    const scrollToTarget = () => {
      const element = document.getElementById(id);
      if (element) {
        if (pathChanged) {
          jumpInstantly(() => element.scrollIntoView());
        } else {
          element.scrollIntoView({ behavior: 'smooth' });
        }
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

function SiteLayout() {
  const [isLoading, setIsLoading] = useState(true);
  const finishLoading = useCallback(() => setIsLoading(false), []);

  useEffect(() => {
    const timer = setTimeout(finishLoading, 10000);
    return () => clearTimeout(timer);
  }, [finishLoading]);

  return (
    <>
      {isLoading && <LoadingScreen onComplete={finishLoading} />}
      <Header />
      <Outlet />
      <Footer />
    </>
  );
}

function AdminFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <Loader2 className="animate-spin text-cyan-400" size={28} aria-hidden="true" />
      <span className="sr-only">Loading admin panel...</span>
    </div>
  );
}

function NotFound() {
  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center">
      <span className="text-cyan-400 text-sm font-mono uppercase tracking-wider">404</span>
      <h1 className="text-4xl font-bold text-white mt-2">Page not found</h1>
      <p className="text-gray-400 mt-4">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-8 text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
        Back to home →
      </Link>
    </main>
  );
}

function App() {
  return (
    <Router>
      <ScrollManager />
      <div className="App bg-[#0a0a0a] min-h-screen">
        <Routes>
          <Route
            path="/admin"
            element={
              <Suspense fallback={<AdminFallback />}>
                <AdminPage />
              </Suspense>
            }
          />

          <Route element={<SiteLayout />}>
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
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>

        <Toaster />
      </div>
    </Router>
  );
}

export default App;
