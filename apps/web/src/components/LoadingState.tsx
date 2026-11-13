import React from 'react';
import {
  Loader2,
} from '../lib/icons';

interface LoadingStateProps {
  title?: string;
  description?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  title = 'Loading...',
  description,
  className = '',
}) => {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs space-y-3 ${className}`}>
      <div className="inline-flex p-3 rounded-full bg-red-50 text-red-600 mb-1">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {description && (
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          {description}
        </p>
      )}
    </div>
  );
};

