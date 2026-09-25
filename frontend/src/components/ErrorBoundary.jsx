import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';

function LoadError({ title, description, className }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm text-gray-400">{description}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <RotateCcw size={14} aria-hidden="true" />
        Reload page
      </button>
    </div>
  );
}

// A lazily loaded chunk disappears when the site is redeployed while a tab is open; without a boundary the failed
// import would unmount the whole app and leave a blank page.
class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <LoadError
        title={this.props.title || 'Something went wrong.'}
        description={
          this.props.description ||
          'The site may have been updated since you opened this page. Reloading it usually fixes this.'
        }
        className={this.props.className}
      />
    );
  }
}

export default ErrorBoundary;
