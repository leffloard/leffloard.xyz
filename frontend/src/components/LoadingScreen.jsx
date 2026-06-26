import React, { useState, useEffect } from 'react';
import { Code2 } from 'lucide-react';

const LoadingScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const duration = 2000;
    const steps = 100;
    const stepDuration = duration / steps;

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      setProgress(currentStep);

      if (currentStep >= steps) {
        clearInterval(interval);
        setTimeout(() => {
          setIsComplete(true);
          setTimeout(() => {
            onComplete();
          }, 500);
        }, 200);
      }
    }, stepDuration);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-500 ${
        isComplete ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="text-center">
        <div className="mb-8 flex justify-center">
          <div
            className="animate-pulse"
            style={{
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }}
          >
            <Code2 size={64} className="text-cyan-400" strokeWidth={1.5} />
          </div>
        </div>
        <div className="w-64 h-1 bg-gray-800 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-100 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-gray-500 text-sm font-mono">{progress}%</p>
      </div>
    </div>
  );
};

export default LoadingScreen;