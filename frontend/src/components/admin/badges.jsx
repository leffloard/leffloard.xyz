import React from 'react';
import { cn } from '../../lib/utils';
import { badgeVariants } from '../ui/badge';
import { STATUS_LABELS, TYPE_LABELS } from '../../lib/requests';

const TYPE_STYLES = {
  appointment: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  revision: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300',
  inquiry: 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300',
};

const STATUS_STYLES = {
  new: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  confirmed: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  declined: 'border-red-400/30 bg-red-400/10 text-red-300',
  completed: 'border-gray-600 bg-gray-800/60 text-gray-300',
};

const base = cn(badgeVariants({ variant: 'outline' }), 'whitespace-nowrap font-medium');

export function TypeBadge({ type, className }) {
  return (
    <span className={cn(base, TYPE_STYLES[type] || STATUS_STYLES.completed, className)}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}

export function StatusBadge({ status, className }) {
  return (
    <span className={cn(base, STATUS_STYLES[status] || STATUS_STYLES.completed, className)}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function ChannelBadge({ label, enabled }) {
  return (
    <span
      className={cn(
        base,
        'gap-1.5',
        enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-gray-700 text-gray-500'
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', enabled ? 'bg-emerald-400' : 'bg-gray-600')}
      />
      {label}: {enabled ? 'on' : 'off'}
    </span>
  );
}
