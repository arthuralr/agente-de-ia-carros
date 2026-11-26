import React, { useState } from 'react';
import { Car } from 'lucide-react';

interface VehicleImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

export const VehicleImage: React.FC<VehicleImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  priority = false,
}) => {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-500 border border-white/[0.06] ${className}`}
        aria-label={alt}
      >
        <Car className="w-6 h-6 text-red-500/70 mb-1" />
        <span className="text-[11px] font-medium text-zinc-400 px-2 text-center truncate max-w-full">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
};
